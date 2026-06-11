import { loadEnv } from '../lib/env.mjs';
import { prisma } from '../lib/prisma.mjs';
import { config } from '../lib/contractFiling/filingConfig.mjs';
import { importZip } from '../lib/contractFiling/importer.mjs';
import { scanTemplateFieldsWithAI } from '../lib/contractFiling/fieldContextScanner.mjs';

loadEnv();

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 0;
const skipScan = args.includes('--no-scan');

if (!config.contractZipPath) {
  console.error('CONTRACT_ZIP_PATH is not set in .env');
  process.exit(1);
}

console.log(`Importing from: ${config.contractZipPath}${limit ? ` (limit ${limit})` : ''}`);

const summary = await importZip(config.contractZipPath, {
  limit,
  onProgress: ({ originalName, status }) => process.stdout.write(`  import ${status.padEnd(13)} ${originalName}\n`),
});

console.log(`\nImport done. imported=${summary.imported} duplicates=${summary.duplicates} skipped=${summary.skipped} failed=${summary.failed}\n`);

if (skipScan) {
  await prisma.$disconnect();
  process.exit(0);
}

// Field-scan every template that doesn't yet have a completed scan.
const templates = await prisma.contractFile.findMany({
  where: { fieldScan: null },
  orderBy: { originalName: 'asc' },
  include: { fieldScan: true },
});

console.log(`Field-scanning ${templates.length} template(s)...`);
let scanned = 0;

for (const template of templates) {
  try {
    const result = await scanTemplateFieldsWithAI(template);
    await prisma.contractTemplateFieldScan.upsert({
      where: { templateId: template.id },
      create: { templateId: template.id, status: result.status, analyzerModel: result.analyzerModel, fields: result.fields, warnings: result.warnings || [] },
      update: { status: result.status, analyzerModel: result.analyzerModel, fields: result.fields, warnings: result.warnings || [] },
    });
    scanned += 1;
    const visible = Array.isArray(result.fields) ? result.fields.filter((f) => !f.hidden).length : 0;
    console.log(`  [${scanned}/${templates.length}] ${template.originalName} -> ${result.status} (${visible} fields)`);
  } catch (error) {
    console.log(`  [scan failed] ${template.originalName}: ${error.message}`);
  }
}

console.log(`\nAll done. Field-scanned ${scanned} template(s).`);
await prisma.$disconnect();
