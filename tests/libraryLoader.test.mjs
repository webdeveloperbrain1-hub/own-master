import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createLibraryLoader } from '../server/lib/contractFiling/libraryLoader.mjs';
import { config } from '../server/lib/contractFiling/filingConfig.mjs';

test('startup and concurrent requests wait for one import and reuse the result', async () => {
  let imports = 0;
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  const summary = { imported: 204, duplicates: 13, failed: 0 };
  const load = createLibraryLoader({
    findArchive: async () => 'contracts.zip',
    importArchive: async (archive, options) => {
      imports++;
      assert.equal(archive, 'contracts.zip');
      assert.equal(options.analyze, 'local');
      await ready;
      return summary;
    },
  });
  const startup = load();
  const request = load();
  assert.equal(startup, request);
  release();
  assert.equal(await startup, summary);
  assert.equal(await load(), summary);
  assert.equal(imports, 1);
});

test('a temporary import failure can be retried automatically', async () => {
  let attempts = 0;
  const load = createLibraryLoader({
    findArchive: async () => 'contracts.zip',
    importArchive: async () => {
      if (++attempts === 1) throw new Error('Database temporarily unavailable');
      return { imported: 204, failed: 0 };
    },
  });
  await assert.rejects(load(), /temporarily unavailable/);
  assert.equal((await load()).imported, 204);
  assert.equal(attempts, 2);
});

test('partial imports retry instead of being marked ready', async () => {
  let attempts = 0;
  const load = createLibraryLoader({
    findArchive: async () => 'contracts.zip',
    importArchive: async () => ({ imported: 1, failed: ++attempts === 1 ? 1 : 0 }),
  });
  await assert.rejects(load(), /Could not load 1/);
  assert.equal((await load()).failed, 0);
});

test('the bundled archive loads when an optional external archive is missing', async () => {
  const original = config.contractZipPath;
  try {
    config.contractZipPath = path.resolve('missing-library-override.zip');
    const load = createLibraryLoader({
      importArchive: async (archive) => {
        assert.equal(path.basename(archive), 'contract-library.zip');
        assert.ok((await fs.stat(archive)).size > 0);
        return { imported: 0, duplicates: 217, failed: 0 };
      },
    });
    assert.equal((await load()).duplicates, 217);
  } finally {
    config.contractZipPath = original;
  }
});
