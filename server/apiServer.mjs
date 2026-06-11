import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
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

loadEnv();

const PORT = Number(process.env.API_PORT || 8787);
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || 'http://127.0.0.1:5174',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Own-Masters-Demo',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, fileName, contentType) {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || 'http://127.0.0.1:5174',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Own-Masters-Demo',
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;

      if (body.length > 80_000) {
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

function createAuthedSupabase(accessToken) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

async function requireAuth(req) {
  const isDemo = process.env.NODE_ENV !== 'production' && req.headers['x-own-masters-demo'] === 'true';

  if (isDemo) {
    return {
      user: { id: 'demo-admin', email: 'admin@ownmasters.local' },
      isDemo: true,
      supabase: null,
    };
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    throw Object.assign(new Error('Supabase server configuration is missing.'), { status: 500 });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

  if (!token) {
    throw Object.assign(new Error('Authentication required.'), { status: 401 });
  }

  const authedSupabase = createAuthedSupabase(token);
  const { data, error } = await authedSupabase.auth.getUser(token);

  if (error || !data.user) {
    throw Object.assign(new Error('Authentication required.'), { status: 401 });
  }

  return {
    user: data.user,
    isDemo: false,
    supabase: authedSupabase,
  };
}

async function requireContractOwnership(auth, contractId) {
  if (auth.isDemo) {
    if (!contractId.startsWith('demo-contract-')) {
      throw Object.assign(new Error('Contract not found.'), { status: 404 });
    }

    return null;
  }

  const { data, error } = await auth.supabase
    .from('contracts')
    .select('id,user_id,title,contract_type,content')
    .eq('id', contractId)
    .single();

  if (error || !data) {
    throw Object.assign(new Error('Contract not found.'), { status: 404 });
  }

  return data;
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
  const contractType = trimInput(body.contractType || contract?.contract_type, 120);

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
  const contractType = trimInput(body.contractType || contract?.contract_type, 120);
  const existingRiskFlags = detectLocalRiskFlags(contractText);

  const result = await reviewContractRiskWithAI({
    contractText,
    contractType,
    existingRiskFlags,
  });

  if (!auth.isDemo && contract) {
    await auth.supabase
      .from('contracts')
      .update({
        ai_risk_review: result,
        ai_summary: result.summary,
        risk_flags: result.riskFlags,
        last_ai_reviewed_at: new Date().toISOString(),
      })
      .eq('id', contractId);
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
  const body = await readBody(req);
  const result = await fillContractTemplate({
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

async function handleDownloadGenerated(_req, res, generatedId) {
  const generated = await prisma.generatedContract.findUnique({
    where: { id: generatedId },
    include: { template: true },
  });

  if (!generated) {
    sendJson(res, 404, { error: 'Generated contract not found.' });
    return;
  }

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
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    // Contract Filing engine routes (/api/filing/*). Handled first; returns
    // true when it owns the route.
    if (await handleFilingRoutes(req, res, { url, sendJson, readBody })) {
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
      await requireAuth(req);
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
    const message = status >= 500 ? 'The Own Masters AI service is unavailable right now.' : error.message;

    if (status >= 500) {
      console.warn(`[own-masters-api] ${error.message}`);
    }

    sendJson(res, status, { error: message, details: error.details });
  }
});

server.listen(PORT, () => {
  console.log(`[own-masters-api] listening on http://127.0.0.1:${PORT}`);
});
