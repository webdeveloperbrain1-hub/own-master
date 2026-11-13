import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { loadEnv } from '../server/lib/env.mjs';
import { prisma } from '../server/lib/prisma.mjs';
import { handleAuthRoutes, hashPassword } from '../server/lib/auth/localAuth.mjs';

loadEnv();

test('account settings update only the signed-in profile and rotate password sessions without email delivery', async () => {
  const run = randomUUID();
  const originalPassword = 'trial123';
  const nextPassword = 'New-trial123!';
  const users = [];
  const server = createServer(async (req, res) => {
    const sendJson = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    try {
      await handleAuthRoutes({ method: req.method, headers: req.headers, socket: { remoteAddress: `settings-${run}` } }, res, {
        url: new URL(req.url, 'http://localhost'), sendJson,
        readBody: async () => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks)); },
      });
    } catch (error) { sendJson(res, error.status || 500, { error: error.message, code: error.code }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/auth/`;
  const client = () => {
    let cookie = '';
    return {
      get cookie() { return cookie; },
      async call(path, body, headers = {}) {
        const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: {
          'Content-Type': 'application/json', 'X-Own-Masters-Request': 'true', Cookie: cookie, ...headers,
        }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        return response;
      },
    };
  };
  const json = async (response, status = 200) => { const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); return body; };
  try {
    const passwordHash = await hashPassword(originalPassword);
    for (const role of ['member', 'admin']) users.push(await prisma.accountUser.create({ data: {
      email: `${role}-${run}@example.test`, name: `${role} before`, role, emailVerifiedAt: new Date(), passwordHash,
    } }));
    const [member, admin] = users;
    const a = client(), otherSession = client(), adminSession = client(), guest = client();
    await json(await guest.call('profile', { name: 'Guest' }), 401);
    await json(await guest.call('change-password', { currentPassword: originalPassword, password: nextPassword }), 401);
    for (const browser of [a, otherSession]) await json(await browser.call('login', { email: member.email, password: originalPassword }));
    await json(await adminSession.call('login', { email: admin.email, password: originalPassword }));
    await json(await a.call('profile', { name: 'No CSRF' }, { 'X-Own-Masters-Request': '' }), 403);
    await json(await a.call('profile', null), 400);
    await json(await a.call('profile', { name: 'Wrong origin' }, { Origin: 'https://attacker.example' }), 403);
    for (const name of ['', ' ', 'x'.repeat(121)]) await json(await a.call('profile', { name }), 400);
    const edited = await json(await a.call('profile', { name: '  Updated Member  ', userId: admin.id, role: 'admin', email: admin.email }));
    assert.equal(edited.user.user_metadata.name, 'Updated Member');
    assert.equal(edited.user.email, member.email);
    assert.equal(edited.user.app_metadata.role, 'member');
    assert.equal(edited.user.passwordHash, undefined);
    assert.equal((await json(await a.call('session'))).user.user_metadata.name, 'Updated Member');
    assert.equal((await json(await otherSession.call('session'))).user.user_metadata.name, 'Updated Member');
    assert.equal((await prisma.accountUser.findUniqueOrThrow({ where: { id: admin.id } })).name, 'admin before');
    const editedAdmin = await json(await adminSession.call('profile', { name: 'Updated Administrator', role: 'member' }));
    assert.equal(editedAdmin.user.app_metadata.role, 'admin');

    await json(await a.call('change-password', { currentPassword: originalPassword, password: 'too-weak' }), 400);
    const incorrect = await json(await a.call('change-password', { currentPassword: 'incorrect', password: nextPassword }), 400);
    assert.equal(incorrect.code, 'invalid_current_password');
    await json(await a.call('change-password', { currentPassword: originalPassword, password: nextPassword }, { 'X-Own-Masters-Request': '' }), 403);
    assert.ok((await json(await a.call('session'))).user);
    const oldCookie = a.cookie;
    await prisma.passwordResetToken.create({ data: { userId: member.id, tokenHash: createHash('sha256').update(run).digest('hex'), expiresAt: new Date(Date.now() + 60000) } });
    const changed = await json(await a.call('change-password', { currentPassword: originalPassword, password: nextPassword }));
    assert.equal(changed.user.id, member.id);
    assert.equal(changed.user.app_metadata.role, 'member');
    assert.notEqual(a.cookie, oldCookie);
    assert.ok((await json(await a.call('session'))).user, 'the changing browser stays signed in');
    assert.equal((await json(await otherSession.call('session'))).user, null, 'other sessions are invalidated');
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: member.id } }), 0);
    assert.equal(await prisma.accountSession.count({ where: { userId: member.id } }), 1);
    await json(await otherSession.call('profile', { name: 'Revoked session' }), 401);
    await json(await guest.call('login', { email: member.email, password: originalPassword }), 401);
    await json(await guest.call('login', { email: member.email, password: nextPassword }));
    assert.equal((await json(await adminSession.call('session'))).user.id, admin.id, 'other accounts remain signed in');
    const competingPasswords = ['Concurrent-password1!', 'Concurrent-password2!'];
    const changes = await Promise.all(competingPasswords.map(password => guest.call('change-password', { currentPassword: nextPassword, password })));
    assert.deepEqual(changes.map(response => response.status).sort(), [200, 401], 'concurrent changes cannot both accept the old password');
    assert.equal(await prisma.accountSession.count({ where: { userId: member.id } }), 1);
    const winner = competingPasswords[changes.findIndex(response => response.status === 200)];
    await json(await client().call('login', { email: member.email, password: winner }));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await prisma.accountUser.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    await prisma.$disconnect();
  }
});
