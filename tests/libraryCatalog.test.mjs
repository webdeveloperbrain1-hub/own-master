import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { buildLibraryCatalog, filterLibraryCatalog, libraryCatalogSummary, publicCatalogEntry, sourceFingerprint } from '../server/lib/contractFiling/libraryCatalog.mjs';

const body = 'Artist and Producer agree to the following terms. The fee is $500 and royalties are 3%. This agreement applies worldwide for twelve months. Neither party may change these terms without written consent. Signed by both parties. '.repeat(2);
const file = (id, values = {}) => ({ id, originalName: `Producer Agreement ${id}.doc`, title: 'Producer Agreement', category: 'Legacy category', extension: '.doc', extractedText: body, textLength: body.length, extractionStatus: 'complete', extractionWarnings: [], analysisStatus: 'needs_review', needsReview: true, createdAt: `2026-01-0${id}T00:00:00.000Z`, ...values });
const verified = async (entry) => `source:${entry.extractedText}`;

test('verified duplicates are hidden reversibly without mutating records, IDs, or draft links', async () => {
  const files = [file('2', { drafts: [{ userId: 'owner' }] }), file('1')];
  const before = structuredClone(files);
  const catalog = await buildLibraryCatalog(files, { fingerprint: verified });
  assert.equal(catalog.length, 2);
  assert.deepEqual(files, before);
  assert.equal(catalog.find((entry) => entry.id === '2').duplicateOf, '1');
  assert.deepEqual(filterLibraryCatalog(catalog).map((entry) => entry.id), ['1']);
  assert.equal(filterLibraryCatalog(catalog, { includeDuplicates: true }).length, 2);
  assert.deepEqual(catalog.find((entry) => entry.id === '2').drafts, [{ userId: 'owner' }]);
  const reversed = await buildLibraryCatalog([...files].reverse(), { fingerprint: verified });
  assert.equal(reversed.find((entry) => entry.hiddenDuplicate).duplicateOf, '1');
});

test('same names, changed fees, punctuation, case, or one-word differences never hide distinct wording', async () => {
  const files = [body, body.replace('$500', '$501'), body.replace('3%', '4%'), body.replace('may', 'must'), body.replace('Artist', 'ARTIST'), body.replace('worldwide', 'world-wide')]
    .map((text, index) => file(String(index + 1), { originalName: 'Same Name.doc', extractedText: text }));
  const catalog = await buildLibraryCatalog(files, { fingerprint: verified });
  assert.equal(filterLibraryCatalog(catalog).length, files.length);
  assert.ok(catalog.every((entry) => entry.variant));
});

test('identical extracted bodies with different headers, notes, or unverifiable source files stay visible', async () => {
  const catalog = await buildLibraryCatalog([file('1'), file('2'), file('3')], {
    fingerprint: async (entry) => entry.id === '3' ? null : `different-header:${entry.id}`,
  });
  assert.ok(catalog.every((entry) => !entry.hiddenDuplicate));
});

test('failed, short, empty, and warning-bearing extractions are never used to hide copies', async () => {
  const files = [file('1'), file('2', { extractionStatus: 'failed' }), file('3', { extractedText: '' }), file('4', { extractedText: 'Short agreement.' }), file('5', { extractionWarnings: ['Missing section'] })];
  const catalog = await buildLibraryCatalog(files, { fingerprint: verified });
  assert.ok(catalog.every((entry) => !entry.hiddenDuplicate));
});

test('guides, useful categories, common types, variants, and processing labels are separate', async () => {
  const catalog = await buildLibraryCatalog([
    file('1', { originalName: 'Split sheet.doc' }),
    file('2', { originalName: 'Starting Your Own Publishing Company.pdf' }),
    file('3', { originalName: 'Contract Description and Usages - READ ME.pdf' }),
    file('4', { originalName: 'RECORDING CONTRACT III.doc', extractedText: `${body}Extra terms.` }),
    file('5', { originalName: 'booking_contract.pdf', extractedText: `${body}Live performance.` }),
  ], { fingerprint: async (entry) => entry.id });
  assert.equal(filterLibraryCatalog(catalog, { kind: 'guide' }).length, 2);
  assert.equal(filterLibraryCatalog(catalog).length, 3);
  assert.equal(filterLibraryCatalog(catalog, { commonOnly: true }).length, 2);
  assert.equal(filterLibraryCatalog(catalog, { category: 'Live Performance' })[0].id, '5');
  assert.equal(catalog.find((entry) => entry.id === '4').title, 'Recording Contract III');
  const [qualified] = await buildLibraryCatalog([file('6', { originalName: 'Agency Agreement.pdf', title: 'AGENCY AGREEMENT (NON-EXCLUSIVE)' })]);
  assert.equal(qualified.title, 'Agency Agreement (Non-Exclusive)');
  assert.equal(catalog[0].extractionLabel, 'Text extracted');
  assert.equal(catalog[0].analysisLabel, 'Analysis not completed');
  const summary = libraryCatalogSummary(catalog);
  assert.equal(summary.total, summary.templates + summary.guides + summary.hiddenDuplicates);
});

test('search finds hidden source filenames through their visible canonical entry without searching contract bodies', async () => {
  const catalog = await buildLibraryCatalog([file('1'), file('2', { originalName: 'Unique Alias.doc' })], { fingerprint: verified });
  assert.deepEqual(filterLibraryCatalog(catalog, { query: 'unique alias' }).map((entry) => entry.id), ['1']);
  assert.equal(filterLibraryCatalog(catalog, { query: 'worldwide' }).length, 0);
  assert.equal(filterLibraryCatalog(catalog, { query: 'legacy CATEGORY' }).length, 1);
});

test('public catalog data excludes source paths and document text, and counts only the requesting owner drafts', async () => {
  const [entry] = await buildLibraryCatalog([file('1', { storedPath: '/private/source.doc', drafts: [{ userId: 'owner' }, { userId: 'someone-else' }] })]);
  const result = publicCatalogEntry(entry, 'owner');
  assert.equal(result.draftCount, 1);
  assert.equal(result.storedPath, undefined);
  assert.equal(result.extractedText, undefined);
  assert.equal(result.drafts, undefined);
});

test('source verification reads Word ancillary sections and leaves source files untouched', async () => {
  const zip = new AdmZip(fileURLToPath(new URL('../server/assets/contract-library.zip', import.meta.url)));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'own-masters-catalog-'));
  const load = async (name) => {
    const entry = zip.getEntries().find((entry) => entry.entryName.split('/').pop() === name);
    assert.ok(entry, `Bundled source fixture: ${name}`);
    const bytes = entry.getData();
    const storedPath = path.join(directory, name);
    await fs.writeFile(storedPath, bytes);
    return { storedPath, extension: '.doc', sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  try {
    const a = await load('booking_contract.doc');
    const b = await load('BOOKING CONTRACT.doc');
    assert.equal(await sourceFingerprint(a), await sourceFingerprint(b));
    const c = await load('event_sponsorship_contract.doc');
    const d = await load('EVENT SPONSORSHIP CONTRACT.doc');
    assert.notEqual(await sourceFingerprint(c), await sourceFingerprint(d));
    for (const source of [a, b, c, d]) assert.equal(createHash('sha256').update(await fs.readFile(source.storedPath)).digest('hex'), source.sha256);
    assert.equal(await sourceFingerprint({ ...a, sha256: 'invalid' }), null);
    assert.equal(await sourceFingerprint({ storedPath: path.join(directory, 'missing.doc') }), null);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
