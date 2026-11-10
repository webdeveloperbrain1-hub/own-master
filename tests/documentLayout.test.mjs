import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { layoutFromPdf, sanitizeDocumentHtml, documentHtmlToText } from '../server/lib/contractFiling/documentLayout.mjs';

test('original PDF page size, typography, blanks and page breaks survive import', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ownmasters-layout-test-'));
  try {
    const file = path.join(directory, 'template.pdf');
    const doc = new PDFDocument({ size: 'LETTER', margin: 72 });
    const chunks = [];
    const buffer = new Promise((resolve, reject) => {
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    doc.font('Times-Bold').fontSize(16).text('TEMPLATE AGREEMENT', 72, 72, { width: 468, align: 'center' });
    doc.font('Times-Roman').fontSize(12).text('This agreement is between __________ and __________.', 72, 130);
    doc.addPage().text('Second page clause.', 72, 90);
    doc.text('Artist signature __________', 72, 450);
    doc.text('Agent signature __________', 330, 450);
    doc.end();
    await fs.writeFile(file, await buffer);
    const result = await layoutFromPdf(file);
    assert.equal(result.layout.width, 612);
    assert.equal(result.layout.height, 792);
    assert.equal(result.layout.pageCount, 2);
    assert.match(result.html, /font-weight:bold/);
    assert.match(result.html, /text-align:center/);
    assert.match(result.html, /data-contract-page="2"/);
    assert.match(result.html, /margin-left:[1-9][\d.]+pt;display:inline-block/);
    assert.match(result.text, /between __________ and __________/);
    assert.ok(!result.text.includes('Field after'));
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('ownmasters-layout-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('saved document HTML retains formatting and strips active content', () => {
  const clean = sanitizeDocumentHtml('<div data-contract-page="1" onclick="evil()"><p style="font-size:12pt;margin-top:14pt;position:fixed;background:url(https://example.com)"><b>Edited &amp; saved</b><img src=x onerror="evil()"></p><script>evil()</script><iframe src="https://example.com"></iframe></div>');
  assert.match(clean, /font-size:12pt;margin-top:14pt/);
  assert.match(clean, /<b>Edited &amp; saved<\/b>/);
  assert.doesNotMatch(clean, /onclick|script|iframe|img|url\(|position/);
  assert.equal(documentHtmlToText(clean), 'Edited & saved');
});

test('blank paragraphs and literal contract text remain plain text', () => {
  const html = '<div data-contract-page="1"><p>First &lt;party&gt;</p><p><br></p><p>Last &amp; final</p></div>';
  assert.equal(documentHtmlToText(html), 'First <party>\n\nLast & final');
});
