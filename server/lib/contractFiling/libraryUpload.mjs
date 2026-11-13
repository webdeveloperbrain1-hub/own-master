import path from 'node:path';
import AdmZip from 'adm-zip';
import { importZip } from './importer.mjs';

export const MAX_LIBRARY_UPLOAD_BYTES = 20 * 1024 * 1024;
const extensions = new Set(['.pdf', '.doc', '.docx', '.rtf', '.txt', '.md']);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function validateLibraryUpload(name, buffer) {
  if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[/\\\x00-\x1f]/.test(name))
    throw fail('Choose a document with a valid file name (up to 200 characters).');
  const extension = path.extname(name).toLowerCase();
  if (!extensions.has(extension)) throw fail('Choose a PDF, DOC, DOCX, RTF, TXT, or MD document.');
  if (!buffer.length) throw fail('The selected document is empty.');
  if (buffer.length > MAX_LIBRARY_UPLOAD_BYTES) throw fail('Documents must be 20 MB or smaller.', 413);
  const prefix = buffer.subarray(0, 16).toString('ascii');
  let valid = true;
  if (extension === '.pdf') valid = prefix.startsWith('%PDF-');
  if (extension === '.doc') valid = buffer.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
  if (extension === '.rtf') valid = prefix.startsWith('{\\rtf');
  if (extension === '.txt' || extension === '.md') valid = !buffer.includes(0);
  if (extension === '.docx') {
    try {
      const archive = new AdmZip(buffer);
      const entries = archive.getEntries();
      valid = Boolean(archive.getEntry('[Content_Types].xml') && archive.getEntry('word/document.xml'));
      if (entries.length > 2000 || entries.reduce((size, entry) => size + entry.header.size, 0) > 50 * 1024 * 1024)
        throw fail('The expanded Word document is too large.', 413);
    } catch (error) {
      if (error.status) throw error;
      valid = false;
    }
  }
  if (!valid) throw fail('The document contents do not match its file type.');
}

export async function uploadLibraryDocument(req, name) {
  const declaredSize = Number(req.headers['content-length']);
  if (declaredSize > MAX_LIBRARY_UPLOAD_BYTES) throw fail('Documents must be 20 MB or smaller.', 413);
  const buffer = await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    // Drain an oversized request without retaining more bytes or destroying
    // the socket before the client receives the 413 response.
    req.on('data', (chunk) => {
      if (exceeded) return;
      size += chunk.length;
      if (size > MAX_LIBRARY_UPLOAD_BYTES) {
        exceeded = true;
        chunks.length = 0;
        reject(fail('Documents must be 20 MB or smaller.', 413));
      } else chunks.push(chunk);
    });
    req.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
    req.on('aborted', () => reject(fail('The upload was interrupted.')));
  });
  validateLibraryUpload(name, buffer);
  const archive = new AdmZip();
  archive.addFile(name, buffer);
  // Reuse the library's hashing, extraction, catalog analysis, and duplicate
  // detection. Uploaded originals must survive a free-host restart.
  const summary = await importZip(archive.toBuffer(), { analyze: 'local', persist: true, rejectFailedExtraction: true });
  if (summary.failed || (!summary.imported && !summary.duplicates))
    throw fail('The document could not be added. Check the document and private file storage, then try again.', 422);
  const result = summary.results[0];
  return { id: result.id, originalName: result.originalName, duplicate: summary.duplicates > 0, needsReview: Boolean(result.needsReview) };
}
