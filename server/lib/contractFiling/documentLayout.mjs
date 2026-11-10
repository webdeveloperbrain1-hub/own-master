import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import PDFDocument from 'pdfkit';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import sanitizeHtml from 'sanitize-html';
import { parseDocument, DomUtils } from 'htmlparser2';
import AdmZip from 'adm-zip';
import { config } from './filingConfig.mjs';

const exec = promisify(execFile);
const pending = new Map();
let officeQueue = Promise.resolve();
const number = (value) => Math.round(value * 100) / 100;
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function sanitizeDocumentHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: ['div', 'p', 'span', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup'],
    allowedAttributes: { '*': ['style'], div: ['data-contract-page'] },
    allowedStyles: {
      '*': {
        'font-family': [/^(?:Times New Roman|Arial|Courier New|Georgia|serif|sans-serif|monospace)(?:,\s*(?:serif|sans-serif|monospace))?$/i],
        'font-size': [/^\d{1,3}(?:\.\d+)?pt$/],
        'font-weight': [/^(?:normal|bold|[1-9]00)$/],
        'font-style': [/^(?:normal|italic)$/],
        'text-decoration': [/^(?:none|underline|line-through)$/],
        'text-align': [/^(?:left|right|center|justify)$/],
        'line-height': [/^\d{1,3}(?:\.\d+)?pt$/],
        'margin-top': [/^\d{1,3}(?:\.\d+)?pt$/],
        'margin-left': [/^\d{1,3}(?:\.\d+)?pt$/],
        'margin-bottom': [/^0(?:pt)?$/],
        'white-space': [/^(?:pre-wrap|pre|normal)$/],
        display: [/^inline-block$/],
      },
    },
  });
}

export function documentHtmlToText(html) {
  const root = parseDocument(html);
  const read = (node) => {
    if (node.type === 'text') return node.data;
    if (node.name === 'br') return '\n';
    if (node.name === 'p' && (node.children || []).every((child) => child.name === 'br' || (child.type === 'text' && !child.data.trim()))) {
      return '\n'.repeat(Math.max(1, node.children.filter((child) => child.name === 'br').length));
    }
    const text = (node.children || []).map(read).join('');
    return ['p', 'div'].includes(node.name) ? `${text}\n` : text;
  };
  return read(root).trimEnd();
}

export function plainDocumentHtml(text) {
  return `<div data-contract-page="1">${String(text).split('\n').map((line) => `<p style="font-family:Times New Roman;font-size:12pt;line-height:14pt;margin-bottom:0pt">${escape(line) || '<br>'}</p>`).join('')}</div>`;
}

export async function convertOfficeFile(input, outputDirectory, format) {
  const operation = officeQueue.then(async () => {
    await fs.mkdir(outputDirectory, { recursive: true });
    const candidates = [process.env.LIBREOFFICE_PATH, ...(process.platform === 'win32'
      ? [path.join(process.env.ProgramFiles || 'C:/Program Files', 'LibreOffice/program/soffice.com')]
      : ['/usr/bin/libreoffice', '/usr/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'])].filter(Boolean);
    let office;
    for (const candidate of candidates) {
      if (await fs.access(candidate).then(() => true, () => false)) { office = candidate; break; }
    }
    if (!office) throw new Error('LibreOffice is required to preserve this document’s original layout. Set LIBREOFFICE_PATH to its executable.');
    const profile = pathToFileURL(path.join(os.tmpdir(), 'ownmasters-document-layout-office')).href;
    await exec(office, [`-env:UserInstallation=${profile}`, '--headless', '--convert-to', format, '--outdir', outputDirectory, input], { timeout: 90000, windowsHide: true });
    const extension = format.split(':')[0];
    const output = path.join(outputDirectory, `${path.parse(input).name}.${extension}`);
    await fs.access(output);
    return output;
  });
  officeQueue = operation.catch(() => {});
  return operation;
}

function fontDescription(name = '', family = 'serif', samples, measure) {
  const sans = /Arial|Helvetica|sans/i.test(name + family);
  const mono = /Courier|mono/i.test(name + family);
  const fonts = mono ? ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique']
    : sans ? ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique']
      : ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'];
  // Some older PDFs omit bold/italic flags. Compare their actual glyph widths
  // against the standard font variants instead of guessing from heading text.
  const ranked = fonts.map((font) => ({ font, error: samples.reduce((sum, item) => {
    const width = measure.font(font).fontSize(Math.hypot(item.transform[2], item.transform[3])).widthOfString(item.str);
    return sum + Math.abs(width - item.width) / Math.max(1, item.width);
  }, 0) / Math.max(1, samples.length) })).sort((a, b) => a.error - b.error);
  const font = ranked[0].font;
  return { family: mono ? 'Courier New' : sans ? 'Arial' : 'Times New Roman', bold: /Bold/.test(font), italic: /Italic|Oblique/.test(font) };
}

