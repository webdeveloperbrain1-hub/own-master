import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authClientAddress, assertProductionAuthConfiguration, productionAuthErrors } from '../server/lib/auth/authConfiguration.mjs';
import { accountMailConfiguration } from '../server/lib/auth/accountMail.mjs';

const configured = {
  NODE_ENV: 'production', APP_ORIGIN: 'https://music.example.com', CORS_ORIGIN: 'https://music.example.com',
  DATABASE_URL: 'postgresql://app:dedicated-test-password@db.example.com:5432/app',
  EMAIL_DELIVERY_MODE: 'smtp', SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587',
  SMTP_FROM: 'Own Masters <hello@example.com>', SMTP_USER: 'sender', SMTP_PASSWORD: 'test-secret',
};

test('production accepts complete same-origin settings and rejects local preview, HTTP and mismatched origins', () => {
  assert.deepEqual(productionAuthErrors(configured), []);
  assert.doesNotThrow(() => assertProductionAuthConfiguration(configured));
  for (const overrides of [
    { APP_ORIGIN: 'http://music.example.com' }, { APP_ORIGIN: 'https://127.0.0.1' },
    { APP_ORIGIN: 'https://your-domain.example' },
    { APP_ORIGIN: 'https://music.example.com/path' }, { APP_ORIGIN: 'https://music.example.com/' },
    { CORS_ORIGIN: 'https://other.example.com' }, { VITE_API_BASE_URL: 'https://other-api.example.net' },
    { EMAIL_DELIVERY_MODE: 'preview' }, { SMTP_HOST: '' }, { SMTP_PORT: 'invalid' },
    { SMTP_USER: '' }, { SMTP_PASSWORD: '' }, { SMTP_FROM: 'sender\r\nBcc: another@example.com' },
    { DATABASE_URL: 'postgresql://ownmasters:ownmasters_password@localhost:5432/app' },
    { AUTH_TRUSTED_PROXY_IPS: '*' }, { AUTH_TRUSTED_PROXY_IPS: 'proxy.example.com' },
  ]) assert.throws(() => assertProductionAuthConfiguration({ ...configured, ...overrides }), /configuration is incomplete/);
  assert.doesNotThrow(() => assertProductionAuthConfiguration({ NODE_ENV: 'development' }));
});

test('only configured proxy socket IPs can supply forwarded rate-limit addresses', () => {
  const req = (remoteAddress, forwarded) => ({ socket: { remoteAddress }, headers: { 'x-forwarded-for': forwarded } });
  const trust = { AUTH_TRUSTED_PROXY_IPS: '127.0.0.1, ::1, 10.0.0.2' };
  assert.equal(authClientAddress(req('203.0.113.8', '198.51.100.9'), trust), '203.0.113.8');
  assert.equal(authClientAddress(req('127.0.0.1', '198.51.100.9'), {}), '127.0.0.1');
  assert.equal(authClientAddress(req('::ffff:127.0.0.1', '198.51.100.9'), trust), '198.51.100.9');
  assert.equal(authClientAddress(req('::1', '198.51.100.9, 10.0.0.2'), trust), '198.51.100.9');
  // A forged first entry cannot bypass the actual untrusted visitor address.
  assert.equal(authClientAddress(req('127.0.0.1', '192.0.2.100, 203.0.113.8'), trust), '203.0.113.8');
  assert.equal(authClientAddress(req('127.0.0.1', 'garbage'), trust), '127.0.0.1');
  assert.equal(authClientAddress(req('127.0.0.1', ['198.51.100.9']), trust), '127.0.0.1');
});

test('email setup never advertises preview or invalid sender connections as production-ready', () => {
  assert.equal(accountMailConfiguration(configured).available, true);
  assert.deepEqual(accountMailConfiguration({ ...configured, EMAIL_DELIVERY_MODE: 'preview' }), { available: false, previewUrl: null });
  assert.equal(accountMailConfiguration({ ...configured, SMTP_PORT: '70000' }).available, false);
  assert.equal(accountMailConfiguration({ ...configured, APP_ORIGIN: 'https://localhost' }).available, false);
  assert.equal(accountMailConfiguration({ ...configured, APP_ORIGIN: 'https://music.example.com?redirect=other' }).available, false);
  assert.equal(accountMailConfiguration({ ...configured, SMTP_HOST: 'smtp.gmail.com', SMTP_USER: '', SMTP_PASSWORD: '' }).available, false);
  assert.equal(accountMailConfiguration({ ...configured, SMTP_HOST: 'smtp.gmail.com' }).available, true);
  const preview = { ...configured, NODE_ENV: 'development', APP_ORIGIN: 'http://127.0.0.1:5174', EMAIL_DELIVERY_MODE: 'preview', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025' };
  assert.deepEqual(accountMailConfiguration(preview), { available: true, previewUrl: 'http://127.0.0.1:8025' });
});
