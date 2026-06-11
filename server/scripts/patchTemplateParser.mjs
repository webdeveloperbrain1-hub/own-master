import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const filePath = resolve('server/lib/contracts/templateParser.mjs');

let source = await readFile(filePath, 'utf8');

const oldFieldTypes = `const FIELD_TYPES = new Set(['text', 'textarea', 'number', 'percentage', 'currency', 'dropdown', 'checkbox', 'radio', 'date', 'list', 'count']);`;

const newFieldTypes = `const FIELD_TYPES = new Set([
  'text',
  'textarea',
  'number',
  'percentage',
  'currency',
  'dropdown',
  'checkbox',
  'radio',
  'date',
  'list',
  'count',
  'signature',
]);`;

if (source.includes(oldFieldTypes)) {
  source = source.replace(oldFieldTypes, newFieldTypes);
  console.log('Updated FIELD_TYPES.');
} else {
  console.log('FIELD_TYPES already updated or not found.');
}

const helpers = `
function lineInfoAroundIndex(text, index) {
  const before = text.slice(0, index);
  const lineNumber = before.split('\\n').length;

  const lineStart = text.lastIndexOf('\\n', Math.max(0, index - 1)) + 1;
  const nextBreak = text.indexOf('\\n', index);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;

  const fullLine = text.slice(lineStart, lineEnd).trim();

  const previousLineStart = text.lastIndexOf('\\n', Math.max(0, lineStart - 2)) + 1;
  const previousLine = text.slice(previousLineStart, Math.max(0, lineStart - 1)).trim();

  const nextLineStart = lineEnd + 1;
  const nextLineBreak = text.indexOf('\\n', nextLineStart);
  const nextLineEnd = nextLineBreak === -1 ? text.length : nextLineBreak;
  const nextLine = text.slice(nextLineStart, nextLineEnd).trim();

  return {
    lineNumber,
    fullLine,
    previousLine,
    nextLine,
  };
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function shouldSkipOverlappingRange(ranges, start, end) {
  return ranges.some((range) => rangesOverlap(start, end, range.start, range.end));
}

function normalizeBlankCandidateType(kind, label, context) {
  const lower = \`\${kind} \${label} \${context}\`.toLowerCase();

  if (/signature|signed|accepted|agreed/.test(lower)) return 'signature';
  if (/date|dated|day of|effective|20__|20____/.test(lower)) return 'date';
  if (/money|amount|advance|fee|payment|deposit|\\$/.test(lower)) return 'currency';
  if (/percent|percentage|royalty|commission|points|%/.test(lower)) return 'percentage';
  if (/address|location/.test(lower)) return 'textarea';
  if (/number|count/.test(lower)) return 'number';

  return 'text';
}

`;

if (!source.includes('function lineInfoAroundIndex')) {
  source = source.replace('export function detectBlankCandidates', `${helpers}export function detectBlankCandidates`);
  console.log('Inserted helper functions.');
} else {
  console.log('Helper functions already exist.');
}

const detectStart = source.indexOf('export function detectBlankCandidates');
const detectEnd = source.indexOf('\nfunction hintFor', detectStart);

if (detectStart === -1 || detectEnd === -1) {
  throw new Error('Could not find detectBlankCandidates block.');
}

