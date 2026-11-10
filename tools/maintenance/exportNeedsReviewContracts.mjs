import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { loadEnv } from '../../server/lib/env.mjs';
import { prisma } from '../../server/lib/prisma.mjs';

loadEnv();

const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 3;

const exportRoot = resolve('contract-review-export');
await mkdir(exportRoot, { recursive: true });

const templates = await prisma.contractTemplate.findMany({
  where: {
    aiScanStatus: 'needs_review',
  },
  orderBy: {
    updatedAt: 'desc',
  },
  take: limit,
});

if (templates.length === 0) {
  console.log('No contracts need review.');
  await prisma.$disconnect();
  process.exit(0);
}

for (const template of templates) {
  const folderName = `${template.id}-${template.name}`
    .replace(/[^a-zA-Z0-9._ -]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 120);

  const exportDir = join(exportRoot, folderName);
  await mkdir(exportDir, { recursive: true });

  const schema = template.fieldSchema || {};
  const warnings = template.warnings || schema.warnings || [];

  const metadata = {
    id: template.id,
    name: template.name,
    category: template.category,
    originalFileName: template.originalFileName,
    fileType: template.fileType,
    storagePath: template.storagePath,
    aiScanStatus: template.aiScanStatus,
    approved: template.approved,
    textQuality: template.textQuality,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };

  await writeFile(
    join(exportDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf8'
  );

  await writeFile(
    join(exportDir, 'fieldSchema.json'),
    JSON.stringify(schema, null, 2),
    'utf8'
  );

  await writeFile(
    join(exportDir, 'warnings.json'),
    JSON.stringify(warnings, null, 2),
    'utf8'
  );

  await writeFile(
    join(exportDir, 'extractedText.txt'),
    template.extractedText || '',
    'utf8'
  );

  if (template.storagePath) {
    const originalFileName = basename(template.storagePath);
    await copyFile(template.storagePath, join(exportDir, originalFileName));
  }

  console.log(`Exported: ${template.name}`);
  console.log(`Folder: ${exportDir}`);
}

console.log(`\nDone. Export folder: ${exportRoot}`);
await prisma.$disconnect();