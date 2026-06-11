import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { cleanTemplateText } from '../lib/contracts/templateTextCleaner.mjs';

const zipPath = process.argv[2];
const manifestPath = resolve(process.cwd(), 'server/data/contract-library.manifest.json');
const extractDir = resolve(process.cwd(), 'server/data/contract-library-source');
const outputPath = resolve(process.cwd(), 'server/data/contract-library.templates.json');

if (!zipPath) {
  console.error('Usage: node server/scripts/extractContractTemplates.mjs <zip-path>');
  process.exit(1);
}

if (!existsSync(manifestPath)) {
  console.error('Run ingestContractZip.mjs before extracting template text.');
  process.exit(1);
}

rmSync(extractDir, { recursive: true, force: true });
mkdirSync(extractDir, { recursive: true });
execFileSync('tar', ['-xf', zipPath, '-C', extractDir], { stdio: 'ignore' });

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function compactText(text) {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[^\S\n]+$/gm, '')
    .trim();
}

function cleanOfficeNoise(text) {
  const markers = [
    'Microsoft Word Document',
    'Word.Document.8',
    'Microsoft Word 8.0',
    'Preferred Customer',
    'Preferred Company',
    'Normal',
    'Default Paragraph Font',
    'Page Number',
    'Header',
    'Footer',
    'Unicode',
  ];
  let cleaned = text;

  for (const marker of markers) {
    const index = cleaned.indexOf(marker);

    if (index > 800) {
      cleaned = cleaned.slice(0, index);
    }
  }

  cleaned = cleaned
    .split(/\n/)
    .filter((line) => {
      const trimmed = line.trim();

      if (!trimmed) return true;
      if (/[<>@#$^`[\]{}]/.test(trimmed) && !/[A-Za-z]{10,}/.test(trimmed)) return false;
      if (/^[\W\d_A-Za-z]{1,28}$/.test(trimmed) && /[<>@#$^`[\]{}]/.test(trimmed)) return false;
      if (/^(PAGE\s+\d+|\d+:\s*PAGE\s+\d+)$/i.test(trimmed)) return false;
      if (/^(Normal|Default Paragraph Font|Header|Footer|Page Number)$/i.test(trimmed)) return false;
      return true;
    })
    .join('\n');

  const artistSignatureIndex = cleaned.lastIndexOf('\nARTIST');
  const artistTail = artistSignatureIndex >= 0 ? cleaned.slice(artistSignatureIndex + '\nARTIST'.length).trim() : '';

  if (artistSignatureIndex > 0 && artistTail && artistTail.length < 300) {
    cleaned = cleaned.slice(0, artistSignatureIndex + '\nARTIST'.length);
  }

  return cleanTemplateText(compactText(cleaned));
}

function stripRtf(input) {
  return compactText(
    input
      .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\tab/g, ' ')
      .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
      .replace(/[{}]/g, ' '),
  );
}

function extractDocxText(filePath) {
  const tempDir = `${filePath}.unzipped`;
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });
  execFileSync('tar', ['-xf', filePath, '-C', tempDir], { stdio: 'ignore' });
  const documentPath = join(tempDir, 'word', 'document.xml');

  if (!existsSync(documentPath)) {
    return '';
  }

  const xml = readFileSync(documentPath, 'utf8');
  rmSync(tempDir, { recursive: true, force: true });

  return compactText(
    xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"'),
  );
}

function printableRuns(text) {
  return text
    .match(/[A-Za-z0-9_][A-Za-z0-9_ ,.;:'"!?()[\]\/&%$#@+\-=]{12,}/g)
    ?.join('\n') ?? '';
}

function extractBinaryDocText(buffer) {
  const rawLatin = buffer.toString('latin1');
  const titleIndex = rawLatin.search(/[A-Z][A-Z ]{8,}CONTRACT/);
  const noiseIndex = titleIndex >= 0 ? rawLatin.indexOf('Microsoft Word Document', titleIndex) : -1;

  if (titleIndex >= 0 && noiseIndex > titleIndex) {
    const segment = rawLatin
      .slice(titleIndex, noiseIndex)
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();

    if (segment.length > 500) {
      return cleanOfficeNoise(segment);
    }
  }

  const latin = printableRuns(rawLatin);
  const utf16 = printableRuns(buffer.toString('utf16le'));
  const score = (text) => {
    let total = 0;
    if (text.includes('ARTIST PRODUCER CONTRACT')) total += 10;
    if (text.includes('Date:')) total += 5;
    total += (text.match(/_{4,}/g) ?? []).length;
    total += (text.match(/\bProducer\b|\bArtist\b|\bAgreement\b/g) ?? []).length;
    return total;
  };

  return compactText(score(latin) >= score(utf16) ? latin : utf16);
}

function extractPdfText(buffer) {
  const latin = buffer.toString('latin1');
  const strings = [];
  const regex = /\(([^()]{8,})\)\s*Tj|\[([^\]]{8,})\]\s*TJ/g;
  let match;

  while ((match = regex.exec(latin))) {
    strings.push((match[1] || match[2] || '').replace(/\\[()\\]/g, ' '));
  }

  return compactText(strings.join('\n') || printableRuns(latin));
}

function extractText(filePath) {
  const extension = extname(filePath).toLowerCase();
  const buffer = readFileSync(filePath);

  try {
    if (extension === '.rtf') {
      return cleanOfficeNoise(stripRtf(buffer.toString('latin1')));
    }

    if (extension === '.docx') {
      return cleanOfficeNoise(extractDocxText(filePath));
    }

    if (extension === '.doc') {
      return cleanOfficeNoise(extractBinaryDocText(buffer));
    }

    if (extension === '.pdf') {
      return cleanOfficeNoise(extractPdfText(buffer));
    }
  } catch {
    return '';
  }

  return '';
}

function inferQuestionSpecs(template, text) {
  const lower = `${template.title} ${template.category} ${text}`.toLowerCase();
  const questions = [
    { id: 'partyOneName', label: 'Who is the first party?', placeholder: 'Producer, artist, manager, licensor, or company name', required: true },
    { id: 'partyOneRole', label: 'What is the first party role?', placeholder: 'Producer, Artist, Manager, Publisher', required: false },
    { id: 'partyTwoName', label: 'Who is the second party?', placeholder: 'Artist, label, licensee, manager, or company name', required: true },
    { id: 'partyTwoRole', label: 'What is the second party role?', placeholder: 'Artist, Label, Licensee, Manager', required: false },
  ];

  if (/song|composition|track|recording|master|album|single|work/.test(lower)) {
    questions.push({ id: 'projectTitle', label: 'What song, master, project, or work is covered?', placeholder: 'Song or project title', required: true });
  }

  if (/royalt|commission|fee|payment|advance|compensation|net receipts|gross/.test(lower)) {
    questions.push({ id: 'compensation', label: 'What are the payment or compensation terms?', placeholder: 'Flat fee, advance, commission, royalties, or TBD', required: false });
    questions.push({ id: 'royaltyPercentage', label: 'Is there a royalty or percentage?', placeholder: '3%, 15%, none, or TBD', required: false });
  }

  if (/copyright|master|publishing|ownership|license|rights|exclusive/.test(lower)) {
    questions.push({ id: 'ownershipTerms', label: 'What ownership, rights, or license terms should be confirmed?', placeholder: 'Who owns the master/publishing, scope of license, exclusivity', required: false });
  }

  if (/term|duration|period|expire|perpetuity/.test(lower)) {
    questions.push({ id: 'term', label: 'How long should the agreement last?', placeholder: '1 year, 3 years, perpetual, or TBD', required: false });
  }

  if (/territory|worldwide|universe|country/.test(lower)) {
    questions.push({ id: 'territory', label: 'What territory applies?', placeholder: 'Worldwide, United States, or TBD', required: false });
  }

  questions.push({ id: 'notes', label: 'Any extra deal notes from the parties?', placeholder: 'Credits, delivery deadlines, approvals, restrictions', required: false });

  return questions;
}

const templates = manifest.templates.map((template) => {
  const filePath = join(extractDir, template.sourceFile);
  const text = existsSync(filePath) ? extractText(filePath) : '';
  const templateText = cleanTemplateText(text) || `${template.title}\n\nTemplate text could not be extracted with the local tools available. Use this source file as the approved reference: ${template.sourceFile}`;

  return {
    id: template.id,
    title: template.title,
    category: template.category,
    sourceFile: template.sourceFile,
    extension: template.extension,
    extractionQuality: text.length > 500 ? 'text' : text.length > 80 ? 'partial' : 'metadata_only',
    textPreview: templateText.slice(0, 1200),
    templateText: templateText.slice(0, 18000),
    questions: inferQuestionSpecs(template, templateText),
  };
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), templates }, null, 2)}\n`);

console.log(`Extracted template text for ${templates.length} files to ${outputPath}`);
