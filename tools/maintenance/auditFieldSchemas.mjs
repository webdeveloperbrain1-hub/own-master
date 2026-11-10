import { loadEnv } from '../../server/lib/env.mjs';
import { prisma } from '../../server/lib/prisma.mjs';

loadEnv();

const templates = await prisma.contractTemplate.findMany({
  orderBy: { createdAt: 'asc' },
});

const genericKey = /^(blank|field)\d*$/i;
const stats = {
  total: templates.length,
  bySource: {},
  byStatus: {},
  zeroFields: [],
  genericHeavy: [], // >30% generic keys
  lowConfHeavy: [], // >50% low confidence
  noText: [], // no extracted text at all
  warningTypes: {},
  fieldCount: [],
};

for (const t of templates) {
  const schema = t.fieldSchema || {};
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  const warnings = Array.isArray(t.warnings) ? t.warnings : (Array.isArray(schema.warnings) ? schema.warnings : []);
  const source = schema.source || 'unknown';

  stats.bySource[source] = (stats.bySource[source] || 0) + 1;
  stats.byStatus[t.aiScanStatus] = (stats.byStatus[t.aiScanStatus] || 0) + 1;
  stats.fieldCount.push(fields.length);

  if (!String(t.extractedText || '').trim()) stats.noText.push(t.name);
  if (fields.length === 0) stats.zeroFields.push(t.name);

  const generic = fields.filter((f) => genericKey.test(f.key || '')).length;
  const low = fields.filter((f) => f.confidence === 'low').length;
  if (fields.length >= 3 && generic / fields.length > 0.3) {
    stats.genericHeavy.push(`${t.name} (${generic}/${fields.length} generic)`);
  }
  if (fields.length >= 3 && low / fields.length > 0.5) {
    stats.lowConfHeavy.push(`${t.name} (${low}/${fields.length} low-conf)`);
  }

  for (const w of warnings) {
    const ty = w?.type || 'unknown';
    stats.warningTypes[ty] = (stats.warningTypes[ty] || 0) + 1;
  }
}

const counts = stats.fieldCount.sort((a, b) => a - b);
const sum = counts.reduce((a, b) => a + b, 0);
const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;

console.log('================ FIELD SCHEMA AUDIT ================');
console.log(`Templates: ${stats.total}`);
console.log('');
console.log('Scan status:', stats.byStatus);
console.log('Schema source (who produced the fields):', stats.bySource);
console.log('');
console.log(`Fields per template -> avg ${(sum / (counts.length || 1)).toFixed(1)}, median ${median}, min ${counts[0] ?? 0}, max ${counts[counts.length - 1] ?? 0}`);
console.log('');
console.log(`Templates with ZERO fields (parser found no blanks): ${stats.zeroFields.length}`);
console.log(stats.zeroFields.slice(0, 15).map((n) => '   - ' + n).join('\n'));
console.log('');
console.log(`Templates with NO extracted text (extraction failed): ${stats.noText.length}`);
console.log(stats.noText.slice(0, 15).map((n) => '   - ' + n).join('\n'));
console.log('');
console.log(`Templates >30% generic field keys (labeling weak): ${stats.genericHeavy.length}`);
console.log(stats.genericHeavy.slice(0, 15).map((n) => '   - ' + n).join('\n'));
console.log('');
console.log(`Templates >50% low-confidence fields: ${stats.lowConfHeavy.length}`);
console.log(stats.lowConfHeavy.slice(0, 10).map((n) => '   - ' + n).join('\n'));
console.log('');
console.log('Warning types across all templates:', stats.warningTypes);

await prisma.$disconnect();
