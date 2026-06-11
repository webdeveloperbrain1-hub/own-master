import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, basename, resolve } from 'node:path';

const zipPath = process.argv[2];
const outputPath = resolve(process.cwd(), 'server/data/contract-library.manifest.json');

if (!zipPath) {
  console.error('Usage: node server/scripts/ingestContractZip.mjs <zip-path>');
  process.exit(1);
}

const rawEntries = execFileSync('tar', ['-tf', zipPath], { encoding: 'utf8' })
  .split(/\r?\n/)
  .map((entry) => entry.trim())
  .filter(Boolean)
  .filter((entry) => /\.(pdf|docx?|rtf)$/i.test(entry))
  .filter((entry) => !basename(entry).startsWith('~$'));

function titleFromFile(entry) {
  return basename(entry, extname(entry))
    .replace(/\s*\(\d+\)\s*$/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function categoryFor(title) {
  const lower = title.toLowerCase();

  if (lower.includes('producer')) return 'Producer Agreements';
  if (lower.includes('management') || lower.includes('manager')) return 'Management Agreements';
  if (lower.includes('record')) return 'Recording Agreements';
  if (lower.includes('songwriter') || lower.includes('publishing') || lower.includes('publisher')) return 'Publishing and Songwriter Agreements';
  if (lower.includes('license') || lower.includes('licensing') || lower.includes('copyright')) return 'Licenses and Copyright';
  if (lower.includes('booking') || lower.includes('performance') || lower.includes('event')) return 'Booking and Performance';
  if (lower.includes('distribution')) return 'Distribution Agreements';
  if (lower.includes('royalty')) return 'Royalty Agreements';
  if (lower.includes('split')) return 'Split Sheets';
  return 'Music Business Contracts';
}

function keywordsFor(title, category) {
  return Array.from(
    new Set(
      `${title} ${category}`
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 2 && !['the', 'and', 'for', 'contract', 'agreement'].includes(word)),
    ),
  ).slice(0, 18);
}

const seen = new Set();
const templates = rawEntries.map((entry) => {
  const title = titleFromFile(entry);
  const category = categoryFor(title);
  let id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let suffix = 2;

  while (seen.has(id)) {
    id = `${id}-${suffix}`;
    suffix += 1;
  }

  seen.add(id);

  return {
    id,
    title,
    category,
    sourceFile: entry,
    extension: extname(entry).slice(1).toLowerCase(),
    description: `${title} from the uploaded Own Masters music contract library.`,
    keywords: keywordsFor(title, category),
  };
});

const manifest = {
  sourceZip: zipPath,
  generatedAt: new Date().toISOString(),
  totalTemplates: templates.length,
  templates,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Wrote ${templates.length} contract templates to ${outputPath}`);
