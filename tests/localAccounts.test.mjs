import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createServer as createSmtpServer } from 'node:net';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '../server/lib/prisma.mjs';
import {
  assertTrustedMutation,
  handleAuthRoutes,
  requireLocalAuth,
} from '../server/lib/auth/localAuth.mjs';
import { handleAccountContractRoutes } from '../server/lib/contracts/accountContracts.mjs';
import { handleProjectRoutes } from '../server/lib/projects/projectApi.mjs';
import { handleFilingRoutes } from '../server/lib/contractFiling/filingApi.mjs';
import { handleContractProgressRoutes } from '../server/lib/contracts/contractProgress.mjs';

test('PostgreSQL accounts, cookie sessions, contracts, recovery, and isolation work without Supabase', async () => {
  const run = randomUUID();
  const email = `accounts-${run}@example.test`,
    otherEmail = `other-${run}@example.test`;
  const weakPasswords = ['ABCDEF1!', 'abcdef1!', 'Abcdefg!', 'Abcdef12', 'Abcdef1 '];
  const weakEmails = weakPasswords.map((_, index) => `weak-${index}-${run}@example.test`);
  const previousEnv = Object.fromEntries(
    [
      'NODE_ENV',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_FROM',
      'SMTP_USER',
      'SMTP_PASSWORD',
      'APP_ORIGIN',
      'EMAIL_DELIVERY_MODE',
    ].map((key) => [key, process.env[key]]),
  );
  process.env.NODE_ENV = 'production';
  process.env.EMAIL_DELIVERY_MODE = 'smtp';
  delete process.env.SMTP_HOST;
  const messages = [];
  const smtp = createSmtpServer((socket) => {
    socket.write('220 localhost Test SMTP\r\n');
    let buffer = '',
      collecting = false,
      message = '';
    socket.on('data', (data) => {
      buffer += data.toString();
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n');
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (collecting) {
          if (line === '.') {
            messages.push(message);
            message = '';
            collecting = false;
            socket.write('250 Stored\r\n');
          } else message += `${line}\r\n`;
        } else if (/^(EHLO|HELO)/.test(line))
          socket.write('250-localhost\r\n250 SIZE 1048576\r\n');
        else if (line === 'DATA') {
          collecting = true;
          socket.write('354 End with a dot\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 Bye\r\n');
        } else socket.write('250 OK\r\n');
      }
    });
  });
  const server = createServer(async (req, res) => {
    const sendJson = (response, status, payload) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(payload));
    };
    const ctx = {
      url: new URL(req.url, 'http://localhost'),
      sendJson,
      requireAuth: requireLocalAuth,
      readBody: async () => {
        let body = '';
        for await (const chunk of req) body += chunk;
        return JSON.parse(body || '{}');
      },
    };
    try {
      assertTrustedMutation(req);
      // Keep this suite's rate-limit counters separate from users of the running app.
      const authRequest = {
        method: req.method,
        headers: req.headers,
        socket: { remoteAddress: `test-${run}` },
      };
      if (await handleAuthRoutes(authRequest, res, ctx)) return;
      if (await handleAccountContractRoutes(req, res, ctx)) return;
      if (await handleProjectRoutes(req, res, ctx)) return;
      if (await handleFilingRoutes(req, res, ctx)) return;
      if (await handleContractProgressRoutes(req, res, ctx)) return;
      sendJson(res, 404, {});
    } catch (error) {
      sendJson(res, error.status || 500, {
        error: error.message,
        code: error.code,
      });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return {
      get cookie() {
        return cookie;
      },
      async call(path, body, headers = {}) {
        const response = await fetch(base + path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Own-Masters-Request': 'true',
            ...(cookie ? { Cookie: cookie } : {}),
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        return response;
      },
    };
  };
  const json = async (response, status = 200) => {
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  };
  const a = client(),
    b = client();
  let ownerId, otherId, projectId, templateId;
  try {
    await json(await a.call('/api/projects'), 401);
    await json(
      await a.call('/api/projects', undefined, {
        'X-Own-Masters-Demo': 'true',
      }),
      401,
    );
    await json(
      await a.call('/api/auth/signup', {
        name: 'Test',
        email,
        password: 'short',
      }),
      400,
    );
    for (const [index, password] of weakPasswords.entries()) {
      const invalid = await json(await a.call('/api/auth/signup', { name: 'Test', email: weakEmails[index], password }), 400);
      assert.match(invalid.error, /lowercase letter, uppercase letter, number, and special character/);
      assert.equal(await prisma.accountUser.count({ where: { email: weakEmails[index] } }), 0);
    }
    await json(
      await a.call(
        '/api/auth/signup',
        { name: 'Test', email, password: 'Abcdef1!' },
        { Origin: 'https://evil.test' },
      ),
      403,
    );
    assert.equal(
      (await json(await a.call('/api/auth/config'))).emailDeliveryAvailable,
      false,
    );
    await json(
      await a.call('/api/auth/signup', {
        name: 'Test',
        email,
        password: 'Abcdef1!',
      }),
      503,
    );
    assert.equal(
      await prisma.accountUser.findUnique({ where: { email } }),
      null,
    );
    await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
    Object.assign(process.env, {
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtp.address().port),
      SMTP_FROM: 'test@example.test',
      APP_ORIGIN: 'https://ownmasters.example.test',
    });
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    process.env.EMAIL_DELIVERY_MODE = 'preview';
    const productionPreview = await json(await a.call('/api/auth/config'));
    assert.equal(productionPreview.emailDeliveryAvailable, false);
    assert.equal(productionPreview.emailPreviewUrl, null);
    process.env.EMAIL_DELIVERY_MODE = 'smtp';
    const confirmationLink = () =>
      new URL(
        messages
          .at(-1)
          .replace(/=\r?\n/g, '')
          .replace(/=3D/g, '=')
          .match(/https:\/\/ownmasters\.example\.test\/[^\s]+/)[0],
      );
    const signupResponse = await a.call('/api/auth/signup', {
      name: 'Local test owner',
      email: email.toUpperCase(),
      password: 'Abcdef1!',
      returnTo: '/dashboard/contracts?stage=draft#document',
    });
    assert.equal(signupResponse.headers.get('set-cookie'), null);
    const signup = await json(signupResponse, 201);
    assert.deepEqual(signup, { needsEmailConfirmation: true, emailSent: true });
    assert.match(messages.at(-1), /Content-Type: text\/html; charset=utf-8/);
    assert.match(messages.at(-1), /Content-ID: <own-masters-logo@ownmasters\.invalid>/);
    const stored = await prisma.accountUser.findUnique({
      where: { email },
    });
    ownerId = stored.id;
    assert.equal(stored.emailVerifiedAt, null);
    assert.match(stored.passwordHash, /^scrypt\$131072\$8\$1\$/);
    assert.ok(!stored.passwordHash.includes('Abcdef1!'));
    assert.equal(
      await prisma.accountSession.count({ where: { userId: ownerId } }),
      0,
    );
    await json(await a.call('/api/projects'), 401);
    const unverified = await json(
      await a.call('/api/auth/login', {
        email,
        password: 'Abcdef1!',
      }),
      403,
    );
    assert.equal(unverified.code, 'email_not_confirmed');
    const originalLink = confirmationLink();
    assert.equal(originalLink.pathname, '/auth/confirm');
    assert.equal(
      originalLink.searchParams.get('next'),
      '/dashboard/contracts?stage=draft#document',
    );
    const originalToken = new URLSearchParams(originalLink.hash.slice(1)).get(
      'token',
    );
    const verification = await prisma.emailVerificationToken.findUnique({
      where: { userId: ownerId },
    });
    assert.equal(
      verification.tokenHash,
      createHash('sha256').update(originalToken).digest('hex'),
    );
    assert.notEqual(verification.tokenHash, originalToken);
    await json(await a.call('/api/auth/resend-confirmation', { email }));
    assert.equal(
      messages.length,
      1,
      'a rapid resend must not send another message',
    );
    const unknownResend = await json(
      await a.call('/api/auth/resend-confirmation', {
        email: `unknown-${run}@example.test`,
      }),
    );
    await prisma.emailVerificationToken.update({
      where: { userId: ownerId },
      data: { createdAt: new Date(Date.now() - 61000), expiresAt: new Date(0) },
    });
    await json(
      await a.call('/api/auth/confirm-email', { token: originalToken }),
      400,
    );
    const knownResend = await json(
      await a.call('/api/auth/resend-confirmation', {
        email,
        returnTo: '/dashboard/contracts?stage=draft#document',
      }),
    );
    assert.deepEqual(knownResend, unknownResend);
    assert.equal(messages.length, 2);
    const freshToken = new URLSearchParams(
      confirmationLink().hash.slice(1),
    ).get('token');
    assert.notEqual(freshToken, originalToken);
    await json(
      await a.call('/api/auth/confirm-email', { token: originalToken }),
      400,
    );
    const oldPendingSession = randomBytes(32).toString('hex');
    await prisma.accountSession.create({
      data: {
        userId: ownerId,
        tokenHash: createHash('sha256').update(oldPendingSession).digest('hex'),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await json(
      await a.call('/api/projects', undefined, {
        Cookie: `__Host-own_masters_session=${oldPendingSession}`,
      }),
      401,
    );
    const confirmed = await json(
      await a.call('/api/auth/confirm-email', { token: freshToken }),
    );
    assert.equal(
      confirmed.returnTo,
      '/dashboard/contracts?stage=draft#document',
    );
    assert.ok(
      (await prisma.accountUser.findUnique({ where: { id: ownerId } }))
        .emailVerifiedAt,
    );
    assert.equal(
      await prisma.accountSession.count({ where: { userId: ownerId } }),
      0,
    );
    await json(
      await a.call('/api/auth/confirm-email', { token: freshToken }),
      400,
    );
    assert.equal((await json(await a.call('/api/auth/session'))).user, null);
    const loginResponse = await a.call('/api/auth/login', {
      email,
      password: 'Abcdef1!',
    });
    assert.match(loginResponse.headers.get('set-cookie'), /HttpOnly/);
    assert.match(loginResponse.headers.get('set-cookie'), /SameSite=Lax/);
    assert.match(loginResponse.headers.get('set-cookie'), /Secure/);
    assert.match(
      loginResponse.headers.get('set-cookie'),
      /^__Host-own_masters_session=/,
    );
    const login = await json(loginResponse);
    assert.equal(login.user.emailVerified, true);
    assert.equal('passwordHash' in login.user, false);
    const session = await prisma.accountSession.findFirst({
      where: { userId: ownerId },
    });
    assert.notEqual(session.tokenHash, a.cookie.split('=')[1]);
    assert.equal(
      (await json(await a.call('/api/auth/session'))).user.id,
      ownerId,
    );
    const existingSignup = await json(
      await a.call('/api/auth/signup', {
        name: 'Duplicate',
        email,
        password: 'Abcdef1!',
      }),
      201,
    );
    assert.deepEqual(existingSignup, signup);
    assert.equal((await prisma.accountUser.findUnique({ where: { email } })).name, 'Local test owner');
    await json(
      await b.call('/api/auth/signup', {
        name: 'Other test owner',
        email: otherEmail,
        password: 'Other-password2!',
        returnTo: '//evil.test',
      }),
      201,
    );
    assert.equal(confirmationLink().searchParams.get('next'), '/dashboard');
    const otherToken = new URLSearchParams(
      confirmationLink().hash.slice(1),
    ).get('token');
    await json(await b.call('/api/auth/confirm-email', { token: otherToken }));
    otherId = (
      await json(
        await b.call('/api/auth/login', {
          email: otherEmail,
          password: 'Other-password2!',
        }),
      )
    ).user.id;
    assert.notEqual(otherId, ownerId);
    const project = await json(
      await a.call('/api/projects', {
        title: 'Private local account song',
        lyrics: 'Only this owner can read this.',
      }),
      201,
    );
    projectId = project.id;
    await json(await b.call(`/api/projects/${projectId}`), 404);
    const contract = await json(
      await a.call('/api/account-contracts', {
        title: 'Private test contract',
        contractType: 'Split Sheet',
        content: 'Agreement between test parties.',
      }),
      201,
    );
    await json(await b.call(`/api/account-contracts/${contract.id}`), 404);
    await json(
      await b.call(`/api/account-contracts/${contract.id}/update`, {
        content: 'Not allowed',
      }),
      404,
    );
    await json(
      await a.call(`/api/projects/${projectId}/contracts`, {
        source: 'account',
        contractId: contract.id,
      }),
    );
    await json(
      await b.call(`/api/contract-progress/account/${contract.id}`),
      404,
    );
    assert.equal(
      (
        await json(
          await a.call(`/api/contract-progress/account/${contract.id}/status`, {
            status: 'ready_for_review',
            version: 0,
            note: 'Test review',
          }),
        )
      ).status,
      'ready_for_review',
    );
    await json(
      await a.call(`/api/account-contracts/${contract.id}/update`, {
        content: 'Saved private revision.',
      }),
    );
    assert.equal(
      (await json(await a.call(`/api/account-contracts/${contract.id}`)))
        .content,
      'Saved private revision.',
    );
    const template = await prisma.contractFile.create({
      data: {
        originalName: 'local-auth-test.txt',
        originalPath: '',
        storedPath: '',
        extension: '.txt',
        sizeBytes: 20,
        sha256: `auth-${run}`,
        extractedText: 'An agreement for tests.',
      },
    });
    templateId = template.id;
    const draft = (
      await json(
        await a.call(`/api/filing/templates/${template.id}/drafts`, {
          name: 'Private filler draft',
          documentHtml: '<p>Private agreement.</p>',
          projectId,
        }),
      )
    ).draft;
    await json(await b.call(`/api/filing/drafts/${draft.id}`), 404);
    assert.equal(
      (await json(await a.call(`/api/filing/drafts/${draft.id}`))).name,
      'Private filler draft',
    );
    await json(
      await a.call('/api/auth/logout', {}, { 'X-Own-Masters-Request': '' }),
      403,
    );
    const oldCookie = a.cookie;
    await json(await a.call('/api/auth/logout', {}));
    await json(await a.call('/api/projects'), 401);
    await json(
      await a.call('/api/projects', undefined, { Cookie: oldCookie }),
      401,
    );
    await json(
      await a.call('/api/auth/login', { email, password: 'wrong-password' }),
      401,
    );
    await json(
      await a.call('/api/auth/login', {
        email,
        password: 'Abcdef1!',
      }),
    );
    assert.notEqual(a.cookie, oldCookie);
    await prisma.accountSession.updateMany({
      where: { userId: ownerId },
      data: { expiresAt: new Date(0) },
    });
    assert.equal((await json(await a.call('/api/auth/session'))).user, null);
    await json(
      await a.call('/api/auth/login', {
        email,
        password: 'Abcdef1!',
      }),
    );
    delete process.env.SMTP_HOST;
    assert.equal(
      (await json(await a.call('/api/auth/config'))).passwordResetAvailable,
      false,
    );
    await json(await a.call('/api/auth/forgot-password', { email }), 503);
    Object.assign(process.env, {
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtp.address().port),
      SMTP_FROM: 'test@example.test',
      APP_ORIGIN: 'https://ownmasters.example.test',
    });
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    const beforeRecovery = messages.length;
    const unknown = await json(
      await a.call('/api/auth/forgot-password', {
        email: `unknown-${run}@example.test`,
      }),
    );
    const known = await json(
      await a.call('/api/auth/forgot-password', { email }),
    );
    const sessionBeforeReset = a.cookie;
    assert.deepEqual(known, unknown);
    assert.equal(messages.length, beforeRecovery + 1);
    const mail = messages
      .at(-1)
      .replace(/=\r?\n/g, '')
      .replace(/=3D/g, '=');
    const rawToken = mail.match(/#token=([a-f0-9]{64})/)?.[1];
    assert.match(mail, /Content-Type: text\/plain; charset=utf-8/);
    assert.match(mail, /Content-Type: text\/html; charset=utf-8/);
    assert.match(mail, /Content-ID: <own-masters-logo@ownmasters\.invalid>/);
    assert.ok(mail.includes('bgcolor="#0b0f17"'), 'Password reset must include the branded HTML letter, not only its plain-text alternative.');
    assert.match(mail, /Back to your/);
    assert.ok(rawToken);
    for (const password of weakPasswords) {
      const invalid = await json(await a.call('/api/auth/reset-password', { token: rawToken, password }), 400);
      assert.match(invalid.error, /lowercase letter, uppercase letter, number, and special character/);
    }
    assert.equal(
      (
        await prisma.passwordResetToken.findUnique({
          where: {
            tokenHash: createHash('sha256').update(rawToken).digest('hex'),
          },
        })
      ).userId,
      ownerId,
    );
    await json(
      await a.call('/api/auth/reset-password', {
        token: rawToken,
        password: 'New1!abc',
      }),
    );
    await json(
      await a.call('/api/projects', undefined, { Cookie: sessionBeforeReset }),
      401,
    );
    await json(
      await a.call('/api/auth/reset-password', {
        token: rawToken,
        password: 'anOther-password2!',
      }),
      400,
    );
    await json(
      await a.call('/api/auth/login', {
        email,
        password: 'Abcdef1!',
      }),
      401,
    );
    await json(
      await a.call('/api/auth/login', { email, password: 'New1!abc' }),
    );
    const expiredToken = randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId: ownerId,
        tokenHash: createHash('sha256').update(expiredToken).digest('hex'),
        expiresAt: new Date(0),
      },
    });
    await json(
      await a.call('/api/auth/reset-password', {
        token: expiredToken,
        password: 'Expired-password5!',
      }),
      400,
    );
    for (let i = 0; i < 13; i++) {
      const response = await b.call('/api/auth/login', {
        email: `throttle-${run}@example.test`,
        password: 'wrong-password',
      });
      assert.equal(response.status, i < 12 ? 401 : 429);
    }
    await json(
      await a.call(`/api/account-contracts/${contract.id}/delete`, {}),
    );
    assert.equal(
      await prisma.contractProgress.count({
        where: { userId: ownerId, accountContractId: contract.id },
      }),
      0,
    );
    assert.equal(
      await prisma.projectContract.count({
        where: { accountContractId: contract.id },
      }),
      0,
    );
    // Recovery is also proof of mailbox ownership for a pending account.
    await prisma.accountUser.update({
      where: { id: otherId },
      data: { emailVerifiedAt: null },
    });
    const pendingToken = randomBytes(32).toString('hex');
    await prisma.emailVerificationToken.create({
      data: {
        userId: otherId,
        tokenHash: createHash('sha256').update(pendingToken).digest('hex'),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await json(await b.call('/api/projects'), 401);
    await json(
      await b.call('/api/auth/forgot-password', { email: otherEmail }),
    );
    const recoveryToken = new URLSearchParams(
      confirmationLink().hash.slice(1),
    ).get('token');
    await json(
      await b.call('/api/auth/reset-password', {
        token: recoveryToken,
        password: 'Recovered-password6!',
      }),
    );
    assert.ok(
      (await prisma.accountUser.findUnique({ where: { id: otherId } }))
        .emailVerifiedAt,
    );
    assert.equal(
      await prisma.emailVerificationToken.count({ where: { userId: otherId } }),
      0,
    );
    await json(
      await b.call('/api/auth/confirm-email', { token: pendingToken }),
      400,
    );
    await json(
      await b.call('/api/auth/login', {
        email: otherEmail,
        password: 'Recovered-password6!',
      }),
    );
  } finally {
    if (templateId) {
      await prisma.contractDraft.deleteMany({ where: { templateId } });
      await prisma.contractFile.delete({ where: { id: templateId } });
    }
    if (projectId)
      await prisma.musicProject.deleteMany({ where: { id: projectId } });
    await prisma.contractProgress.deleteMany({
      where: { userId: { in: [ownerId, otherId].filter(Boolean) } },
    });
    await prisma.accountUser.deleteMany({
      where: { email: { in: [email, otherEmail] } },
    });
    const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
    const keys = [];
    for (const scope of [
      'signup',
      'login',
      'recovery',
      'reset',
      'confirmation',
      'confirmation-resend',
    ])
      for (const identity of [
        `ip:test-${run}`,
        ...[
          email,
          otherEmail,
          `unknown-${run}@example.test`,
          `throttle-${run}@example.test`,
          ...weakEmails,
        ].map((value) => `email:${value}`),
      ])
        for (const window of [bucket - 1, bucket])
          keys.push(
            createHash('sha256')
              .update(`${scope}:${identity}:${window}`)
              .digest('hex'),
          );
    await prisma.authRateLimit.deleteMany({ where: { key: { in: keys } } });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise((resolve) => server.close(resolve));
    if (smtp.listening) await new Promise((resolve) => smtp.close(resolve));
    await prisma.$disconnect();
  }
});
