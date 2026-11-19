import { prisma } from '../prisma.mjs';

export const approvedTemplateWhere = { approved: true, aiScanStatus: 'scanned' };

export function templateMetadata(template) {
  return {
    id: template.id, name: template.name, category: template.category,
    originalFileName: template.originalFileName, fileType: template.fileType,
    textQuality: template.textQuality, aiScanStatus: template.aiScanStatus,
    approved: template.approved, createdAt: template.createdAt, updatedAt: template.updatedAt,
    generatedCount: template._count?.generatedContracts,
  };
}

export async function handleTemplateLibraryRoutes(req, res, { url, sendJson, requireAuth }) {
  const list = url.pathname === '/api/contracts/templates';
  const detail = url.pathname.match(/^\/api\/contracts\/templates\/([^/]+)(?:\/(schema))?$/);
  if (req.method !== 'GET' || (!list && !detail)) return false;
  const { user } = await requireAuth(req);
  const isAdmin = user.app_metadata?.role === 'admin';
  const includeAll = url.searchParams.get('includeAll') === 'true';
  if (includeAll && !isAdmin)
    throw Object.assign(new Error('Administrator access required.'), { status: 403 });

  // Members see usage for their own generated contracts. Only administrators
  // can inspect the operational total across accounts.
  const include = { _count: { select: { generatedContracts: isAdmin ? true : { where: { userId: user.id } } } } };
  if (list) {
    const templates = await prisma.contractTemplate.findMany({
      where: includeAll ? {} : approvedTemplateWhere,
      orderBy: [{ createdAt: 'desc' }], include,
    });
    sendJson(res, 200, { templates: templates.map(templateMetadata) });
    return true;
  }

  const template = await prisma.contractTemplate.findFirst({
    where: { id: detail[1], ...(isAdmin ? {} : approvedTemplateWhere) }, include,
  });
  if (!template) {
    sendJson(res, 404, { error: 'Contract template not found.' });
    return true;
  }
  sendJson(res, 200, detail[2] ? {
    fieldSchema: template.fieldSchema, warnings: template.warnings,
    status: template.aiScanStatus, approved: template.approved,
  } : { template: {
    ...templateMetadata(template), fieldSchema: template.fieldSchema,
    warnings: template.warnings, scanError: isAdmin ? template.scanError : null,
    extractedText: template.extractedText, extractedTextPreview: template.extractedText?.slice(0, 3000) ?? null,
  } });
  return true;
}
