import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { handleAuthRoutes, requireLocalAuth, assertTrustedMutation } from './lib/auth/localAuth.mjs';
import { assertProductionAuthConfiguration } from './lib/auth/authConfiguration.mjs';
import { handleAccountContractRoutes, ownedAccountContract } from './lib/contracts/accountContracts.mjs';
import { loadEnv } from './lib/env.mjs';
import { prisma } from './lib/prisma.mjs';
import {
  explainContractClause,
  generateBlankIntakeWithAI,
  generateTemplateIntakeWithAI,
  recommendContractTemplateWithAI,
  reviewContractRiskWithAI,
} from './lib/ai/contractAssistant.mjs';
import { approvedTemplates, getTemplateById, getTemplateSchema, getTemplateSource } from './lib/contracts/templates.mjs';
import { detectLocalRiskFlags } from './lib/contracts/riskFlags.mjs';
import { renderStructuredDraftFromTemplate } from './lib/contracts/templateRenderer.mjs';
import { validateTemplateInputValue } from './lib/contracts/scanTemplateConfig.mjs';
import { importContractZipToDb } from './lib/contracts/importContractZipToDb.mjs';
import { scanContractTemplate, scanContractTemplates } from './lib/contracts/scanContractTemplateService.mjs';
import { fillContractTemplate } from './lib/contracts/contractFillService.mjs';
import { contractStoragePaths, ensureContractStorage } from './lib/contracts/storagePaths.mjs';
import { handleFilingRoutes } from './lib/contractFiling/filingApi.mjs';
import { ensureContractLibrary } from './lib/contractFiling/libraryLoader.mjs';
import { handleProjectRoutes } from './lib/projects/projectApi.mjs';
import { handleContractProgressRoutes } from './lib/contracts/contractProgress.mjs';
import { handleBillingRoutes } from './lib/billing/billingApi.mjs';
import { billing } from './lib/billing/billingService.mjs';
import { billingConfig } from './lib/billing/billingConfig.mjs';
import { publicSiteConfiguration, productionSiteErrors } from './lib/deployment/siteConfiguration.mjs';
import { createStaticSite } from './lib/deployment/staticSite.mjs';
import { OWN_MASTERS_MAIL_DESIGN } from './lib/mail/letterTemplate.mjs';

loadEnv();
assertProductionAuthConfiguration();
billingConfig();
const production = process.env.NODE_ENV === 'production';
if (production) {
  const errors = productionSiteErrors();
  if (errors.length) throw new Error(errors.join('\n'));
  if (!existsSync(resolve('dist/index.html'))) throw new Error('Build the website with npm run build:production before starting the production server.');
}
const serveWebsite = createStaticSite(resolve('dist'));

const PORT = Number(process.env.PORT || process.env.API_PORT || 8787);

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || 'http://127.0.0.1:5174',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, X-Own-Masters-Request',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, fileName, contentType) {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || 'http://127.0.0.1:5174',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, X-Own-Masters-Request',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Disposition, Content-Type',
  });
  createReadStream(filePath).pipe(res);
}

function templateMetadata(template) {
  return {
    id: template.id,
    name: template.name,
    category: template.category,
    originalFileName: template.originalFileName,
    fileType: template.fileType,
    textQuality: template.textQuality,
    aiScanStatus: template.aiScanStatus,
    approved: template.approved,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    generatedCount: template._count?.generatedContracts,
  };
}

function safeDownloadName(value = '') {
  return String(value || 'generated-contract')
    .replace(/[^a-zA-Z0-9._ -]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140) || 'generated-contract.docx';
}

function isInsideStorage(filePath, storageRoot) {
  const resolvedFile = resolve(filePath);
  const resolvedRoot = resolve(storageRoot);
  return resolvedFile === resolvedRoot || resolvedFile.startsWith(`${resolvedRoot}\\`) || resolvedFile.startsWith(`${resolvedRoot}/`);
}