const newDetectBlankCandidates = `export function detectBlankCandidates(text = '') {
  const normalized = normalizeText(text);
  const candidates = [];
  const seen = new Set();
  const usedRanges = [];

  /**
   * Specific patterns should come before the generic underscore pattern.
   * That prevents "20____" or "____%" from being mislabeled as plain underscore blanks.
   */
  const patterns = [
    { kind: 'money_blank', regex: /\\$\\s*_{2,}|\\(\\s*\\$\\s*[_\\s]{3,}\\)/g },
    { kind: 'percent_blank', regex: /_{2,}\\s*%/g },
    { kind: 'date_fragment', regex: /\\b(?:19|20)_{2,}\\b/g },
    { kind: 'parenthetical_blank', regex: /\\(\\s*[_\\s]{4,}\\)/g },
    { kind: 'bracket_placeholder', regex: /\\[\\s*[A-Z0-9_ -]{2,}\\s*\\]/gi },
    { kind: 'mustache_placeholder', regex: /\\{\\{\\s*[^}]+\\s*\\}\\}/g },
    { kind: 'underscore_blank', regex: /_{3,}/g },
  ];

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;

    for (const match of normalized.matchAll(pattern.regex)) {
      const index = match.index ?? 0;
      const sourceText = match[0];
      const start = index;
      const end = index + sourceText.length;
      const key = \`\${start}:\${end}:\${sourceText}\`;

      if (seen.has(key)) {
        continue;
      }

      /**
       * Avoid duplicate candidates when a specific pattern and generic underscore
       * pattern match the same characters.
       */
      if (shouldSkipOverlappingRange(usedRanges, start, end)) {
        continue;
      }

      seen.add(key);
      usedRanges.push({ start, end });

      const lineInfo = lineInfoAroundIndex(normalized, index);

      const surroundingContext = [
        lineInfo.previousLine,
        lineInfo.fullLine,
        lineInfo.nextLine,
      ]
        .filter(Boolean)
        .join('\\n')
        .replace(/[ \\t]+/g, ' ')
        .trim();

      const label = labelForBlank(normalized, index, sourceText.length, candidates.length);
      const guessedType = normalizeBlankCandidateType(
        pattern.kind,
        label,
        surroundingContext,
      );

      candidates.push({
        id: \`blank_\${String(candidates.length + 1).padStart(3, '0')}\`,
        sourceText,
        fullLine: lineInfo.fullLine,
        surroundingContext,
        guessedType,
        position: index,
        order: candidates.length + 1,
        lineNumber: lineInfo.lineNumber,
        kind: pattern.kind,
      });
    }
  }

  return candidates
    .sort((a, b) => a.position - b.position)
    .map((candidate, index) => ({
      ...candidate,
      id: \`blank_\${String(index + 1).padStart(3, '0')}\`,
      order: index + 1,
    }));
}
`;

source = `${source.slice(0, detectStart)}${newDetectBlankCandidates}${source.slice(detectEnd)}`;
console.log('Replaced detectBlankCandidates.');

const oldLabelBlock = `  if (/producer/.test(context) && /signature|signed|accepted|sincerely/.test(context)) return 'Producer signature name';
  if (/artist/.test(context) && /signature|signed|accepted/.test(context)) return 'Artist signature name';
  if (/company|label|record company/.test(context) && /signature|signed|accepted/.test(context)) return 'Company signature name';
  if (/producer/.test(context) && !/royalt|percent/.test(context)) return 'Producer name';
  if (/artist|performer|musician/.test(context)) return 'Artist or musician name';
  if (/company|label|employer|promoter|venue/.test(context)) return 'Company, employer, or venue name';`;

const newLabelBlock = `  if (/publisher/.test(context) && /address/.test(context)) return 'Publisher address';
  if (/publisher/.test(context) && /signature|signed|accepted|sincerely/.test(context)) return 'Publisher signature name';
  if (/publisher/.test(context)) return 'Publisher name';

  if (/writer|songwriter|composer/.test(context) && /address/.test(context)) return 'Writer address';
  if (/writer|songwriter|composer/.test(context) && /signature|signed|accepted|sincerely/.test(context)) return 'Writer signature name';
  if (/writer|songwriter|composer/.test(context)) return 'Writer name';

  if (/producer/.test(context) && /signature|signed|accepted|sincerely/.test(context)) return 'Producer signature name';
  if (/artist/.test(context) && /signature|signed|accepted/.test(context)) return 'Artist signature name';
  if (/company|label|record company/.test(context) && /signature|signed|accepted/.test(context)) return 'Company signature name';

  if (/producer/.test(context) && !/royalt|percent/.test(context)) return 'Producer name';
  if (/artist|performer|musician/.test(context)) return 'Artist or musician name';
  if (/company|label|employer|promoter|venue/.test(context)) return 'Company, employer, or venue name';`;

if (source.includes(oldLabelBlock)) {
  source = source.replace(oldLabelBlock, newLabelBlock);
  console.log('Improved publisher/writer labels.');
} else {
  console.log('Label block already updated or not found.');
}

const oldSignatureType = `  if (/signature/.test(labelLower)) return 'text';`;
const newSignatureType = `  if (/signature/.test(labelLower)) return 'signature';`;

if (source.includes(oldSignatureType)) {
  source = source.replace(oldSignatureType, newSignatureType);
  console.log('Changed signature blanks to signature type.');
} else {
  console.log('Signature type already updated or not found.');
}

await writeFile(filePath, source, 'utf8');

console.log('\\nDone. templateParser.mjs has been patched.');