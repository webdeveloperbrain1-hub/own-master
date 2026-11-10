import { prisma } from '../prisma.mjs';
import { detectBlankCandidates } from './templateParser.mjs';
import { extractContractText } from './extractContractText.mjs';
import { scanFieldsWithAI } from './aiFieldScanner.mjs';
import { ensurePrivateFile } from '../storage/privateFiles.mjs';

export async function scanContractTemplate(templateId) {
  const template = await prisma.contractTemplate.findUnique({ where: { id: templateId } });

  if (!template) {
    throw Object.assign(new Error('Contract template not found.'), { status: 404 });
  }

  await prisma.contractTemplate.update({
    where: { id: templateId },
    data: { aiScanStatus: 'scanning', scanError: null },
  });

  try {
    const extracted = await extractContractText(await ensurePrivateFile(template.storagePath));
    const blankCandidates = detectBlankCandidates(extracted.text);
    const fieldSchema = await scanFieldsWithAI({
      contractText: extracted.text,
      blankCandidates,
    });
    const warnings = [
      ...extracted.warnings.map((message) => ({ type: 'text_extraction', message })),
      ...(fieldSchema.warnings ?? []),
    ];

const status = 'scanned';

return await prisma.contractTemplate.update({
  where: { id: templateId },
  data: {
    extractedText: extracted.text,
    textQuality: extracted.textQuality,
    fieldSchema,
    warnings,
    aiScanStatus: status,
    approved: true,
  },
});
  } catch (error) {
    await prisma.contractTemplate.update({
      where: { id: templateId },
      data: {
        aiScanStatus: 'failed',
        scanError: error.message,
      },
    });
    throw error;
  }
}

export async function scanContractTemplates({ force = false } = {}) {
  const staleScanningCutoff = new Date(Date.now() - 15 * 60 * 1000);

  const templates = await prisma.contractTemplate.findMany({
    where: force
      ? {}
      : {
          OR: [
            { aiScanStatus: { in: ['not_scanned', 'needs_review', 'failed'] } },
            { aiScanStatus: 'scanning', updatedAt: { lt: staleScanningCutoff } },
          ],
        },
    orderBy: { createdAt: 'asc' },
  });
  const results = [];

  for (const template of templates) {
    try {
      const scanned = await scanContractTemplate(template.id);
      results.push({ id: template.id, name: template.name, status: scanned.aiScanStatus });
    } catch (error) {
      results.push({ id: template.id, name: template.name, status: 'failed', error: error.message });
    }
  }

  return results;
}
