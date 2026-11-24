import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { contentDisposition } from '../server/lib/http/downloadHeaders.mjs';

await mkdir(resolve('.codex'), { recursive: true });
const bundlePath = resolve(`.codex/browser-data-tests-${process.pid}.mjs`);
const bundle = await build({
  stdin: { contents: `
    export { migrateBrowserProjects } from './src/app/data/musicProjects';
    export { downloadFileName } from './src/app/data/apiClient';
  `, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env': JSON.stringify({ VITE_API_BASE_URL: '' }) },
});
await writeFile(bundlePath, bundle.outputFiles[0].contents);
const { migrateBrowserProjects, downloadFileName } = await import(pathToFileURL(bundlePath).href);
after(() => unlink(bundlePath));

test('downloads retain international filenames and fall back safely for older or malformed headers', () => {
  const name = 'Artist’s agreement – 東京 (final).pdf';
  const header = contentDisposition(name, 'inline');
  assert.match(header, /^[\x20-\x7e]+$/);
  assert.ok(header.startsWith('inline;'));
  assert.equal(downloadFileName(header, 'original.pdf'), name);
  assert.equal(downloadFileName('attachment; filename="signed.pdf"', 'original.pdf'), 'signed.pdf');
  assert.equal(downloadFileName('attachment; filename=signed.pdf', 'original.pdf'), 'signed.pdf');
  assert.equal(downloadFileName(`attachment; filename="signed.pdf"; filename*=UTF-8''%ZZ`, 'original.pdf'), 'signed.pdf');
  assert.equal(downloadFileName(null, 'original.pdf'), 'original.pdf');
});

test('older tracks import when browser storage is full and server IDs prevent duplicate imports', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const owner = 'track-owner';
  const sourceKey = `own_masters_music_projects_${owner}`;
  const markerKey = `own_masters_imported_music_projects_${owner}`;
  const legacy = [
    { id: 'old-one', title: 'First song', lyrics: 'Keep these lyrics' },
    { id: 'old-two', title: 'Second song', lyrics: 'And these lyrics' },
  ];
  const source = JSON.stringify(legacy);
  let posts = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => key === sourceKey ? source : null,
    setItem: (key: string) => { assert.equal(key, markerKey); throw new Error('QuotaExceededError'); },
  } });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/projects');
    assert.equal(init?.method, 'POST');
    const body = JSON.parse(String(init?.body));
    posts++;
    return Response.json({ ...body, id: `saved-${body.legacyId}`, updatedAt: `2026-11-0${posts}T00:00:00Z` });
  };
  try {
    const projects = await migrateBrowserProjects(owner, []);
    assert.deepEqual(projects.map((project: { title: string }) => project.title), ['Second song', 'First song']);
    assert.equal(posts, 2);
    assert.equal(localStorage.getItem(sourceKey), source, 'original browser tracks remain available');
    assert.deepEqual(await migrateBrowserProjects(owner, projects), projects);
    assert.equal(posts, 2, 'server legacy IDs replace unavailable browser markers');
    assert.deepEqual(await migrateBrowserProjects('account-without-older-tracks', []), []);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
