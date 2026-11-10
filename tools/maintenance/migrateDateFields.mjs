// Splits already-merged "agreementDate" fields (day/month/year glued into one)
// back into separate Day / Month / Year fields, using each scan's extractedText
// to recover which blank is which. No re-scan / no Ollama needed.
//
// Usage: node tools/maintenance/migrateDateFields.mjs <export-dir> [output-dir]
//   <export-dir>  folder containing one sub-folder per scan, each with
//                 fieldSchema.json + extractedText.txt
//   [output-dir]  where corrected schemas are written (default: <export-dir>-migrated)
//
// Requires templateParser.mjs and postProcessFieldSchema.mjs on the same paths
// your app uses (adjust the two imports below if needed).
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { detectBlankCandidates } from '../../server/lib/contracts/templateParser.mjs';
import { splitDateFragments, makeUniqueKeys } from '../../server/lib/contracts/postProcessFieldSchema.mjs';

const SRC = process.argv[2];
const OUT = process.argv[3] || `${SRC}-migrated`;
if (!SRC) { console.error('Usage: node tools/maintenance/migrateDateFields.mjs <export-dir> [output-dir]'); process.exit(1); }

const looksDate = (f) => {
  const c = String(f.surroundingContext || '').toLowerCase();
  return f.type === 'date' || String(f.key || '').toLowerCase().includes('date')
    || c.includes('day of') || /\b(?:19|20)\s*_{2,}/.test(c);
};
const unmergeDateFields = (fields) => {
  const out = [];
  for (const f of fields) {
    const ids = f.candidateIds || [];
    if (ids.length > 1 && looksDate(f)) {
      const parts = String(f.sourceText || '').split(' | ');
      ids.forEach((id, i) => out.push({ ...f, candidateIds: [id], sourceText: parts[i] || '' }));
    } else out.push(f);
  }
  return out;
};

let changed = 0;
for (const d of readdirSync(SRC, { withFileTypes: true }).filter((e) => e.isDirectory())) {
  const dir = join(SRC, d.name);
  const fsPath = join(dir, 'fieldSchema.json');
  const txtPath = join(dir, 'extractedText.txt');
  if (!existsSync(fsPath) || !existsSync(txtPath)) continue;

  let schema;
  try { schema = JSON.parse(readFileSync(fsPath, 'utf8')); } catch { continue; }
  const fields0 = Array.isArray(schema.fields) ? schema.fields : [];
  if (!fields0.some((f) => looksDate(f) && (f.candidateIds || []).length > 1)) continue;

  const candidateById = new Map(detectBlankCandidates(readFileSync(txtPath, 'utf8')).map((c) => [c.id, c]));
  let fields = fields0.map((f, i) => ({ ...f, __internalId: `field_${i}` }));
  fields = unmergeDateFields(fields).map((f, i) => ({ ...f, __internalId: `field_${i}` }));
  fields = splitDateFragments(fields, candidateById);
  fields = makeUniqueKeys(fields).map(({ __internalId, ...f }) => f);

  const outDir = join(OUT, d.name);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'fieldSchema.json'), JSON.stringify({ ...schema, fields }, null, 2));
  changed += 1;
}
console.log(`Rewrote ${changed} scan schema(s) -> ${OUT}`);
