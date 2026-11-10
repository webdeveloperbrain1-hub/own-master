import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vercelConfiguration } from '../tools/deployment/vercelConfiguration.mjs';

test('Vercel refuses missing, local and recursive backend destinations', () => {
  for (const origin of [undefined, '', 'http://backend.onrender.com', 'https://localhost',
    'https://127.0.0.1', 'https://backend.example', 'https://backend.onrender.com/',
    'https://backend.onrender.com/api', 'https://user:secret@backend.onrender.com']) {
    assert.throws(() => vercelConfiguration({ OWN_MASTERS_BACKEND_ORIGIN: origin }), /Set OWN_MASTERS_BACKEND_ORIGIN/);
  }
  assert.throws(() => vercelConfiguration({
    OWN_MASTERS_BACKEND_ORIGIN: 'https://own-master-chi.vercel.app',
    VERCEL_PROJECT_PRODUCTION_URL: 'own-master-chi.vercel.app',
  }), /not this Vercel website/);
});

test('Vercel sends account requests to the backend and limits the React fallback to page routes', () => {
  const config = vercelConfiguration({ OWN_MASTERS_BACKEND_ORIGIN: 'https://own-masters-api.onrender.com' });
  const routes = config.routes.filter(route => route.dest);
  const destination = pathname => {
    const route = routes.find(route => new RegExp(`^${route.src}$`).test(pathname));
    return route ? pathname.replace(new RegExp(`^${route.src}$`), route.dest) : null;
  };
  assert.equal(destination('/api'), 'https://own-masters-api.onrender.com/api');
  for (const path of ['/api/auth/config', '/api/auth/signup', '/api/health', '/api/missing', '/api/assets/missing.js'])
    assert.equal(destination(path), `https://own-masters-api.onrender.com${path}`);
  for (const path of ['/', '/signup', '/login', '/auth/confirm', '/reset-password', '/dashboard/contracts/drafts/id/edit'])
    assert.equal(destination(path), '/index.html');
  for (const path of ['/assets/missing', '/assets/missing.js', '/missing.css', '/.env', '/.git/config'])
    assert.equal(destination(path), null);
  assert.ok(config.routes.findIndex(route => route.handle === 'filesystem') <
    config.routes.findIndex(route => route.dest === '/index.html'));
});
