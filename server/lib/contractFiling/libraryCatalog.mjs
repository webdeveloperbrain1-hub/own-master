import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import WordExtractor from 'word-extractor';

const fingerprintCache = new Map();
const digest = (value) => createHash('sha256').update(value).digest('hex');
const normalizeText = (value) => String(value || '').replace(/\r\n?/g, '\n').trim();
const categories = [
  [/booking|performance|concert|tech rider|sound.*light|union booking/i, 'Live Performance', 'Agreements and supporting documents for bookings, performances, and live events.'],
  [/licen[cs]|copyright|synchroni[sz]|master use|broadcast release|video release/i, 'Licensing & Copyright', 'Documents concerning permission to use music, recordings, or related rights.'],
  [/management|manager|agency|\bagent\b/i, 'Management & Representation', 'Agreements between creators and their managers, agents, or representatives.'],
  [/distribution|marketing|promot|publicity|publicist|merchand|sponsor/i, 'Marketing & Distribution', 'Agreements for distribution, promotion, sponsorship, and merchandise.'],
  [/producer|production|record|studio|vocalist/i, 'Production & Recording', 'Agreements concerning recording sessions, production services, and recordings.'],
  [/split sheet|songwriter|composer|publish|royalty sharing/i, 'Songwriting & Publishing', 'Documents concerning songwriting contributions, publishing, and royalty arrangements.'],
  [/royalt|payment|obligation to pay/i, 'Royalties & Payments', 'Agreements and schedules concerning royalties, payments, and accounting.'],
];

export function describeLibraryFile(file) {
  const stem = file.originalName.replace(/\.[^.]+$/, '').replace(/\b(composer|songwriter|artist)_s\b/ig, "$1's").replace(/_/g, ' ').replace(/producercomposer/ig, 'Producer Composer').replace(/producermanager/ig, 'Producer Manager').replace(/\s+/g, ' ').trim().replace(/\s+\(\d+\)$/, '');
  const qualifiers = [...String(file.title || '').matchAll(/\(([^)]+)\)/g)]
    .map((match) => match[1]).filter((value) => !/^\d+$/.test(value) && !stem.toLowerCase().includes(value.toLowerCase()));
  const displayName = `${stem}${qualifiers.map((value) => ` (${value})`).join('')}`;
  const title = displayName.replace(/\b[A-Za-z][A-Za-z']*\b/g, (word) =>
    /^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|TV|DJ|LLC|PDF)$/i.test(word) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1).toLowerCase());
  const guide = /read[ -]?me|contract description and usages|starting your own publishing company|how to start.*publishing/i.test(`${file.originalName} ${file.title || ''}`);
  const match = categories.find(([pattern]) => pattern.test(stem));
  const category = guide ? 'Guides & Resources' : match?.[1] || 'Business & Administration';
  return {
    title,
    category,
    kind: guide ? 'guide' : 'template',
    description: guide ? 'Reference material to read alongside the contract library.' : match?.[2] || 'Supporting agreements and forms for business relationships and administration.',
    // Common types are starting points, not a claim of legal or content approval.
    commonType: !guide && /^(?:split sheet|artist.producer contract|producer.simple.agreement|booking contract|publishing agreement)$/i.test(stem),
    extractionLabel: file.extractionStatus === 'complete' ? 'Text extracted' : 'Check source text',
    analysisLabel: file.analysisStatus === 'complete' ? (file.needsReview ? 'Analysis needs review' : 'Analysis available') : 'Analysis not completed',
  };
}

/** Verify candidate copies against source text, including Word headers, footers,
 * notes, comments, and text boxes. A body-only extraction is not enough.
 * Unsupported formats and unreadable sources remain visible unless byte-identical.
 */
export async function sourceFingerprint(file) {
  if (!file.storedPath) return null;
  try {
    const stat = await fs.stat(file.storedPath);
    const cacheKey = `${file.storedPath}:${file.sha256}:${stat.size}:${stat.mtimeMs}`;
    if (fingerprintCache.has(cacheKey)) return fingerprintCache.get(cacheKey);
    const bytes = await fs.readFile(file.storedPath);
    if (digest(bytes) !== file.sha256) return null;
    let fingerprint = `bytes:${file.sha256}`;
    if (file.extension?.toLowerCase() === '.doc') {
      const document = await new WordExtractor().extract(bytes);
      const parts = ['getBody', 'getHeaders', 'getFooters', 'getFootnotes', 'getEndnotes', 'getAnnotations', 'getTextboxes']
        .map((method) => normalizeText(document[method]({ filterUnicode: false, includeFooters: false })));
      if (parts[0].length < 200) return null;
      fingerprint = `doc:${digest(JSON.stringify(parts))}`;
    }
    if (fingerprintCache.size > 1000) fingerprintCache.clear();
    fingerprintCache.set(cacheKey, fingerprint);
    return fingerprint;
  } catch { return null; }
}