export async function layoutFromPdf(pdfPath) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(pdfPath)), verbosity: 0 }).promise;
  const pages = [];
  const measure = new PDFDocument({ autoFirstPage: false });
  measure.resume();
  try {
    for (let index = 1; index <= doc.numPages; index++) {
      const page = await doc.getPage(index);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      await page.getOperatorList();
      const items = content.items.filter((item) => item.str?.trim() && item.transform);
      const fonts = {};
      for (const [id, style] of Object.entries(content.styles)) {
        const font = page.commonObjs.get(id);
        fonts[id] = fontDescription(font.name, style.fontFamily, items.filter((item) => item.fontName === id && item.str.length > 4).slice(0, 16), measure);
      }
      const rows = [];
      for (const item of items) {
        const transform = pdfjs.Util.transform(viewport.transform, item.transform);
        const size = Math.hypot(transform[2], transform[3]);
        const baseline = transform[5];
        let row = rows.find((candidate) => Math.abs(candidate.baseline - baseline) < 2);
        if (!row) { row = { baseline, size, items: [] }; rows.push(row); }
        row.size = Math.max(row.size, size);
        row.items.push({ text: item.str, x: transform[4], width: item.width, size, ...fonts[item.fontName] });
      }
      rows.sort((a, b) => a.baseline - b.baseline);
      for (const row of rows) row.items.sort((a, b) => a.x - b.x);
      const steps = rows.slice(1).map((row, i) => ({ distance: row.baseline - rows[i].baseline, size: row.size }))
        .filter(({ distance, size }) => distance > size * 0.9 && distance < size * 1.5).map(({ distance, size }) => distance / size).sort((a, b) => a - b);
      const leading = steps.length ? steps[Math.floor(steps.length / 2)] : 1.15;
      pages.push({ width: viewport.width, height: viewport.height, rows, leading });
    }
  } finally {
    measure.end();
    await doc.destroy();
  }
  if (!pages.some((page) => page.rows.length)) throw new Error('This template has no editable text layer.');
  const left = Math.max(18, Math.min(...pages.flatMap((page) => page.rows.flatMap((row) => row.items.map((item) => item.x)))));
  const right = Math.max(18, Math.min(...pages.map((page) => page.width - Math.max(...page.rows.flatMap((row) => row.items.map((item) => item.x + item.width))))));
  const top = Math.max(18, Math.min(...pages.flatMap((page) => page.rows.length ? [page.rows[0].baseline - page.rows[0].size * 0.9] : [])));
  const bottom = Math.max(0, Math.min(36, ...pages.filter((page) => page.rows.length).map((page) => {
    const last = page.rows.at(-1);
    return page.height - (last.baseline - last.size * 0.9 + last.size * page.leading) - 3;
  })));
  const layout = { width: number(pages[0].width), height: number(pages[0].height), left: number(left), right: number(right), top: number(top), bottom: number(bottom), pageCount: pages.length };
  const html = pages.map((page, pageIndex) => {
    let bottom = top;
    const lines = page.rows.map((row) => {
      const y = row.baseline - row.size * 0.9;
      const lineHeight = row.size * page.leading;
      const gap = Math.max(0, y - bottom);
      bottom = y + lineHeight;
      const start = row.items[0].x;
      const end = Math.max(...row.items.map((item) => item.x + item.width));
      const centered = row.items.length === 1 && start - left > 24 && Math.abs((start + end) / 2 - page.width / 2) < 7;
      let previousEnd = start;
      const runs = row.items.map((item) => {
        const space = Math.max(0, item.x - previousEnd);
        previousEnd = item.x + item.width;
        return `<span style="font-family:${item.family};font-size:${number(item.size)}pt;font-weight:${item.bold ? 'bold' : 'normal'};font-style:${item.italic ? 'italic' : 'normal'}${space > 1 ? `;margin-left:${number(space)}pt;display:inline-block` : ''}">${escape(item.text)}</span>`;
      }).join('');
      return `<p style="font-size:${number(row.size)}pt;line-height:${number(lineHeight)}pt;margin-top:${number(gap)}pt;margin-bottom:0pt;margin-left:${centered ? 0 : number(Math.max(0, start - left))}pt;text-align:${centered ? 'center' : 'left'}">${runs}</p>`;
    }).join('');
    return `<div data-contract-page="${pageIndex + 1}">${lines}</div>`;
  }).join('');
  return { layout, html: sanitizeDocumentHtml(html), text: documentHtmlToText(html) };
}