function readBody(req, maxLength = 80_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');

    req.on('data', (chunk) => {
      body += chunk;

      if (body.length > maxLength) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

const requireAuth = requireLocalAuth;

async function requireContractOwnership(auth, contractId) {
  return ownedAccountContract(auth.user.id, contractId);
}

function trimInput(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function contentTypeFor(extension = '') {
  switch (extension.toLowerCase()) {
    case 'pdf':
      return 'application/pdf';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'rtf':
      return 'application/rtf';
    default:
      return 'application/octet-stream';
  }
}

function normalizeExtension(value = '') {
  return String(value).trim().toLowerCase().replace(/^\./, '');
}

function validateRenderRequest({ template, schema, answers = {}, file }) {
  if (!template) {
    throw Object.assign(new Error('Template not found.'), { status: 404 });
  }

  const extension = normalizeExtension(file?.extension ?? file?.type ?? file?.name?.split('.').pop() ?? '');

  if (extension && !schema.accepted_file_types.includes(extension)) {
    throw Object.assign(new Error(schema.error_messages.unsupported_file_type), { status: 415 });
  }

  const errors = [];

  for (const input of schema.inputs ?? []) {
    const error = validateTemplateInputValue(input, answers[input.id]);

    if (error && input.validation?.blocking) {
      errors.push({ field: input.id, message: error });
    }
  }

  if (errors.length) {
    throw Object.assign(new Error(schema.error_messages.invalid_field_format), { status: 400, details: errors });
  }
}

async function handleRecommend(req, res) {
  await requireAuth(req);
  const body = await readBody(req);
  const userRequest = trimInput(body.userRequest, 2000);

  if (!userRequest) {
    sendJson(res, 400, { error: 'Describe the contract you need first.' });
    return;
  }

  const result = await recommendContractTemplateWithAI({
    userRequest,
    availableTemplates: approvedTemplates,
  });

  sendJson(res, 200, result);
}

async function handleExplain(req, res, contractId) {
  const auth = await requireAuth(req);
  const contract = await requireContractOwnership(auth, contractId);
  const body = await readBody(req);
  const clauseText = trimInput(body.clauseText, 4000);
  const contractType = trimInput(body.contractType || contract?.contractType, 120);

  if (!clauseText) {
    sendJson(res, 400, { error: 'Add clause text to explain.' });
    return;
  }

  const result = await explainContractClause({ clauseText, contractType });
  sendJson(res, 200, result);
}

async function handleRiskReview(req, res, contractId) {
  const auth = await requireAuth(req);
  const contract = await requireContractOwnership(auth, contractId);
  const body = await readBody(req);
  const contractText = trimInput(body.contractText || contract?.content, 12000);
  const contractType = trimInput(body.contractType || contract?.contractType, 120);
  const existingRiskFlags = detectLocalRiskFlags(contractText);

  const result = await reviewContractRiskWithAI({
    contractText,
    contractType,
    existingRiskFlags,
  });

  if (contract) {
    await prisma.accountContract.update({ where: { id: contract.id }, data: { aiRiskReview: result, aiSummary: result.summary, riskFlags: result.riskFlags, lastAiReviewedAt: new Date() } });
  }

  sendJson(res, 200, result);
}

async function handleListLocalTemplates(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const includeAll = url.searchParams.get('includeAll') === 'true';

  const templates = await prisma.contractTemplate.findMany({
    where: includeAll
      ? {}
      : {
          approved: true,
          aiScanStatus: 'scanned',
        },
    orderBy: [{ createdAt: 'desc' }],
    include: { _count: { select: { generatedContracts: true } } },
  });

  sendJson(res, 200, { templates: templates.map(templateMetadata) });
}

async function handleGetLocalTemplate(_req, res, templateId) {
  const template = await prisma.contractTemplate.findUnique({
    where: { id: templateId },
    include: { _count: { select: { generatedContracts: true } } },
  });

  if (!template) {
    sendJson(res, 404, { error: 'Contract template not found.' });
    return;
  }

  sendJson(res, 200, {
    template: {
      ...templateMetadata(template),
      fieldSchema: template.fieldSchema,
      warnings: template.warnings,
      scanError: template.scanError,
      extractedText: template.extractedText,
      extractedTextPreview: template.extractedText?.slice(0, 3000) ?? null,
    },
  });
}

async function handleImportZip(req, res) {
  const body = await readBody(req);
  const paths = await ensureContractStorage();
  const zipPath = body.zipPath
    ? resolve(process.cwd(), String(body.zipPath))
    : resolve(paths.zipDir, 'all-music-contracts.zip');
  const summary = await importContractZipToDb({ zipPath, outputDir: paths.templateDir });

  sendJson(res, 200, {
    summary: {
      totalEntries: summary.totalEntries,
      importedCount: summary.importedCount,
      skippedCount: summary.skippedCount,
      errors: summary.errors,
      imported: summary.imported.map(({ id, name }) => ({ id, name })),
    },
  });
}

async function handleScanOne(_req, res, templateId) {
  const template = await scanContractTemplate(templateId);

  sendJson(res, 200, {
    template: {
      ...templateMetadata(template),
      fieldSchema: template.fieldSchema,
      warnings: template.warnings,
      scanError: template.scanError,
      extractedText: template.extractedText,
      extractedTextPreview: template.extractedText?.slice(0, 3000) ?? null,
    },
  });
}

async function handleApproveTemplate(_req, res, templateId) {
  const existing = await prisma.contractTemplate.findUnique({
    where: { id: templateId },
    include: { _count: { select: { generatedContracts: true } } },
  });

  if (!existing) {
    sendJson(res, 404, { error: 'Contract template not found.' });
    return;
  }

  if (!existing.fieldSchema || !Array.isArray(existing.fieldSchema.fields) || existing.fieldSchema.fields.length === 0) {
    sendJson(res, 400, { error: 'Scan this template before approving it.' });
    return;
  }

  const template = await prisma.contractTemplate.update({
    where: { id: templateId },
    data: {
      approved: true,
      aiScanStatus: 'scanned',
      scanError: null,
    },
    include: { _count: { select: { generatedContracts: true } } },
  });

  sendJson(res, 200, {
    template: {
      ...templateMetadata(template),
      fieldSchema: template.fieldSchema,
      warnings: template.warnings,
      scanError: template.scanError,
      extractedText: template.extractedText,
      extractedTextPreview: template.extractedText?.slice(0, 3000) ?? null,
    },
  });
}

async function handleScanAll(req, res) {
  const body = await readBody(req);
  const results = await scanContractTemplates({ force: Boolean(body.force) });

  sendJson(res, 200, { results });
}

async function handleTemplateSchema(_req, res, templateId) {
  const template = await prisma.contractTemplate.findUnique({ where: { id: templateId } });

  if (!template) {
    sendJson(res, 404, { error: 'Contract template not found.' });
    return;
  }

  sendJson(res, 200, {
    fieldSchema: template.fieldSchema,
    warnings: template.warnings,
    status: template.aiScanStatus,
    approved: template.approved,
  });
}

async function handleFillTemplate(req, res, templateId) {
  const auth = await requireAuth(req);
  await billing.requireExports(auth);
  const body = await readBody(req);
  const result = await fillContractTemplate({
    userId: auth.user.id,
    templateId,
    dealData: body.dealData ?? {},
    title: body.title,
  });

  sendJson(res, 200, {
    generatedContractId: result.generatedContractId,
    downloadUrl: `/api/contracts/generated/${result.generatedContractId}/download`,
    warnings: result.warnings,
    missingRequiredFields: result.missingRequiredFields,
  });
}

async function handleDownloadGenerated(req, res, generatedId) {
  const auth = await requireAuth(req);
  const generated = await prisma.generatedContract.findUnique({
    where: { id: generatedId },
    include: { template: true },
  });

  if (!generated || (generated.userId !== auth.user.id && !(generated.userId === null && auth.user.app_metadata?.role === 'admin'))) {
    sendJson(res, 404, { error: 'Generated contract not found.' });
    return;
  }

  await billing.requireExports(auth);
  const paths = contractStoragePaths();
  const filePath = resolve(generated.outputDocxPath);

  if (!isInsideStorage(filePath, paths.generatedDir) || !existsSync(filePath)) {
    sendJson(res, 404, { error: 'Generated contract file not found.' });
    return;
  }

  sendFile(
    res,
    filePath,
    safeDownloadName(`${generated.title || generated.template.name || basename(filePath)}.docx`),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
}

const server = createServer(async (req, res) => {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (!production) res.setHeader('X-Own-Masters-Mail-Design', OWN_MASTERS_MAIL_DESIGN);
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || 'http://127.0.0.1:5174');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }

    const url = new URL(req.url, 'http://ownmasters.internal');
    if (production && await serveWebsite(req, res, url)) return;
    if (req.method === 'GET' && url.pathname === '/api/site') {
      res.setHeader('Cache-Control', 'no-store');
      sendJson(res, 200, publicSiteConfiguration());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      res.setHeader('Cache-Control', 'no-store');
      try {
        await prisma.$queryRaw`SELECT 1`;
        sendJson(res, 200, { status: 'ok' });
      } catch { sendJson(res, 503, { status: 'unavailable' }); }
      return;
    }
    if (!publicSiteConfiguration().aiEnabled && req.method === 'POST' &&
      /\/(?:recommend-template|explain-clause|review-risk-ai)$/.test(url.pathname)) {
      sendJson(res, 503, { error: 'AI assistance is not available.', code: 'feature_unavailable' });
      return;
    }

    // Stripe authenticates with its signature, not an account cookie or our
    // browser CSRF header. Preserve its raw bytes before any JSON parsing.
    if (url.pathname === '/api/billing/webhook') {
      res.setHeader('Cache-Control', 'no-store');
      await handleBillingRoutes(req, res, { url, sendJson, readBody, requireAuth });
      return;
    }
    assertTrustedMutation(req);
    res.setHeader('Cache-Control', 'no-store');
    if (await handleBillingRoutes(req, res, { url, sendJson, readBody, requireAuth })) return;
    if (await handleAuthRoutes(req, res, { url, sendJson, readBody })) return;
    if (await handleAccountContractRoutes(req, res, { url, sendJson, readBody, requireAuth })) return;
    if (req.method === 'POST' && (url.pathname === '/api/contracts/import-zip' || /\/api\/contracts\/templates\/(?:scan-all|[^/]+\/(?:scan|approve))$/.test(url.pathname))) {
      const auth = await requireAuth(req);
      if (auth.user.app_metadata.role !== 'admin') throw Object.assign(new Error('Administrator access required.'), { status: 403 });
    }

    // Contract Filing engine routes (/api/filing/*). Handled first; returns
    // true when it owns the route.
    if (await handleContractProgressRoutes(req, res, { url, sendJson, readBody, requireAuth })) {
      return;
    }
    if (await handleProjectRoutes(req, res, { url, sendJson, readBody, requireAuth })) {
      return;
    }
    if (await handleFilingRoutes(req, res, { url, sendJson, readBody, requireAuth })) {
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/contracts/templates') {
      await handleListLocalTemplates(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/contracts/import-zip') {
      await handleImportZip(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/contracts/templates/scan-all') {
      await handleScanAll(req, res);
      return;
    }

    const localTemplateSchemaMatch = url.pathname.match(/^\/api\/contracts\/templates\/([^/]+)\/schema$/);
    if (req.method === 'GET' && localTemplateSchemaMatch) {
      await handleTemplateSchema(req, res, localTemplateSchemaMatch[1]);
      return;
    }

    const localTemplateScanMatch = url.pathname.match(/^\/api\/contracts\/templates\/([^/]+)\/scan$/);
    if (req.method === 'POST' && localTemplateScanMatch) {
      await handleScanOne(req, res, localTemplateScanMatch[1]);
      return;
    }

    const localTemplateApproveMatch = url.pathname.match(/^\/api\/contracts\/templates\/([^/]+)\/approve$/);
    if (req.method === 'POST' && localTemplateApproveMatch) {
      await handleApproveTemplate(req, res, localTemplateApproveMatch[1]);
      return;
    }

    const localTemplateFillMatch = url.pathname.match(/^\/api\/contracts\/templates\/([^/]+)\/fill$/);
    if (req.method === 'POST' && localTemplateFillMatch) {
      await handleFillTemplate(req, res, localTemplateFillMatch[1]);
      return;
    }

    const localTemplateGetMatch = url.pathname.match(/^\/api\/contracts\/templates\/([^/]+)$/);
    if (req.method === 'GET' && localTemplateGetMatch) {
      await handleGetLocalTemplate(req, res, localTemplateGetMatch[1]);
      return;
    }

    const generatedDownloadMatch = url.pathname.match(/^\/api\/contracts\/generated\/([^/]+)\/download$/);
    if (req.method === 'GET' && generatedDownloadMatch) {
      await handleDownloadGenerated(req, res, generatedDownloadMatch[1]);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/contracts/recommend-ai') {
      await handleRecommend(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/contracts/templates') {
      await requireAuth(req);
      sendJson(res, 200, {
        templates: approvedTemplates.map(({ keywords, ...template }) => template),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/contracts/template-questions') {
      await requireAuth(req);
      const body = await readBody(req);
      const templateId = trimInput(body.templateId, 160);
      const template = getTemplateById(templateId);
      const source = getTemplateSource(templateId);

      if (!template) {
        sendJson(res, 404, { error: 'Template not found.' });
        return;
      }

      const parserSchema = getTemplateSchema(templateId);
      const hasDetectedBlankFields = parserSchema.questions?.some((question) => question.source === 'detected_blank');
      const templateText = source?.templateText ?? source?.textPreview ?? template.description;
      const schema = hasDetectedBlankFields
        ? (await generateBlankIntakeWithAI({
            template,
            templateText,
            parserSchema,
          })) ?? parserSchema
        : (await generateTemplateIntakeWithAI({
            template,
            templateText,
            parserSchema,
          })) ?? parserSchema;

      sendJson(res, 200, {
        template: {
          id: template.id,
          title: template.title,
          category: template.category,
          sourceFile: source?.sourceFile ?? template.sourceFile,
          extension: source?.extension ?? template.extension,
          extractionQuality: source?.extractionQuality ?? template.extractionQuality ?? 'metadata_only',
          textPreview: source?.textPreview ?? template.description,
        },
        questions: schema.questions,
        schema,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/contracts/render-template') {
      await requireAuth(req);
      const body = await readBody(req);
      const templateId = trimInput(body.templateId, 160);
      const template = getTemplateById(templateId);
      const schema = getTemplateSchema(templateId);

      validateRenderRequest({
        template,
        schema,
        answers: body.answers ?? {},
        file: body.file,
      });

      const result = renderStructuredDraftFromTemplate({
        templateId,
        template,
        schema,
        answers: body.answers ?? {},
        userRequest: trimInput(body.userRequest, 2000),
      });

      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/contracts/template-file') {
      const auth = await requireAuth(req);
      await billing.requireExports(auth);
      const body = await readBody(req);
      const templateId = trimInput(body.templateId, 160);
      const source = getTemplateSource(templateId);

      if (!source?.sourceFile) {
        sendJson(res, 404, { error: 'Template source file not found.' });
        return;
      }

      const sourceRoot = resolve(process.cwd(), 'server/data/contract-library-source');
      const filePath = resolve(sourceRoot, source.sourceFile);

      if (!filePath.startsWith(sourceRoot) || !existsSync(filePath)) {
        sendJson(res, 404, { error: 'Template source file not found.' });
        return;
      }

      sendFile(res, filePath, source.sourceFile.split('/').pop(), contentTypeFor(source.extension));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/contracts/template-preview') {
      await requireAuth(req);
      const body = await readBody(req);
      const templateId = trimInput(body.templateId, 160);
      const source = getTemplateSource(templateId);

      if (!source) {
        sendJson(res, 404, { error: 'Template preview not found.' });
        return;
      }

      sendJson(res, 200, {
        id: source.id,
        title: source.title,
        sourceFile: source.sourceFile,
        extension: source.extension,
        extractionQuality: source.extractionQuality,
        preferredSourceId: source.preferredSourceId ?? source.id,
        templateText: source.templateText,
      });
      return;
    }

    const explainMatch = url.pathname.match(/^\/api\/contracts\/([^/]+)\/explain-clause$/);
    if (req.method === 'POST' && explainMatch) {
      await handleExplain(req, res, explainMatch[1]);
      return;
    }

    const riskMatch = url.pathname.match(/^\/api\/contracts\/([^/]+)\/review-risk-ai$/);
    if (req.method === 'POST' && riskMatch) {
      await handleRiskReview(req, res, riskMatch[1]);
      return;
    }

    sendJson(res, 404, { error: 'Not found.' });
  } catch (error) {
    const status = error.status || 500;
    if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
    const message = status >= 500 ? 'Own Masters could not complete this request. Please try again.' : error.message;

    if (status >= 500) {
      console.warn(`[own-masters-api] ${error.message}`);
    }

    if (!res.headersSent) sendJson(res, status, { error: error.code === 'email_not_configured' ? error.message : message, code: error.code || '', details: error.details });
  }
});

if (production) {
  await prisma.accountUser.findFirst({ select: { id: true } });
  await ensureContractStorage();
  await ensureContractLibrary();
}
server.listen(PORT, process.env.API_HOST || (production ? '0.0.0.0' : '127.0.0.1'), () => {
  console.log(`[own-masters] listening on port ${PORT}`);
  if (!production) void ensureContractLibrary()
    .then((result) => console.log(`[contract-library] ready (${result.imported} added, ${result.duplicates} already loaded)`))
    .catch((error) => console.warn(`[contract-library] automatic loading failed: ${error.message}`));
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  server.close(async () => { await prisma.$disconnect(); clearTimeout(deadline); });
  server.closeIdleConnections();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