export async function buildLibraryCatalog(files, { fingerprint = sourceFingerprint } = {}) {
  const entries = files.map((file) => ({
    ...file, ...describeLibraryFile(file), sourceTitle: file.title, sourceCategory: file.category,
    hiddenDuplicate: false, duplicateOf: null, duplicateCount: 0, duplicateNames: [], variant: null,
  }));
  // Require the entire extracted body to match. Never use filename similarity,
  // fuzzy matching, case folding, or removal of numbers/punctuation to hide files.
  const candidates = new Map();
  for (const entry of entries) {
    const text = normalizeText(entry.extractedText);
    if (entry.extractionStatus !== 'complete' || entry.extractionWarnings?.length || text.length < 200) continue;
    const key = digest(text);
    const group = candidates.get(key) || [];
    group.push(entry);
    candidates.set(key, group);
  }
  for (const group of candidates.values()) {
    if (group.length < 2) continue;
    const verified = new Map();
    for (const entry of group) {
      const key = await fingerprint(entry);
      if (!key) continue;
      const matches = verified.get(key) || [];
      matches.push(entry);
      verified.set(key, matches);
    }
    for (const matches of verified.values()) {
      if (matches.length < 2) continue;
      matches.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id));
      const canonical = matches[0];
      canonical.duplicateCount = matches.length - 1;
      canonical.duplicateNames = matches.slice(1).map((entry) => entry.originalName);
      for (const duplicate of matches.slice(1)) {
        duplicate.hiddenDuplicate = true;
        duplicate.duplicateOf = canonical.id;
        duplicate.duplicateReason = 'Matching full source text; original file retained.';
      }
    }
  }
  const variants = new Map();
  for (const entry of entries.filter((entry) => !entry.hiddenDuplicate)) {
    const key = entry.title.replace(/\s*\(\d+\)$/, '').toLowerCase();
    const group = variants.get(key) || [];
    group.push(entry);
    variants.set(key, group);
  }
  for (const group of variants.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.originalName.localeCompare(b.originalName) || a.id.localeCompare(b.id));
    group.forEach((entry, index) => { entry.variant = `Source variant ${index + 1} of ${group.length}`; });
  }
  return entries.sort((a, b) => Number(b.commonType) - Number(a.commonType) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export function filterLibraryCatalog(entries, { query = '', kind = 'template', category = '', includeDuplicates = false, commonOnly = false } = {}) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter((entry) =>
    (includeDuplicates || !entry.hiddenDuplicate) &&
    (kind === 'all' || entry.kind === kind) &&
    (!category || entry.category === category) &&
    (!commonOnly || entry.commonType) &&
    terms.every((term) => [entry.originalName, entry.title, entry.sourceTitle, entry.contractType, entry.category, entry.sourceCategory, ...entry.duplicateNames]
      .some((value) => String(value || '').toLowerCase().includes(term))));
}

export function libraryCatalogSummary(entries) {
  const visible = entries.filter((entry) => !entry.hiddenDuplicate);
  return {
    total: entries.length,
    templates: visible.filter((entry) => entry.kind === 'template').length,
    guides: visible.filter((entry) => entry.kind === 'guide').length,
    hiddenDuplicates: entries.length - visible.length,
    needsReview: entries.filter((entry) => entry.needsReview).length,
    complete: entries.filter((entry) => entry.analysisStatus === 'complete').length,
    failedExtraction: visible.filter((entry) => entry.extractionStatus !== 'complete').length,
    categories: [...new Set(visible.filter((entry) => entry.kind === 'template').map((entry) => entry.category))].sort()
      .map((category) => ({ category, _count: { _all: visible.filter((entry) => entry.kind === 'template' && entry.category === category).length } })),
  };
}

export function publicCatalogEntry(entry, userId) {
  const { id, originalName, title, contractType, category, summary, textLength, kind, description, commonType, extractionLabel, analysisLabel, hiddenDuplicate, duplicateOf, duplicateCount, duplicateReason, variant } = entry;
  return { id, originalName, title, contractType, category, summary, textLength, kind, description, commonType, extractionLabel, analysisLabel, hiddenDuplicate, duplicateOf, duplicateCount, duplicateReason, variant,
    draftCount: entry.drafts?.filter((draft) => draft.userId === userId).length || 0 };
}
