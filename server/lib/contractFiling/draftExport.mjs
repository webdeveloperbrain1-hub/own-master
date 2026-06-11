import { Document, Packer, Paragraph, TextRun } from 'docx';
import PDFDocument from 'pdfkit';

// Render a filled draft's plain text into a Word document buffer.
// Mirrors the textToDocx approach used elsewhere in the project.
export async function renderDraftDocxBuffer(text, title) {
  const paragraphs = String(text || title)
    .split(/\n/)
    .map((line) => new Paragraph({
      spacing: { after: line.trim() ? 120 : 180 },
      children: [new TextRun({ text: line || ' ', font: 'Times New Roman', size: 24 })],
    }));

  const doc = new Document({
    creator: 'Own Masters',
    title,
    sections: [{ children: paragraphs }],
  });

  return Packer.toBuffer(doc);
}

// Render a filled draft's plain text into a PDF buffer.
export function renderDraftPdfBuffer(text, title) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 64, info: { Title: title, Author: 'Own Masters' } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Times-Roman').fontSize(12);
    for (const line of String(text || title).split(/\n/)) {
      if (line.trim() === '') {
        doc.moveDown(0.5);
      } else {
        doc.text(line, { align: 'left' });
      }
    }
    doc.end();
  });
}

export function safeDraftFileName(name, extension) {
  const base = String(name || 'filled-contract')
    .replace(/[^a-z0-9._-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90) || 'filled-contract';
  return `${base}.${extension}`;
}