export async function getTemplateDocument(template) {
  const key = `${template.sha256}-v3`;
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    const directory = path.join(config.storageDir, 'layouts', key);
    const cache = path.join(directory, 'layout.json');
    try { return JSON.parse(await fs.readFile(cache, 'utf8')); } catch { /* build from original */ }
    await fs.mkdir(directory, { recursive: true });
    const pdf = template.extension === '.pdf' ? template.storedPath : await convertOfficeFile(template.storedPath, directory, 'pdf');
    const result = await layoutFromPdf(pdf);
    await fs.writeFile(cache, JSON.stringify(result));
    return result;
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}

export async function exportDocumentHtml(html, layout, format) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ownmasters-export-'));
  try {
    const clean = sanitizeDocumentHtml(html);
    const tree = parseDocument(clean);
    const pages = DomUtils.findAll((node) => node.name === 'div' && node.attribs?.['data-contract-page'], tree.children);
    for (const [i, page] of pages.entries()) {
      const firstParagraph = DomUtils.findOne((node) => node.name === 'p', page.children);
      if (i && firstParagraph) firstParagraph.attribs.style = `${firstParagraph.attribs.style || ''};page-break-before:always`;
    }
    // Writer's HTML importer ignores margins on inline spans. Materialize the
    // measured horizontal gaps so signature columns and list indents survive.
    for (const span of DomUtils.findAll((node) => node.name === 'span', tree.children)) {
      const style = span.attribs.style || '';
      const gap = Number(style.match(/margin-left:([\d.]+)pt/)?.[1] || 0);
      if (!gap) continue;
      const size = Number(style.match(/font-size:([\d.]+)pt/)?.[1] || 12);
      const spaceWidth = size * (/Courier/.test(style) ? 0.6 : /Arial/.test(style) ? 0.278 : 0.25);
      const spaces = parseDocument(`&#160;`.repeat(Math.round(gap / spaceWidth))).children;
      span.children.unshift(...spaces);
      span.attribs.style = style.replace(/margin-left:[\d.]+pt;?/, '').replace(/display:inline-block;?/, '');
    }
    const body = DomUtils.getOuterHTML(tree);
    const file = path.join(directory, 'contract.html');
    await fs.writeFile(file, `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page { size:${layout.width}pt ${layout.height}pt; margin:${layout.top}pt ${layout.right}pt ${layout.bottom}pt ${layout.left}pt } body { font-family:'Times New Roman'; font-size:12pt; color:black } p { margin:0; orphans:1; widows:1 } span { white-space:pre-wrap }</style></head><body>${body}</body></html>`);
    const output = await convertOfficeFile(file, path.join(directory, 'output'), format === 'docx' ? 'docx:Office Open XML Text' : 'pdf:writer_pdf_Export');
    const buffer = await fs.readFile(output);
    if (format === 'docx') {
      const sourceZip = new AdmZip(buffer);
      // Writer serializes CSS page breaks as inline breaks, which suppresses
      // the next paragraph's top spacing when Word reopens the document.
      let xml = sourceZip.readAsText('word/document.xml').replace(
        /<w:r><w:br w:type="page"\s*\/><\/w:r><\/w:p><w:p>(<w:pPr>)/g,
        '</w:p><w:p>$1<w:pageBreakBefore/>',
      );
      xml = xml.replace(/<w:p><w:pPr>([\s\S]*?)<\/w:pPr>/g, (paragraph, properties) => {
        if (!properties.includes('<w:pageBreakBefore/>')) return paragraph;
        const before = Number(properties.match(/w:before="(\d+)"/)?.[1] || 0);
        if (!before) return paragraph;
        const nextProperties = properties.replace('<w:pageBreakBefore/>', '').replace(/w:before="\d+"/, 'w:before="0"');
        // Word suppresses before-spacing on the first paragraph of a page.
        // An exact-height spacer retains the source's measured top offset.
        return `<w:p><w:pPr><w:pageBreakBefore/><w:spacing w:lineRule="exact" w:line="${before}" w:before="0" w:after="0"/><w:rPr><w:sz w:val="1"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="1"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r></w:p><w:p><w:pPr>${nextProperties}</w:pPr>`;
      });
      const zip = new AdmZip();
      for (const entry of sourceZip.getEntries()) {
        zip.addFile(entry.entryName, entry.entryName === 'word/document.xml' ? Buffer.from(xml) : entry.getData());
      }
      return zip.toBuffer();
    }
    return buffer;
  } finally {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('ownmasters-export-')) {
      throw new Error('Unexpected export cleanup directory.');
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
}
