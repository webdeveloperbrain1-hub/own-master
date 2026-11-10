import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPrivateFileStore, privateFileConfiguration } from '../server/lib/storage/privateFiles.mjs';

const secret = 'sb_secret_test_only_key';
const settings = root => ({ FILE_STORAGE_BACKEND: 'supabase', CONTRACT_STORAGE_ROOT: root,
  SUPABASE_URL: 'https://testproject.supabase.co', SUPABASE_STORAGE_KEY: secret, SUPABASE_STORAGE_BUCKET: 'private-test' });

test('cloud uploads survive loss of local cache and are removed from both stores', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ownmasters-cloud-files-'));
  const objects = new Map();
  let downloads = 0;
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers.apikey, secret);
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    const pathname = new URL(url).pathname;
    if (pathname === '/storage/v1/bucket/private-test') return Response.json({ public: false });
    if (options.method === 'POST') {
      const chunks = [];
      for await (const chunk of options.body) chunks.push(chunk);
      objects.set(decodeURIComponent(pathname.split('/private-test/')[1]), Buffer.concat(chunks));
      return Response.json({});
    }
    if (options.method === 'DELETE') {
      for (const key of JSON.parse(options.body).prefixes) objects.delete(key);
      return Response.json({});
    }
    downloads++;
    const data = objects.get(decodeURIComponent(pathname.split('/private-test/')[1]));
    return data ? new Response(data) : new Response('', { status: 404 });
  };
  try {
    const store = createPrivateFileStore({ env: settings(root), fetchImpl });
    const file = path.join(root, 'project-audio', 'private recording');
    await fs.mkdir(path.dirname(file));
    await fs.writeFile(file, 'private audio bytes');
    await store.persist(file);
    await fs.unlink(file);
    await Promise.all([store.ensure(file), store.ensure(file)]);
    assert.equal(await fs.readFile(file, 'utf8'), 'private audio bytes');
    assert.equal(downloads, 1);
    await store.remove(file);
    assert.equal(objects.size, 0);
    await assert.rejects(fs.access(file));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('cloud mode rejects anon credentials, public buckets and paths outside private storage', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ownmasters-cloud-boundary-'));
  try {
    assert.throws(() => privateFileConfiguration({ ...settings(root), SUPABASE_STORAGE_KEY: 'anon-key' }), /server-only/);
    const store = createPrivateFileStore({ env: settings(root), fetchImpl: async () => Response.json({ public: true }) });
    await assert.rejects(store.verify(), /must be private/);
    await assert.rejects(store.persist(path.join(root, '..', '.env')), /inside CONTRACT_STORAGE_ROOT/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('provider failures do not reveal credentials and never leave a partial download', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ownmasters-cloud-error-'));
  try {
    const store = createPrivateFileStore({ env: settings(root), fetchImpl: async url =>
      url.includes('/bucket/') ? Response.json({ public: false }) : new Response(secret, { status: 500 }) });
    await assert.rejects(store.ensure(path.join(root, 'missing')), error => {
      assert.equal(error.status, 503);
      assert.ok(!error.message.includes(secret));
      return true;
    });
    assert.deepEqual(await fs.readdir(root), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
