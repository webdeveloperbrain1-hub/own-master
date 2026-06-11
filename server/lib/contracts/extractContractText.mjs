import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { cleanTemplateText } from './templateTextCleaner.mjs';
import { ensureContractStorage } from './storagePaths.mjs';

const execFileAsync = promisify(execFile);

function compactText(text = '') {
  return cleanTemplateText(String(text))
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function textQualityFor(text = '', warnings = []) {
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const legalWords = (text.match(/\b(agreement|contract|artist|producer|company|license|royalty|rights|term|signature|publisher|manager)\b/gi) ?? []).length;

  if (letters > 1200 && legalWords >= 8 && warnings.length === 0) return 'good';
  if (letters > 300 && legalWords >= 3) return 'partial';
  return 'poor';
}

function stripRtf(input = '') {
  return compactText(
    input
      .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\tab/g, ' ')
      .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
      .replace(/[{}]/g, ' '),
  );
}

function printableRuns(buffer) {
  const rawLatin = buffer.toString('latin1');
  const latin = rawLatin.match(/[A-Za-z0-9_][A-Za-z0-9_ ,.;:'"!?()[\]/&%$#@+\-=]{12,}/g)?.join('\n') ?? '';
  const utf16 = buffer.toString('utf16le').match(/[A-Za-z0-9_][A-Za-z0-9_ ,.;:'"!?()[\]/&%$#@+\-=]{12,}/g)?.join('\n') ?? '';
  return compactText(latin.length >= utf16.length ? latin : utf16);
}

async function extractDocxText(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return {
    text: compactText(result.value),
    warnings: (result.messages ?? []).map((message) => message.message).filter(Boolean),
  };
}

async function extractPdfText(filePath) {
  const buffer = await readFile(filePath);
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return { text: compactText(result.text), warnings: [] };
  } finally {
    await parser.destroy?.();
  }
}

function libreOfficeCandidates() {
  return [
    process.env.LIBREOFFICE_BIN,
    'soffice',
    'libreoffice',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ].filter(Boolean);
}

async function convertWithLibreOffice(inputPath, outputFormat, outputDir) {
  await mkdir(outputDir, { recursive: true });
  const errors = [];

  for (const command of libreOfficeCandidates()) {
    try {
      await execFileAsync(command, ['--headless', '--convert-to', outputFormat, '--outdir', outputDir, inputPath], {
        timeout: 60_000,
        windowsHide: true,
      });

      const convertedPath = join(outputDir, `${basename(inputPath, extname(inputPath))}.${outputFormat}`);
      if (existsSync(convertedPath)) {
        return convertedPath;
      }
    } catch (error) {
      errors.push(`${command}: ${error.message}`);
    }
  }

  throw new Error(`LibreOffice conversion failed. Install LibreOffice or set LIBREOFFICE_BIN. ${errors.join(' | ')}`);
}

async function extractLegacyDocText(filePath, tmpDir, warnings) {
  try {
    const convertedPath = await convertWithLibreOffice(filePath, 'docx', tmpDir);
    const result = await extractDocxText(convertedPath);
    warnings.push(...result.warnings);
    return result.text;
  } catch (error) {
    warnings.push(error.message);
    warnings.push('Used a low-fidelity binary text fallback for this legacy .doc file.');
    return printableRuns(await readFile(filePath));
  }
}

async function extractRtfText(filePath, tmpDir, warnings) {
  try {
    const convertedPath = await convertWithLibreOffice(filePath, 'docx', tmpDir);
    const result = await extractDocxText(convertedPath);
    warnings.push(...result.warnings);
    return result.text;
  } catch (error) {
    warnings.push(error.message);
    warnings.push('Used a simple RTF text fallback.');
    return stripRtf(await readFile(filePath, 'latin1'));
  }
}

export async function extractContractText(filePath) {
  const paths = await ensureContractStorage();
  const resolvedPath = resolve(filePath);
  const extension = extname(resolvedPath).toLowerCase();
  const workDir = join(paths.tmpDir, `extract-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const warnings = [];
  let text = '';

  try {
    if (extension === '.docx') {
      const result = await extractDocxText(resolvedPath);
      text = result.text;
      warnings.push(...result.warnings);
    } else if (extension === '.pdf') {
      const result = await extractPdfText(resolvedPath);
      text = result.text;
      warnings.push(...result.warnings);
    } else if (extension === '.rtf') {
      text = await extractRtfText(resolvedPath, workDir, warnings);
    } else if (extension === '.doc') {
      text = await extractLegacyDocText(resolvedPath, workDir, warnings);
    } else if (extension === '.txt') {
      text = compactText(await readFile(resolvedPath, 'utf8'));
    } else {
      throw new Error(`Unsupported contract file type: ${extension || 'unknown'}`);
    }

    text = compactText(text);

    return {
      text,
      textQuality: textQualityFor(text, warnings),
      warnings: warnings.filter(Boolean),
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
