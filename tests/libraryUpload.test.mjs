import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { prisma } from '../server/lib/prisma.mjs';
import { handleAuthRoutes, requireLocalAuth, assertTrustedMutation, hashPassword } from '../server/lib/auth/localAuth.mjs';
import { handleFilingRoutes } from '../server/lib/contractFiling/filingApi.mjs';
import { MAX_LIBRARY_UPLOAD_BYTES, validateLibraryUpload } from '../server/lib/contractFiling/libraryUpload.mjs';

test('only a signed-in administrator can upload a shared contract; duplicates preserve the original', async () => {
  const tag = randomUUID();
  const password = 'trial123';
  const users = [];
  const addedIds = [];
  const addedPaths = [];
  const previousEnv = Object.fromEntries(['FILE_STORAGE_BACKEND', 'SUPABASE_URL', 'SUPABASE_STORAGE_KEY', 'SUPABASE_STORAGE_BUCKET'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { FILE_STORAGE_BACKEND: 'supabase', SUPABASE_URL: 'https://upload-test.supabase.co', SUPABASE_STORAGE_KEY: 'sb_secret_upload_test_only', SUPABASE_STORAGE_BUCKET: 'upload-test' });
  const originalFetch = globalThis.fetch;
  const objects = new Map();
  let storageUnavailable = false;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://upload-test.supabase.co/')) return originalFetch(url, options);
    if (storageUnavailable) return new Response('', { status: 503 });
    const pathname = new URL(url).pathname;
    if (pathname === '/storage/v1/bucket/upload-test') return Response.json({ public: false });
    const key = decodeURIComponent(pathname.split('/upload-test/')[1]);
    if (options.method === 'POST') {
      const chunks = [];
      for await (const chunk of options.body) chunks.push(chunk);
      objects.set(key, Buffer.concat(chunks));
      return Response.json({});
    }
    return objects.has(key) ? new Response(objects.get(key)) : new Response('', { status: 404 });
  };
  const server = createServer(async (req, res) => {
    const sendJson = (response, status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(data));
    };
    try {
      assertTrustedMutation(req);
      const ctx = {
        url: new URL(req.url, 'http://localhost'), sendJson, requireAuth: requireLocalAuth,
        readBody: async (request) => { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks)); },
      };
      if (await handleAuthRoutes(req, res, ctx)) return;
      if (await handleFilingRoutes(req, res, ctx)) return;
      sendJson(res, 404, { error: 'Not found.' });
    } catch (error) { sendJson(res, error.status || 500, { error: error.message }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const name = `Studio agreement ${tag}.txt`;
  const content = `STUDIO AGREEMENT ${tag}\nArtist: __________\nProducer: __________\nThe parties agree that the producer shall provide recording services for a fee of ________.`;
  const route = `/api/filing/upload?name=${encodeURIComponent(name)}`;
  const upload = (cookie = '', path = route, body = content, extraHeaders = {}) => fetch(`${base}${path}`, {
    method: 'POST', headers: { Cookie: cookie, 'X-Own-Masters-Request': 'true', ...extraHeaders }, body,
  });
  try {
    const passwordHash = await hashPassword(password);
    for (const role of ['admin', 'member']) {
      users.push(await prisma.accountUser.create({ data: {
        email: `${role}-${tag}@example.test`, name: role, passwordHash, role, emailVerifiedAt: new Date(),
      } }));
    }
    const cookies = [];
    for (const user of users) {
      const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password }) });
      assert.equal(login.status, 200);
      assert.equal((await login.json()).user.app_metadata.role, user.role);
      cookies.push(login.headers.get('set-cookie').split(';')[0]);
    }
    const [admin, member] = cookies;
    assert.equal((await upload()).status, 401);
    assert.equal((await upload(member)).status, 403);
    assert.equal((await upload(admin, route, content, { 'X-Own-Masters-Request': '' })).status, 403);
    assert.equal((await upload(admin, '/api/filing/upload?name=attack.exe')).status, 400);
    assert.equal((await upload(admin, '/api/filing/upload?name=..%2Fcontract.txt')).status, 400);
    assert.equal((await upload(admin, route, '')).status, 400);
    assert.equal((await upload(admin, '/api/filing/upload?name=fake.pdf')).status, 400);
    assert.throws(() => validateLibraryUpload(name, Buffer.alloc(MAX_LIBRARY_UPLOAD_BYTES + 1)), error => error.status === 413);
    const response = await upload(admin);
    assert.equal(response.status, 201);
    const result = await response.json();
    addedIds.push(result.id);
    assert.equal(result.duplicate, false);
    assert.equal(result.storedPath, undefined);
    const saved = await prisma.contractFile.findUniqueOrThrow({ where: { id: result.id } });
    addedPaths.push(saved.storedPath);
    assert.equal(await fs.readFile(saved.storedPath, 'utf8'), content);
    assert.match(saved.extractedText, /STUDIO AGREEMENT/);
    const duplicate = await upload(admin);
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await duplicate.json(), { id: result.id, originalName: name, duplicate: true, needsReview: saved.needsReview });
    assert.equal(objects.size, 1, 'the uploaded original must reach private cloud storage even without AI analysis');
    await fs.unlink(saved.storedPath);
    const list = await fetch(`${base}/api/filing/templates?q=${encodeURIComponent(tag)}`, { headers: { Cookie: member } });
    assert.equal(list.status, 200);
    assert.ok((await list.json()).some(entry => entry.id === result.id));
    const original = await fetch(`${base}/api/filing/templates/${result.id}/original`, { headers: { Cookie: member } });
    assert.equal(original.status, 200);
    assert.equal(await original.text(), content);
    assert.equal(await fs.readFile(saved.storedPath, 'utf8'), content, 'a lost local cache is restored from private storage');
    storageUnavailable = true;
    const failedContent = `${content}\nUnpersisted ${tag}`;
    const failed = await upload(admin, route, failedContent);
    assert.equal(failed.status, 422);
    assert.equal(await prisma.contractFile.count({ where: { originalName: name } }), 1, 'storage failures must not publish a new library record');
    // Clean up the failed attempt's local cache as well.
    const { createHash } = await import('node:crypto');
    const { safeStoredName } = await import('../server/lib/contractFiling/fileUtils.mjs');
    const { config } = await import('../server/lib/contractFiling/filingConfig.mjs');
    const { join } = await import('node:path');
    addedPaths.push(join(config.storageDir, 'originals', safeStoredName(createHash('sha256').update(failedContent).digest('hex'), name)));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await prisma.contractFile.deleteMany({ where: { id: { in: addedIds } } });
    await prisma.accountUser.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    await Promise.all(addedPaths.map(file => fs.rm(file, { force: true })));
    await prisma.$disconnect();
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
