import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export function cleanZipPath(entryName) {
  return entryName.replaceAll("\\", "/").split("/").filter(Boolean).join("/");
}

export function isSkippableEntry(entryName) {
  const base = path.basename(entryName);
  return (
    !base ||
    base === ".DS_Store" ||
    base.startsWith("~$") ||
    base.startsWith("._")
  );
}

export function safeStoredName(hash, originalName) {
  const ext = path.extname(originalName).toLowerCase() || ".bin";
  const base = path
    .basename(originalName, ext)
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${hash.slice(0, 16)}-${base || "contract"}${ext}`;
}
