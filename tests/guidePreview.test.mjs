import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { prisma } from '../server/lib/prisma.mjs';
import { handleFilingRoutes } from '../server/lib/contractFiling/filingApi.mjs';

test('guide previews require authentication, return read-only guide data, and cannot mutate original files or drafts', async () => {
  const owner = `guide-preview-test-${randomUUID()}`;
  const server = createServer(async (req, res) => {
    const sendJson = (response, status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(data));
    };
    try {
      const matched = await handleFilingRoutes(req, res, {
        url: new URL(req.url, 'http://localhost'), sendJson,
        requireAuth: async () => {
          if (req.headers['x-test-guide-user'] !== owner) throw Object.assign(new Error('Authentication required.'), { status: 401 });
          return { user: { id: owner }, isDemo: false };
        },
        readBody: async () => { throw new Error('Read-only guide routes must not read a mutation body.'); },
      });
      if (!matched) sendJson(res, 404, { error: 'Not found.' });
    } catch (error) { sendJson(res, error.status || 500, { error: error.message }); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (route, options = {}) => fetch(`${base}${route}`, { headers: { 'X-Test-Guide-User': owner }, ...options });
  try {
    const listResponse = await call('/api/filing/templates?kind=guide');
    assert.equal(listResponse.status, 200);
    const guides = await listResponse.json();
    assert.equal(guides.length, 2);
    const ids = guides.map((guide) => guide.id);
    const records = await prisma.contractFile.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
    const before = JSON.parse(JSON.stringify(records));
    const beforeDrafts = await prisma.contractDraft.findMany({ where: { templateId: { in: ids } }, orderBy: { id: 'asc' } });
    for (const guide of guides) {
      const response = await call(`/api/filing/guides/${guide.id}`);
      assert.equal(response.status, 200);
      const preview = await response.json();
      assert.equal(preview.readOnly, true);
      assert.equal(preview.title, guide.title);
      assert.equal(preview.format, 'pdf');
      assert.ok(preview.text.length > 200);
      assert.equal(preview.storedPath, undefined);
      assert.equal(preview.sha256, undefined);
      const original = records.find((record) => record.id === guide.id);
      assert.equal(preview.text, original.extractedText);
      assert.equal(createHash('sha256').update(await fs.readFile(original.storedPath)).digest('hex'), original.sha256);
      assert.equal((await call(`/api/filing/guides/${guide.id}`, { headers: {} })).status, 401);
      assert.equal((await call(`/api/filing/guides/${guide.id}`, { method: 'POST', body: JSON.stringify({ text: 'Replace the guide' }) })).status, 404);
    }
    assert.equal((await call('/api/filing/guides/does-not-exist')).status, 404);
    const templates = await (await call('/api/filing/templates')).json();
    assert.equal((await call(`/api/filing/guides/${templates[0].id}`)).status, 404);
    assert.deepEqual(JSON.parse(JSON.stringify(await prisma.contractFile.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } }))), before);
    assert.deepEqual(await prisma.contractDraft.findMany({ where: { templateId: { in: ids } }, orderBy: { id: 'asc' } }), beforeDrafts);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
