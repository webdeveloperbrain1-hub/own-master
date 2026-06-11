import { prisma } from '../prisma.mjs';
import { config } from './filingConfig.mjs';
import { importZip, databaseSummary } from './importer.mjs';
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

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || 'http://127.0.0.1:5174',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Own-Masters-Demo',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...extra,
  };
}

function sendBuffer(res, buffer, fileName, contentType) {
  res.writeHead(200, corsHeaders({
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
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

/**
 * Handle any /api/filing/* route. Returns true if it matched (and responded),
 * false otherwise so the caller can continue its own dispatch.
 * `ctx` provides { url, sendJson, readBody } from the host server.
 */
export async function handleFilingRoutes(req, res, ctx) {
  const { url, sendJson, readBody } = ctx;
  const { pathname } = url;

  if (!pathname.startsWith('/api/filing/')) return false;

  // --- Summary ---
  if (req.method === 'GET' && pathname === '/api/filing/summary') {
    sendJson(res, 200, await databaseSummary());
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
    const q = String(url.searchParams.get('q') || '').trim();
    const where = q
      ? {
          OR: [
            { originalName: { contains: q, mode: 'insensitive' } },
            { title: { contains: q, mode: 'insensitive' } },
            { contractType: { contains: q, mode: 'insensitive' } },
            { category: { contains: q, mode: 'insensitive' } },
            { extractedText: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};

    const templates = await prisma.contractFile.findMany({
      where,
      orderBy: [{ originalName: 'asc' }],
      take: Math.min(Number(url.searchParams.get('take') || 250), 300),
      select: {
        id: true,
        originalName: true,
        title: true,
        contractType: true,
        category: true,
        summary: true,
        textLength: true,
        _count: { select: { drafts: true } },
      },
    });

    sendJson(res, 200, templates.map((t) => ({
      id: t.id,
      originalName: t.originalName,
      title: t.title || t.originalName,
      contractType: t.contractType,
      category: t.category,
      summary: t.summary,
      textLength: t.textLength,
      draftCount: t._count.drafts,
    })));
    return true;
  }

  // --- Drafts list (must match before the templates/:id patterns) ---
  if (req.method === 'GET' && pathname === '/api/filing/drafts') {
    const drafts = await prisma.contractDraft.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 80,
      include: { template: { select: { originalName: true, title: true, contractType: true, category: true } } },
    });
    sendJson(res, 200, drafts);
    return true;
  }

  // --- Draft download (docx|pdf) ---
  const draftDownloadMatch = pathname.match(/^\/api\/filing\/drafts\/([^/]+)\/download$/);
  if (req.method === 'GET' && draftDownloadMatch) {
    const draft = await prisma.contractDraft.findUnique({ where: { id: draftDownloadMatch[1] } });
    if (!draft) {
      sendJson(res, 404, { error: 'Draft not found.' });
      return true;
    }
    const format = (url.searchParams.get('format') || 'docx').toLowerCase();
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
    await prisma.contractDraft.deleteMany({ where: { id: draftDeleteMatch[1] } });
    sendJson(res, 200, { ok: true });
    return true;
  }

  // --- Update a draft (re-render from new values) ---
  const draftUpdateMatch = pathname.match(/^\/api\/filing\/drafts\/([^/]+)\/update$/);
  if (req.method === 'POST' && draftUpdateMatch) {
    const existing = await prisma.contractDraft.findUnique({
      where: { id: draftUpdateMatch[1] },
      include: { template: { include: { fieldScan: true } } },
    });
    if (!existing) {
      sendJson(res, 404, { error: 'Draft not found.' });
      return true;
    }
    const body = await readBody(req);
    const fields = fillFieldsForTemplate(existing.template);
    const values = body.values || {};
    const renderedText = renderPlainText(renderFilledTemplate(existing.template.extractedText || '', fields, values));
    const completion = completionSummary(fields, values);
    const draft = await prisma.contractDraft.update({
      where: { id: existing.id },
      data: {
        name: String(body.name || '').trim() || existing.name,
        values,
        renderedText,
        status: completion.missingRequired.length ? 'draft' : 'ready',
      },
    });
    sendJson(res, 200, { draft, completion });
    return true;
  }

  // --- Single draft ---
  const draftGetMatch = pathname.match(/^\/api\/filing\/drafts\/([^/]+)$/);
  if (req.method === 'GET' && draftGetMatch) {
    const draft = await prisma.contractDraft.findUnique({ where: { id: draftGetMatch[1] }, include: { template: true } });
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
    const body = await readBody(req);
    const fields = fillFieldsForTemplate(template);
    const values = body.values || {};
    const renderedText = renderPlainText(renderFilledTemplate(template.extractedText || '', fields, values));
    const completion = completionSummary(fields, values);
    const name =
      String(body.name || '').trim() ||
      `${template.title || template.originalName} - filled ${new Date().toISOString().slice(0, 10)}`;

    const draft = await prisma.contractDraft.create({
      data: {
        templateId: template.id,
        name,
        values,
        renderedText,
        status: completion.missingRequired.length ? 'draft' : 'ready',
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
