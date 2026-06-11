import AdmZip from 'adm-zip';
import crypto from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { prisma } from '../prisma.mjs';
import { ensureContractStorage } from './storagePaths.mjs';

const supportedExtensions = new Set(['.doc', '.docx', '.pdf', '.rtf']);

function sanitizeFileName(value = '') {
  const ext = extname(value).toLowerCase();
  const base = basename(value, ext)
    .replace(/^\.+/g, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140) || 'contract-template';

  return `${base}${ext}`;
}

function titleFromFile(value = '') {
  return basename(value, extname(value))
    .replace(/\s*\(\d+\)\s*$/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function categoryFor(title = '') {
  const lower = title.toLowerCase();

  if (lower.includes('producer')) return 'Producer Agreements';
  if (lower.includes('management') || lower.includes('manager')) return 'Management Agreements';
  if (lower.includes('record')) return 'Recording Agreements';
  if (lower.includes('songwriter') || lower.includes('publishing') || lower.includes('publisher')) return 'Publishing and Songwriter Agreements';
  if (lower.includes('license') || lower.includes('copyright')) return 'Licenses and Copyright';
  if (lower.includes('booking') || lower.includes('performance') || lower.includes('event')) return 'Booking and Performance';
  if (lower.includes('distribution')) return 'Distribution Agreements';
  if (lower.includes('royalty')) return 'Royalty Agreements';
  if (lower.includes('split')) return 'Split Sheets';
  return 'Music Business Contracts';
}

function uniqueStoredPath(outputDir, fileName, usedNames) {
  const ext = extname(fileName);
  const base = basename(fileName, ext);
  let candidate = fileName;
  let suffix = 2;

  while (usedNames.has(candidate)) {
    candidate = `${base}-${suffix}${ext}`;
    suffix += 1;
  }

  usedNames.add(candidate);
  return resolve(outputDir, candidate);
}

function isSafeResolvedPath(root, target) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  return (
    resolvedTarget === resolvedRoot ||
    resolvedTarget.startsWith(`${resolvedRoot}\\`) ||
    resolvedTarget.startsWith(`${resolvedRoot}/`)
  );
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function findExistingTemplate({ fileHash, originalFileName }) {
  return prisma.contractTemplate.findFirst({
    where: {
      OR: [
        { fileHash },
        { originalFileName },
      ],
    },
    select: {
      id: true,
      name: true,
      originalFileName: true,
      fileHash: true,
    },
  });
}

export async function importContractZipToDb({ zipPath, outputDir } = {}) {
  const paths = await ensureContractStorage();
  const resolvedZipPath = resolve(zipPath || join(paths.zipDir, 'all-music-contracts.zip'));
  const resolvedOutputDir = resolve(outputDir || paths.templateDir);

  const summary = {
    zipPath: resolvedZipPath,
    totalEntries: 0,
    importedCount: 0,
    skippedCount: 0,
    skipped: [],
    errors: [],
    imported: [],
  };

  if (!isSafeResolvedPath(paths.root, resolvedZipPath)) {
    throw new Error('ZIP path must live under the configured contract storage root.');
  }

  if (!isSafeResolvedPath(paths.root, resolvedOutputDir)) {
    throw new Error('Template output directory must live under the configured contract storage root.');
  }

  await mkdir(resolvedOutputDir, { recursive: true });

  const zip = new AdmZip(resolvedZipPath);
  const entries = zip.getEntries();
  const usedNames = new Set();

  summary.totalEntries = entries.length;

  for (const entry of entries) {
    if (entry.isDirectory) {
      summary.skippedCount += 1;
      summary.skipped.push({
        entry: entry.entryName,
        reason: 'directory',
      });
      continue;
    }

    const originalFileName = entry.entryName;
    const ext = extname(originalFileName).toLowerCase();

    if (!supportedExtensions.has(ext) || basename(originalFileName).startsWith('~$')) {
      summary.skippedCount += 1;
      summary.skipped.push({
        entry: originalFileName,
        reason: 'unsupported_or_temp_file',
      });
      continue;
    }

    try {
      const fileBuffer = entry.getData();
      const fileHash = hashBuffer(fileBuffer);

      const existingTemplate = await findExistingTemplate({
        fileHash,
        originalFileName,
      });

      if (existingTemplate) {
        summary.skippedCount += 1;
        summary.skipped.push({
          entry: originalFileName,
          reason: 'already_imported',
          existingTemplateId: existingTemplate.id,
        });
        continue;
      }

      const safeName = sanitizeFileName(originalFileName);
      const storagePath = uniqueStoredPath(resolvedOutputDir, safeName, usedNames);

      if (!isSafeResolvedPath(resolvedOutputDir, storagePath)) {
        throw new Error(`Unsafe ZIP entry path: ${originalFileName}`);
      }

      await writeFile(storagePath, fileBuffer);

      const title = titleFromFile(originalFileName);

      const template = await prisma.contractTemplate.create({
        data: {
          name: title,
          category: categoryFor(title),
          originalFileName,
          fileType: ext.slice(1),
          storagePath,
          sourceZipPath: resolvedZipPath,
          fileHash,
          aiScanStatus: 'not_scanned',
        },
      });

      summary.importedCount += 1;
      summary.imported.push({
        id: template.id,
        name: template.name,
        storagePath,
      });
    } catch (error) {
      summary.errors.push({
        entry: originalFileName,
        error: error.message,
      });
    }
  }

  return summary;
}

export async function importLooseContractDirectoryToDb({ sourceDir, outputDir } = {}) {
  const { readdir } = await import('node:fs/promises');
  const paths = await ensureContractStorage();
  const resolvedSourceDir = resolve(sourceDir);
  const files = await readdir(resolvedSourceDir, { recursive: true, withFileTypes: true });
  const resolvedOutputDir = resolve(outputDir || paths.templateDir);
  const usedNames = new Set();

  const summary = {
    sourceDir: resolvedSourceDir,
    totalEntries: files.length,
    importedCount: 0,
    skippedCount: 0,
    skipped: [],
    errors: [],
    imported: [],
  };

  await mkdir(resolvedOutputDir, { recursive: true });

  for (const entry of files) {
    if (entry.isDirectory()) {
      summary.skippedCount += 1;
      summary.skipped.push({
        entry: entry.name,
        reason: 'directory',
      });
      continue;
    }

    const fullPath = resolve(entry.parentPath || resolvedSourceDir, entry.name);
    const ext = extname(entry.name).toLowerCase();

    if (!supportedExtensions.has(ext) || basename(entry.name).startsWith('~$')) {
      summary.skippedCount += 1;
      summary.skipped.push({
        entry: entry.name,
        reason: 'unsupported_or_temp_file',
      });
      continue;
    }

    try {
      const fileBuffer = await readFile(fullPath);
      const fileHash = hashBuffer(fileBuffer);
      const originalFileName = entry.name;

      const existingTemplate = await findExistingTemplate({
        fileHash,
        originalFileName,
      });

      if (existingTemplate) {
        summary.skippedCount += 1;
        summary.skipped.push({
          entry: originalFileName,
          reason: 'already_imported',
          existingTemplateId: existingTemplate.id,
        });
        continue;
      }

      const safeName = sanitizeFileName(entry.name);
      const storagePath = uniqueStoredPath(resolvedOutputDir, safeName, usedNames);

      await copyFile(fullPath, storagePath);

      const title = titleFromFile(entry.name);

      const template = await prisma.contractTemplate.create({
        data: {
          name: title,
          category: categoryFor(title),
          originalFileName,
          fileType: ext.slice(1),
          storagePath,
          sourceZipPath: resolvedSourceDir,
          fileHash,
          aiScanStatus: 'not_scanned',
        },
      });

      summary.importedCount += 1;
      summary.imported.push({
        id: template.id,
        name: template.name,
        storagePath,
      });
    } catch (error) {
      summary.errors.push({
        entry: entry.name,
        error: error.message,
      });
    }
  }

  return summary;
}