import { prisma } from '../prisma.mjs';
import { config } from './filingConfig.mjs';
import { importZip } from './importer.mjs';
import { uploadLibraryDocument } from './libraryUpload.mjs';
import { buildLibraryCatalog, describeLibraryFile, filterLibraryCatalog, libraryCatalogSummary, publicCatalogEntry } from './libraryCatalog.mjs';
import { scanTemplateFieldsWithAI } from './fieldContextScanner.mjs';
import {
  detectTemplateFields,
  mergeStoredFieldScan,
  renderFilledTemplate,
  renderPlainText,
  renderPreviewHtml,
  completionSummary,
} from './templateFiller.mjs';
import { renderDraftDocxBuffer, renderDraftPdfBuffer, safeDraftFileName } from './draftExport.mjs';
import { getTemplateDocument, sanitizeDocumentHtml, documentHtmlToText, exportDocumentHtml } from './documentLayout.mjs';
import fs from 'node:fs/promises';
import { ensureContractLibrary } from './libraryLoader.mjs';
import { cleanupSignedCopies } from '../contracts/contractProgress.mjs';
import { billing } from '../billing/billingService.mjs';
import { ensurePrivateFile } from '../storage/privateFiles.mjs';

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || 'http://127.0.0.1:5174',
    'Access-Control-Allow-Headers': 'Content-Type, X-Own-Masters-Request',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...extra,
  };
}

function sendBuffer(res, buffer, fileName, contentType, disposition = 'attachment') {
  res.writeHead(200, corsHeaders({
    'Content-Type': contentType,
    'Content-Disposition': `${disposition}; filename="${fileName.replace(/"/g, '')}"`,
    'Content-Length': buffer.length,
    'Access-Control-Expose-Headers': 'Content-Disposition, Content-Type',
  }));
  res.end(buffer);
}

// Use the AI-relabeled stored scan when available, else the raw deterministic
// detection. (Ported from the standalone app's server.mjs.)
function fillFieldsForTemplate(template) {
  if (template.fieldScan?.status === 'complete' && Array.isArray(template.fieldScan.fields)) {
    return mergeStoredFieldScan(template.extractedText || '', template, template.fieldScan.fields);
  }
  return detectTemplateFields(template.extractedText || '', template);
}

async function loadTemplate(id) {
  return prisma.contractFile.findUnique({ where: { id }, include: { fieldScan: true } });
}

async function loadCatalog(userId) {
  return buildLibraryCatalog(await prisma.contractFile.findMany({
    include: { drafts: { where: { userId }, select: { userId: true } } },
  }));
}

async function projectDraftLink(body, userId) {
  if (!body.projectId) return null;
  if (typeof body.projectId !== 'string') throw Object.assign(new Error('Project not found.'), { status: 404 });
  const project = await prisma.musicProject.findFirst({ where: { id: body.projectId, userId } });
  if (!project) throw Object.assign(new Error('Project not found.'), { status: 404 });
  return project.id;
}

function draftContent(template, body) {
  if (Object.hasOwn(body, 'documentHtml')) {
    if (typeof body.documentHtml !== 'string') {
      throw Object.assign(new Error('Enter contract text before saving the draft.'), { status: 400 });
    }
    const html = sanitizeDocumentHtml(body.documentHtml);
    const renderedText = documentHtmlToText(html);
    if (!renderedText.trim()) {
      throw Object.assign(new Error('Enter contract text before saving the draft.'), { status: 400 });
    }
    return { renderedText, values: { __documentHtml: html }, status: 'draft', completion: null };
  }
  // Direct document edits are already plain text. Keep the field-based path for
  // older clients, but never regenerate an edited document from stale values.
  if (Object.hasOwn(body, 'renderedText')) {
    if (typeof body.renderedText !== 'string' || !body.renderedText.trim()) {
      throw Object.assign(new Error('Enter contract text before saving the draft.'), { status: 400 });
    }
    return { renderedText: body.renderedText, values: {}, status: 'draft', completion: null };
  }

  const fields = fillFieldsForTemplate(template);
  const values = body.values || {};
  const completion = completionSummary(fields, values);
  return {
    renderedText: renderPlainText(renderFilledTemplate(template.extractedText || '', fields, values)),
    values,
    status: completion.missingRequired.length ? 'draft' : 'ready',
    completion,
  };
}

/**
 * Handle any /api/filing/* route. Returns true if it matched (and responded),
 * false otherwise so the caller can continue its own dispatch.
 * `ctx` provides { url, sendJson, readBody } from the host server.
 */
