import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStaticSite } from '../server/lib/deployment/staticSite.mjs';
import { productionSiteErrors, publicSiteConfiguration } from '../server/lib/deployment/siteConfiguration.mjs';
import { contractStoragePaths } from '../server/lib/contracts/storagePaths.mjs';
import { requireLocalAuth } from '../server/lib/auth/localAuth.mjs';
import { requestAIJsonResult } from '../server/lib/ai/openaiClient.mjs';
import { analyzeContract } from '../server/lib/contractFiling/aiAnalyzer.mjs';
import { scanTemplateFieldsWithAI } from '../server/lib/contractFiling/fieldContextScanner.mjs';

test('production serves deep links and assets while keeping API errors and private files out of the SPA', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ownmasters-web-test-'));
  const root = path.join(temporary, 'dist');
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>Own Masters</title>');
  await fs.writeFile(path.join(root, 'assets', 'main-123.js'), 'console.log("Own Masters");');
  await fs.writeFile(path.join(temporary, '.env'), 'must-stay-private');
  await fs.mkdir(path.join(temporary, 'private'));
  await fs.writeFile(path.join(temporary, 'private', 'secret.txt'), 'must-stay-private');
  await fs.symlink(path.join(temporary, 'private'), path.join(root, 'outside'), 'junction');
  const serve = createStaticSite(root);
  const server = createServer(async (req, res) => {
    try {
      if (await serve(req, res, new URL(req.url, 'http://test.internal'))) return;
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"Not found."}');
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ['/', '/login', '/auth/confirm?next=%2Fdashboard', '/dashboard/contracts/drafts/example/edit', '/privacy']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.equal(response.headers.get('cache-control'), 'no-cache');
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
    }
    const asset = await fetch(base + '/assets/main-123.js');
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /javascript/);
    assert.match(asset.headers.get('cache-control'), /immutable/);
    const head = await fetch(base + '/login', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    for (const route of ['/api', '/api/missing', '/api/assets/missing.js']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 404);
      assert.match(response.headers.get('content-type'), /application\/json/);
    }
    for (const route of ['/.env', '/%2eenv', '/.git/config', '/assets/missing.js', '/server/apiServer.mjs', '/outside/secret.txt', '/assets/%2e%2e/%2eenv', '/%5c..%5c.env', '/%ZZ']) {
      const response = await fetch(base + route);
      assert.ok([400, 404].includes(response.status), route);
      assert.doesNotMatch(await response.text(), /must-stay-private|<!doctype/);
    }
    const mutation = await fetch(base + '/login', { method: 'POST' });
    assert.equal(mutation.status, 405);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('public settings expose only operator information and require a real support contact for deployment', () => {
  const configured = { BUSINESS_NAME: 'Own Masters', SUPPORT_EMAIL: 'support@ownmasters.com', CONTRACT_STORAGE_ROOT: path.join(os.tmpdir(), 'ownmasters-test-root'), AI_FEATURES_ENABLED: 'false', SMTP_PASSWORD: 'private', DATABASE_URL: 'private' };
  assert.deepEqual(productionSiteErrors(configured), []);
  assert.deepEqual(publicSiteConfiguration(configured), { businessName: 'Own Masters', supportEmail: 'support@ownmasters.com', aiEnabled: false });
  assert.equal(publicSiteConfiguration({}).aiEnabled, false);
  assert.ok(productionSiteErrors({}).length >= 2);
  assert.ok(productionSiteErrors({ ...configured, SUPPORT_EMAIL: 'support@your-domain.example' }).length);
  assert.ok(productionSiteErrors({ ...configured, AI_FEATURES_ENABLED: 'yes' }).length);
  assert.ok(productionSiteErrors({ ...configured, GENERATED_CONTRACT_DIR: path.join(os.tmpdir(), 'outside-storage') }).length);
});

test('all default contract output directories use the configured persistent storage root', () => {
  const keys = ['CONTRACT_STORAGE_ROOT', 'CONTRACT_ZIP_DIR', 'CONTRACT_TEMPLATE_DIR', 'GENERATED_CONTRACT_DIR', 'TMP_DIR'];
  const previous = keys.map(key => process.env[key]);
  try {
    for (const key of keys) delete process.env[key];
    process.env.CONTRACT_STORAGE_ROOT = path.join(os.tmpdir(), 'ownmasters-persistent');
    const storage = contractStoragePaths();
    for (const [name, directory] of Object.entries(storage))
      assert.ok(directory === storage.root || directory.startsWith(storage.root + path.sep), name);
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

test('a forged demo header never grants account or administrator access, including in development', async () => {
  const previous = process.env.NODE_ENV;
  try {
    for (const mode of ['development', 'production']) {
      process.env.NODE_ENV = mode;
      await assert.rejects(requireLocalAuth({ headers: { 'x-own-masters-demo': 'true' } }), { status: 401 });
    }
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test('the initial release never contacts an AI provider while AI assistance is disabled', async () => {
  const previous = process.env.AI_FEATURES_ENABLED;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    process.env.AI_FEATURES_ENABLED = 'false';
    globalThis.fetch = async () => { calls++; throw new Error('Unexpected AI request'); };
    const result = await requestAIJsonResult({ messages: [] });
    assert.equal(result.provider, 'disabled');
    assert.equal(result.json, null);
    const analysis = await analyzeContract({ originalName: 'agreement.txt', text: 'Artist agreement between __________ and __________.' });
    assert.equal(analysis.needsReview, true);
    const fields = await scanTemplateFieldsWithAI({ extractedText: 'Artist name: __________', originalName: 'agreement.txt' });
    assert.equal(fields.analyzerModel, 'deterministic-fallback');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.AI_FEATURES_ENABLED;
    else process.env.AI_FEATURES_ENABLED = previous;
  }
});
