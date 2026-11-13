import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../prisma.mjs";
import { config } from "./filingConfig.mjs";
import { analyzeContract } from "./aiAnalyzer.mjs";
import { fallbackAnalyze } from "./fallbackAnalyzer.mjs";
import { extractText } from "./textExtraction.mjs";
import { cleanZipPath, ensureDir, isSkippableEntry, safeStoredName, sha256 } from "./fileUtils.mjs";
import { persistPrivateFile } from '../storage/privateFiles.mjs';

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".rtf", ".txt", ".md"]);

export async function importZip(zipPath, options = {}) {
  const limit = Number(options.limit || 0);
  const analyze = options.analyze !== false;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const zip = new AdmZip(zipPath);
  const entries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .filter((entry) => !isSkippableEntry(entry.entryName));

  const summary = {
    zipPath,
    discovered: entries.length,
    imported: 0,
    duplicates: 0,
    skipped: 0,
    failed: 0,
    needsReview: 0,
    results: []
  };

  await ensureDir(path.join(config.storageDir, "originals"));

  for (const entry of entries) {
    if (limit && summary.imported >= limit) break;

    const cleanedPath = cleanZipPath(entry.entryName);
    const originalName = path.basename(cleanedPath);
    const extension = path.extname(originalName).toLowerCase();

    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      summary.skipped += 1;
      summary.results.push({ originalName, status: "skipped", reason: `Unsupported extension ${extension}` });
      onProgress?.({ originalName, status: "skipped", summary });
      continue;
    }

    try {
      const buffer = entry.getData();
      const hash = sha256(buffer);
      const existing = await prisma.contractFile.findUnique({ where: { sha256: hash } });
      if (existing) {
        // Free hosts discard the cache on restart. Rebuild bundled originals
        // without replacing the database IDs used by saved drafts.
        const storedPath = path.join(config.storageDir, 'originals', safeStoredName(hash, originalName));
        if (!await fs.stat(storedPath).then(stat => stat.isFile(), () => false)) await fs.writeFile(storedPath, buffer);
        if (existing.storedPath !== storedPath)
          await prisma.contractFile.update({ where: { id: existing.id }, data: { storedPath } });
        if (options.persist) await persistPrivateFile(storedPath);
        summary.duplicates += 1;
        summary.results.push({ originalName, status: "duplicate", id: existing.id, needsReview: existing.needsReview });
        onProgress?.({ originalName, status: "duplicate", summary });
        continue;
      }

      const storedPath = path.join(config.storageDir, "originals", safeStoredName(hash, originalName));
      await fs.writeFile(storedPath, buffer);
      if (options.analyze !== 'local' || options.persist) await persistPrivateFile(storedPath);

      const extraction = await extractText(storedPath, extension);
      if (options.rejectFailedExtraction && extraction.status === 'failed')
        throw new Error('The uploaded document could not be read.');
      const analysis = options.analyze === 'local'
        ? fallbackAnalyze({ originalName, text: extraction.text, reason: 'Automatically loaded from the contract library. Review the contract before use.' })
        : analyze ? await analyzeContract({ originalName, text: extraction.text })
        : {
            analysisStatus: "pending",
            needsReview: true,
            reviewReason: "Imported without AI analysis",
            analyzerModel: null
          };

      const record = await prisma.contractFile.create({
        data: {
          originalName,
          originalPath: cleanedPath,
          storedPath,
          extension,
          sizeBytes: buffer.length,
          sha256: hash,
          textLength: extraction.text.length,
          extractedText: extraction.text,
          extractionStatus: extraction.status,
          extractionWarnings: extraction.warnings,
          ...analysis,
          needsReview: analysis.needsReview || extraction.status !== "complete",
          reviewReason:
            analysis.reviewReason ||
            (extraction.status !== "complete" ? "Text extraction needs review" : null)
        }
      });

      summary.imported += 1;
      if (record.needsReview) summary.needsReview += 1;
      summary.results.push({
        id: record.id,
        originalName,
        status: record.analysisStatus,
        extractionStatus: record.extractionStatus,
        needsReview: record.needsReview
      });
      onProgress?.({ originalName, status: record.analysisStatus, summary });
    } catch (error) {
      summary.failed += 1;
      summary.results.push({ originalName, status: "failed", reason: error.message });
      onProgress?.({ originalName, status: "failed", reason: error.message, summary });
    }
  }

  return summary;
}

export async function databaseSummary() {
  const [total, needsReview, complete, failedExtraction] = await Promise.all([
    prisma.contractFile.count(),
    prisma.contractFile.count({ where: { needsReview: true } }),
    prisma.contractFile.count({ where: { analysisStatus: "complete" } }),
    prisma.contractFile.count({ where: { extractionStatus: "failed" } })
  ]);

  const categories = await prisma.contractFile.groupBy({
    by: ["category"],
    where: { category: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { category: "desc" } },
    take: 12
  });

  return { total, needsReview, complete, failedExtraction, categories };
}