export async function handleFilingRoutes(req, res, ctx) {
  const { url, sendJson, readBody, requireAuth } = ctx;
  const { pathname } = url;

  if (!pathname.startsWith('/api/filing/')) return false;
  const auth = await requireAuth(req);
  const userId = auth.user.id;
  if (req.method === 'POST' && (pathname === '/api/filing/upload' || pathname === '/api/filing/import' || pathname === '/api/filing/scan-all' || pathname.endsWith('/scan-fields'))) {
    if (auth.user.app_metadata?.role !== 'admin') {
      sendJson(res, 403, { error: 'Only a library administrator can import or scan shared templates.' });
      return true;
    }
  }

  if (req.method === 'POST' && pathname === '/api/filing/upload') {
    const result = await uploadLibraryDocument(req, url.searchParams.get('name'));
    sendJson(res, result.duplicate ? 200 : 201, result);
    return true;
  }

  if (req.method === 'GET' && (['/api/filing/templates', '/api/filing/summary'].includes(pathname) || /^\/api\/filing\/guides\/[^/]+$/.test(pathname))) {
    try {
      await ensureContractLibrary();
    } catch (error) {
      console.warn(`[contract-library] ${error.message}`);
      sendJson(res, 503, { error: 'The contract library could not be loaded. Please try again.' });
      return true;
    }
  }

  // --- Summary ---
  if (req.method === 'GET' && pathname === '/api/filing/summary') {
    sendJson(res, 200, libraryCatalogSummary(await loadCatalog(userId)));
    return true;
  }

  // --- Read-only guide metadata and accessible text ---
  const guideMatch = pathname.match(/^\/api\/filing\/guides\/([^/]+)$/);
  if (req.method === 'GET' && guideMatch) {
    const guide = await loadTemplate(guideMatch[1]);
    if (!guide || describeLibraryFile(guide).kind !== 'guide') {
      sendJson(res, 404, { error: 'Guide not found.' });
      return true;
    }
    const description = describeLibraryFile(guide);
    sendJson(res, 200, {
      id: guide.id,
      title: description.title,
      originalName: guide.originalName,
      description: description.description,
      format: guide.extension.replace(/^\./, '').toLowerCase(),
      text: guide.extractedText || '',
      readOnly: true,
    });
    return true;
  }

  // --- Import (server-side configured zip path) ---
  if (req.method === 'POST' && pathname === '/api/filing/import') {
    if (!config.contractZipPath) {
      sendJson(res, 400, { error: 'CONTRACT_ZIP_PATH is not set in the environment.' });
      return true;
    }
    const limit = Number(url.searchParams.get('limit') || 0);
    const summary = await importZip(config.contractZipPath, { limit });
    sendJson(res, 200, summary);
    return true;
  }

  // --- Scan all pending/failed field scans ---
  if (req.method === 'POST' && pathname === '/api/filing/scan-all') {
    const force = url.searchParams.get('force') === 'true';
    const limit = Number(url.searchParams.get('limit') || 0);
    const templates = await prisma.contractFile.findMany({
      where: force ? {} : { fieldScan: null },
      orderBy: { originalName: 'asc' },
      include: { fieldScan: true },
      ...(limit ? { take: limit } : {}),
    });
    let scanned = 0;
    for (const template of templates) {
      await persistFieldScan(template);
      scanned += 1;
    }
    sendJson(res, 200, { scanned, total: templates.length });
    return true;
  }

  // --- Templates list ---
  if (req.method === 'GET' && pathname === '/api/filing/templates') {
    const catalog = await loadCatalog(userId);
    const requestedKind = url.searchParams.get('kind') || 'template';
    const entries = filterLibraryCatalog(catalog, {
      query: url.searchParams.get('q') || '',
      kind: ['template', 'guide', 'all'].includes(requestedKind) ? requestedKind : 'template',
      category: url.searchParams.get('category') || '',
      includeDuplicates: url.searchParams.get('includeDuplicates') === 'true',
      commonOnly: url.searchParams.get('commonOnly') === 'true',
    });
    const requestedTake = Number(url.searchParams.get('take') || 250);
    const take = Number.isFinite(requestedTake) ? Math.max(1, Math.min(Math.floor(requestedTake), 300)) : 250;
    sendJson(res, 200, entries.slice(0, take).map((entry) => publicCatalogEntry(entry, userId)));
    return true;
  }

  // --- Drafts list (must match before the templates/:id patterns) ---
  if (req.method === 'GET' && pathname === '/api/filing/drafts') {
    const drafts = await prisma.contractDraft.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, name: true, status: true, updatedAt: true, templateId: true,
        template: { select: { originalName: true, title: true, contractType: true, category: true } },
      },
    });
    sendJson(res, 200, drafts);
    return true;
  }

  // --- Draft download (docx|pdf) ---
  const draftDownloadMatch = pathname.match(/^\/api\/filing\/drafts\/([^/]+)\/download$/);
  if (req.method === 'GET' && draftDownloadMatch) {
    const draft = await prisma.contractDraft.findFirst({ where: { id: draftDownloadMatch[1], userId }, include: { template: true } });
    if (!draft) {
      sendJson(res, 404, { error: 'Draft not found.' });
      return true;
    }
    await billing.requireExports(auth);
    const format = (url.searchParams.get('format') || 'docx').toLowerCase();
    if (draft.values?.__documentHtml) {
      const source = await getTemplateDocument(draft.template);
      const buffer = await exportDocumentHtml(draft.values.__documentHtml, source.layout, format === 'pdf' ? 'pdf' : 'docx');
      sendBuffer(res, buffer, safeDraftFileName(draft.name, format === 'pdf' ? 'pdf' : 'docx'),
        format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      return true;
    }
    if (format === 'pdf') {
      const buffer = await renderDraftPdfBuffer(draft.renderedText, draft.name);
      sendBuffer(res, buffer, safeDraftFileName(draft.name, 'pdf'), 'application/pdf');
    } else {
      const buffer = await renderDraftDocxBuffer(draft.renderedText, draft.name);
      sendBuffer(res, buffer, safeDraftFileName(draft.name, 'docx'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    }
    return true;
  }

  // --- Delete a draft (POST keeps it within the GET/POST CORS allowlist) ---
  const draftDeleteMatch = pathname.match(/^\/api\/filing\/drafts\/([^/]+)\/delete$/);
  if (req.method === 'POST' && draftDeleteMatch) {
    const progress = await prisma.contractProgress.findFirst({ where: { draftId: draftDeleteMatch[1], userId }, include: { signedCopies: true } });
    await prisma.contractDraft.deleteMany({ where: { id: draftDeleteMatch[1], userId } });
    if (progress) await cleanupSignedCopies(progress.signedCopies);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // --- Update a draft (direct document edits or legacy field values) ---
  const draftUpdateMatch = pathname.match(/^\/api\/filing\/drafts\/([^/]+)\/update$/);
  if (req.method === 'POST' && draftUpdateMatch) {
    const existing = await prisma.contractDraft.findFirst({
      where: { id: draftUpdateMatch[1], userId },
      include: { template: { include: { fieldScan: true } } },
    });
    if (!existing) {
      sendJson(res, 404, { error: 'Draft not found.' });
      return true;
    }
    const body = await readBody(req, 1_000_000);
    const { completion, ...content } = draftContent(existing.template, body);
    const projectId = await projectDraftLink(body, userId);
    const name = String(body.name || '').trim() || existing.name;
    const contractType = existing.template.contractType || existing.template.title || 'Contract';
    const draft = await prisma.contractDraft.update({
      where: { id: existing.id, userId },
      data: {
        name,
        ...content,
        projectLinks: {
          updateMany: { where: {}, data: { title: name } },
          ...(projectId ? { upsert: {
            where: { projectId_draftId: { projectId, draftId: existing.id } },
            create: { projectId, title: name, contractType }, update: { title: name, contractType },
          } } : {}),
        },
      },
    });
    sendJson(res, 200, { draft, completion });
    return true;
  }

  // --- Single draft ---
  const draftGetMatch = pathname.match(/^\/api\/filing\/drafts\/([^/]+)$/);
  if (req.method === 'GET' && draftGetMatch) {
    const draft = await prisma.contractDraft.findFirst({ where: { id: draftGetMatch[1], userId }, include: { template: true } });
    if (!draft) {
      sendJson(res, 404, { error: 'Draft not found.' });
      return true;
    }
    sendJson(res, 200, draft);
    return true;
  }

  // --- Template fill schema + initial preview ---
  const fillMatch = pathname.match(/^\/api\/filing\/templates\/([^/]+)\/fill$/);
  if (req.method === 'GET' && fillMatch) {
    const template = await loadTemplate(fillMatch[1]);
    if (!template) {
      sendJson(res, 404, { error: 'Template not found.' });
      return true;
    }
    const fields = fillFieldsForTemplate(template);
    let document;
    try {
      document = await getTemplateDocument(template);
    } catch (error) {
      console.warn(`[contract-layout] ${error.message}`);
      sendJson(res, 422, { error: 'The original template layout could not be loaded. Check that the imported source file is available and LibreOffice is installed for Word templates.' });
      return true;
    }
    sendJson(res, 200, {
      template: {
        id: template.id,
        originalName: template.originalName,
        title: template.title || template.originalName,
        contractType: template.contractType,
        category: template.category,
        summary: template.summary,
      },
      fields,
      preview: renderPreviewHtml(renderFilledTemplate(template.extractedText || '', fields, {})),
      renderedText: document.text,
      documentHtml: document.html,
      documentLayout: document.layout,
    });
    return true;
  }

  // --- Live preview ---
  const previewMatch = pathname.match(/^\/api\/filing\/templates\/([^/]+)\/preview$/);
  if (req.method === 'POST' && previewMatch) {
    const template = await loadTemplate(previewMatch[1]);
    if (!template) {
      sendJson(res, 404, { error: 'Template not found.' });
      return true;
    }
    const body = await readBody(req);
    const fields = fillFieldsForTemplate(template);
    const values = body.values || {};
    const rendered = renderFilledTemplate(template.extractedText || '', fields, values);
    sendJson(res, 200, {
      renderedText: renderPlainText(rendered),
      renderedHtml: renderPreviewHtml(rendered),
      completion: completionSummary(fields, values),
    });
    return true;
  }

  // --- Save filled draft ---
  const draftsMatch = pathname.match(/^\/api\/filing\/templates\/([^/]+)\/drafts$/);
  if (req.method === 'POST' && draftsMatch) {
    const template = await loadTemplate(draftsMatch[1]);
    if (!template) {
      sendJson(res, 404, { error: 'Template not found.' });
      return true;
    }
    const body = await readBody(req, 1_000_000);
    const { completion, ...content } = draftContent(template, body);
    const projectId = await projectDraftLink(body, userId);
    const name =
      String(body.name || '').trim() ||
      `${template.title || template.originalName} - filled ${new Date().toISOString().slice(0, 10)}`;

    const draft = await prisma.contractDraft.create({
      data: {
        templateId: template.id,
        userId,
        name,
        ...content,
        ...(projectId ? { projectLinks: { create: {
          projectId, title: name, contractType: template.contractType || template.title || 'Contract',
        } } } : {}),
      },
    });
    sendJson(res, 200, { draft, completion });
    return true;
  }

  // --- Scan one template's fields ---
  const scanMatch = pathname.match(/^\/api\/filing\/templates\/([^/]+)\/scan-fields$/);
  if (req.method === 'POST' && scanMatch) {
    const template = await loadTemplate(scanMatch[1]);
    if (!template) {
      sendJson(res, 404, { error: 'Template not found.' });
      return true;
    }
    const scan = await persistFieldScan(template);
    sendJson(res, 200, { fieldScan: scan });
    return true;
  }

  // --- Single template detail ---
  const originalMatch = pathname.match(/^\/api\/filing\/templates\/([^/]+)\/original$/);
  if (req.method === 'GET' && originalMatch) {
    const template = await loadTemplate(originalMatch[1]);
    if (!template) {
      sendJson(res, 404, { error: 'Template not found.' });
      return true;
    }
    if (describeLibraryFile(template).kind !== 'guide') await billing.requireExports(auth);
    const buffer = await fs.readFile(await ensurePrivateFile(template.storedPath));
    sendBuffer(res, buffer, template.originalName, template.extension === '.pdf' ? 'application/pdf' : 'application/octet-stream', template.extension === '.pdf' ? 'inline' : 'attachment');
    return true;
  }

  const getMatch = pathname.match(/^\/api\/filing\/templates\/([^/]+)$/);
  if (req.method === 'GET' && getMatch) {
    const template = await loadTemplate(getMatch[1]);
    if (!template) {
      sendJson(res, 404, { error: 'Template not found.' });
      return true;
    }
    sendJson(res, 200, template);
    return true;
  }

  return false;
}

async function persistFieldScan(template) {
  const result = await scanTemplateFieldsWithAI(template);
  return prisma.contractTemplateFieldScan.upsert({
    where: { templateId: template.id },
    create: {
      templateId: template.id,
      status: result.status,
      analyzerModel: result.analyzerModel,
      fields: result.fields,
      warnings: result.warnings || [],
    },
    update: {
      status: result.status,
      analyzerModel: result.analyzerModel,
      fields: result.fields,
      warnings: result.warnings || [],
    },
  });
}
