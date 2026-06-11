import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { PDFParse } from "pdf-parse";

export async function extractText(filePath, extension) {
  const ext = extension.toLowerCase();
  const warnings = [];

  try {
    if (ext === ".pdf") {
      const buffer = await fs.readFile(filePath);
      // pdf-parse v2 (class API, matches the rest of the project).
      const parser = new PDFParse({ data: buffer });
      try {
        const data = await parser.getText();
        return normalizeResult(data.text, warnings);
      } finally {
        await parser.destroy?.();
      }
    }

    if (ext === ".docx") {
      const result = await mammoth.extractRawText({ path: filePath });
      warnings.push(...result.messages.map((message) => message.message));
      return normalizeResult(result.value, warnings);
    }

    if (ext === ".doc") {
      const extractor = new WordExtractor();
      const document = await extractor.extract(filePath);
      return normalizeResult(document.getBody(), warnings);
    }

    if (ext === ".rtf") {
      const raw = await fs.readFile(filePath, "utf8");
      return normalizeResult(stripRtf(raw), warnings);
    }

    if ([".txt", ".md"].includes(ext)) {
      const raw = await fs.readFile(filePath, "utf8");
      return normalizeResult(raw, warnings);
    }

    return {
      text: "",
      status: "unsupported",
      warnings: [`Unsupported file extension ${ext || path.extname(filePath) || "unknown"}`]
    };
  } catch (error) {
    return {
      text: "",
      status: "failed",
      warnings: [`Text extraction failed: ${error.message}`]
    };
  }
}

function normalizeResult(text, warnings) {
  const normalized = (text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    text: normalized,
    status: normalized.length > 40 ? "complete" : "needs_review",
    warnings: normalized.length > 40 ? warnings : [...warnings, "Extracted text is very short or empty"]
  };
}

function stripRtf(raw) {
  return raw
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\[a-zA-Z]+\d* ?/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ");
}
