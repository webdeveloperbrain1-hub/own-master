import { mkdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { prisma } from '../prisma.mjs';
import { ensureContractStorage } from './storagePaths.mjs';
import { detectBlankCandidates, normalizeText } from './templateParser.mjs';
import { persistPrivateFile } from '../storage/privateFiles.mjs';

const blankPlaceholder = '________________';

function answer(value) {
  return String(value ?? '').trim();
}

function safeFileName(value = '') {
  return String(value || 'generated-contract')
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 100) || 'generated-contract';
}

function schemaFields(fieldSchema = {}) {
  return Array.isArray(fieldSchema.fields) ? fieldSchema.fields : [];
}

function missingRequiredFields(fields, dealData = {}) {
  return fields
    .filter((field) => field.required && !answer(dealData[field.key]))
    .map((field) => ({
      key: field.key,
      label: field.label,
      category: field.category ?? 'other',
    }));
}

// Map every blank candidate id (e.g. "blank_004") to the field that claims it
// via candidateIds, plus the resolved value. A field may own several blanks.
function buildBlankValueMap(fields, dealData) {
  const byBlankId = new Map();

  for (const field of fields) {
    const value = answer(dealData[field.key]);
    const candidateIds = Array.isArray(field.candidateIds) ? field.candidateIds : [];

    for (const candidateId of candidateIds) {
      // First field to claim a blank wins (schemas are de-duped upstream).
      if (!byBlankId.has(candidateId)) {
        byBlankId.set(candidateId, { field, value });
      }
    }
  }

  return byBlankId;
}

// Render a single value into a blank, preserving the symbol that lives in the
// blank's source text ($, %, parentheses) so "$____" -> "$5,000", "____%" ->
// "20%", "(____)" -> "(value)". Everything else is a straight substitution.
function renderBlankValue(candidate, value) {
  switch (candidate.kind) {
    case 'money_blank': {
      const stripped = value.replace(/^\s*\$\s*/, '');
      return candidate.sourceText.includes('(') ? `($${stripped})` : `$${stripped}`;
    }
    case 'percent_blank':
      return `${value.replace(/\s*%\s*$/, '')}%`;
    case 'parenthetical_blank':
      return `(${value})`;
    case 'label_colon_blank':
      // sourceText is the label itself (e.g. "City:"); keep it and append the value.
      return `${candidate.sourceText} ${value}`;
    default:
      return value;
  }
}

// Fill blanks by candidate id rather than by position-in-sequence. We re-run
// the SAME detector the scanner used, so the k-th blank here is the same
// blank_00k stored in the schema's candidateIds. Each blank is spliced in place
// (back-to-front so earlier offsets stay valid); blanks with no mapped field or
// no value are left visible.
function fillBlanksByCandidates(baseText, fields, dealData) {
  const normalized = normalizeText(baseText);
  const candidates = detectBlankCandidates(baseText);

  if (!candidates.length) {
    return { text: normalized, filledCount: 0, blankCount: 0 };
  }

  const byBlankId = buildBlankValueMap(fields, dealData);
  let output = normalized;
  let filledCount = 0;

  // Splice from the last blank to the first so positions remain valid.
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidate = candidates[i];
    const mapping = byBlankId.get(candidate.id);
    if (!mapping || !mapping.value) continue;

    const start = candidate.position;
    const end = start + candidate.sourceText.length;
    output = output.slice(0, start) + renderBlankValue(candidate, mapping.value) + output.slice(end);
    filledCount += 1;
  }

  return { text: output, filledCount, blankCount: candidates.length };
}

function renderFilledText(template, fields, dealData) {
  if (template.extractedText?.trim()) {
    return fillBlanksByCandidates(template.extractedText, fields, dealData).text;
  }

  // No source text available: emit a labelled summary of the provided data.
  return [
    template.name,
    '',
    'Template text was not available. The generated contract captures the submitted deal data below.',
    '',
    ...fields.map((field) => `${field.label}: ${answer(dealData[field.key]) || blankPlaceholder}`),
  ].join('\n');
}

function textToDocx(text, title) {
  const paragraphs = String(text || title)
    .split(/\n/)
    .map((line) => new Paragraph({
      spacing: { after: line.trim() ? 120 : 180 },
      children: [
        new TextRun({
          text: line || ' ',
          font: 'Times New Roman',
          size: 24,
        }),
      ],
    }));

  return new Document({
    creator: 'Own Masters',
    title,
    sections: [{ children: paragraphs }],
  });
}

export async function fillContractTemplate({ userId, templateId, dealData = {}, title } = {}) {
  if (!userId) throw Object.assign(new Error('Authentication required.'), { status: 401 });
  const template = await prisma.contractTemplate.findUnique({ where: { id: templateId } });

  if (!template) {
    throw Object.assign(new Error('Contract template not found.'), { status: 404 });
  }

  const fields = schemaFields(template.fieldSchema);
  const missing = missingRequiredFields(fields, dealData);
  const warnings = [
    ...(Array.isArray(template.warnings) ? template.warnings : []),
    ...(missing.length ? [{ type: 'missing_required_fields', message: 'Some required fields were not provided.', fields: missing }] : []),
  ];
  const outputTitle = title || `${template.name} - Generated`;
  const filledText = renderFilledText(template, fields, dealData);
  const paths = await ensureContractStorage();
  const outputDir = resolve(paths.generatedDir);

  await mkdir(outputDir, { recursive: true });

  const generated = await prisma.generatedContract.create({
    data: {
      userId,
      templateId: template.id,
      title: outputTitle,
      dealData,
      outputDocxPath: 'pending',
      missingRequiredFields: missing,
      warnings,
    },
  });
  const outputDocxPath = resolve(outputDir, `${safeFileName(`${outputTitle}-${generated.id}`)}.docx`);
  const doc = textToDocx(filledText, outputTitle);
  const buffer = await Packer.toBuffer(doc);

  await import('node:fs/promises').then(({ writeFile }) => writeFile(outputDocxPath, buffer));
  await persistPrivateFile(outputDocxPath);

  const updated = await prisma.generatedContract.update({
    where: { id: generated.id },
    data: { outputDocxPath },
  });

  return {
    generatedContractId: updated.id,
    outputDocxPath,
    downloadFileName: basename(outputDocxPath),
    warnings,
    missingRequiredFields: missing,
  };
}
