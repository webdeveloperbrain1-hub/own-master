import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from '../../server/lib/env.mjs';
import { importContractZipToDb, importLooseContractDirectoryToDb } from '../../server/lib/contracts/importContractZipToDb.mjs';
import { contractStoragePaths } from '../../server/lib/contracts/storagePaths.mjs';
import { prisma } from '../../server/lib/prisma.mjs';

loadEnv();

const paths = contractStoragePaths();
const requestedPath = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : resolve(paths.zipDir, 'all-music-contracts.zip');

try {
  const summary = existsSync(requestedPath) && requestedPath.toLowerCase().endsWith('.zip')
    ? await importContractZipToDb({ zipPath: requestedPath, outputDir: paths.templateDir })
    : await importLooseContractDirectoryToDb({
        sourceDir: existsSync(requestedPath) ? requestedPath : resolve(process.cwd(), 'server/data/contract-library-source'),
        outputDir: paths.templateDir,
      });

  console.log('Contract import complete');
  console.log(`Source: ${summary.zipPath || summary.sourceDir}`);
  console.log(`Entries: ${summary.totalEntries}`);
  console.log(`Imported: ${summary.importedCount}`);
  console.log(`Skipped: ${summary.skippedCount}`);
  console.log(`Errors: ${summary.errors.length}`);

  if (summary.skipped?.length) {
  console.log('\nSkipped files:');

  for (const item of summary.skipped.slice(0, 20)) {
    const existing = item.existingTemplateId ? ` | existing: ${item.existingTemplateId}` : '';
    console.log(`- ${item.entry}: ${item.reason}${existing}`);
  }

  if (summary.skipped.length > 20) {
    console.log(`...and ${summary.skipped.length - 20} more skipped file(s).`);
  }
}

if (summary.errors?.length) {
  console.log('\nErrors:');

  for (const error of summary.errors.slice(0, 10)) {
    console.log(`- ${error.entry}: ${error.error}`);
  }
}
} finally {
  await prisma.$disconnect();
}
