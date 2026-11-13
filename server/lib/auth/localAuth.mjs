import {
  randomBytes,
  createHash,
  scrypt as derive,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { prisma } from '../prisma.mjs';
import { authClientAddress } from './authConfiguration.mjs';
import {
  accountMailConfiguration,
  confirmationReturnPath,
  sendAccountMail,
} from './accountMail.mjs';

const scrypt = promisify(derive);
let activeDerivations = 0;
async function derivePassword(password, salt) {
  if (activeDerivations >= 2)
    throw fail(
      'The account service is busy. Please try again in a moment.',
      429,
    );
  activeDerivations++;
  try {
    return await scrypt(password, salt, 64, {
      N: 131072,
      r: 8,
      p: 1,
      maxmem: 160 * 1024 * 1024,
    });
  } finally {
    activeDerivations--;
  }
}
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const cookieName = () =>
  process.env.NODE_ENV === 'production'
    ? '__Host-own_masters_session'
    : 'own_masters_session';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400, code = '') =>
  Object.assign(new Error(message), { status, code });
export const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  emailVerified: Boolean(user.emailVerifiedAt),
  user_metadata: { name: user.name },
  app_metadata: { role: user.role },
});
export const emailAddress = (value) => {
  if (
    typeof value !== 'string' ||
    value.length > 254 ||
    !/^[^\s@<>,;"]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(
      value.trim(),
    )
  )
    throw fail('Enter a valid email address.');
  return value.trim().toLowerCase();
};
const passwordInput = (value) => {
  if (
    typeof value !== 'string' ||
    Array.from(value).length < 8 ||
    value.length > 256 ||
    Buffer.byteLength(value) > 1024
  )
    throw fail('Use a password between 8 and 256 characters.');
  if (!/\p{Ll}/u.test(value) || !/\p{Lu}/u.test(value) || !/\p{Nd}/u.test(value) || !/[\p{P}\p{S}]/u.test(value))
    throw fail('Include at least one lowercase letter, uppercase letter, number, and special character.');
  return value;
};

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derivePassword(password, salt);
  return `scrypt$131072$8$1$${salt}$${key.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, salt, digest] = encoded.split('$');
  if (
    algorithm !== 'scrypt' ||
    n !== '131072' ||
    r !== '8' ||
    p !== '1' ||
    !/^[a-f0-9]{32}$/.test(salt) ||
    !/^[a-f0-9]{128}$/.test(digest)
  )
    return false;
  const actual = await derivePassword(password, salt);
  return timingSafeEqual(actual, Buffer.from(digest, 'hex'));
}

function tokenFrom(req) {
  const COOKIE = cookieName();
  const raw = (req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  return raw && /^[a-f0-9]{64}$/.test(raw) ? raw : '';
}

function cookie(res, token, seconds) {
  res.setHeader(
    'Set-Cookie',
    `${cookieName()}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
}

export function assertTrustedMutation(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const allowed = process.env.CORS_ORIGIN || 'http://127.0.0.1:5174';
  if (req.headers.origin && req.headers.origin !== allowed)
    throw fail('This request is not allowed from this website.', 403);
  if (tokenFrom(req) && req.headers['x-own-masters-request'] !== 'true')
    throw fail('Please refresh the page and try again.', 403);
}

async function createSession(req, res, user) {
  const raw = randomBytes(32).toString('hex');
  await prisma.$transaction(async (db) => {
    // Serialize login with password changes so an old password cannot create a
    // new session immediately after a reset has revoked existing sessions.
    const current =
      await db.$queryRaw`SELECT "passwordHash", "emailVerifiedAt" FROM "AccountUser" WHERE "id" = ${user.id} FOR UPDATE`;
    if (current[0]?.passwordHash !== user.passwordHash)
      throw fail(
        'Your email or password is incorrect.',
        401,
        'invalid_credentials',
      );
    if (!current[0]?.emailVerifiedAt)
      throw fail(
        'Confirm your email before logging in.',
        403,
        'email_not_confirmed',
      );
    await db.accountSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (tokenFrom(req))
      await db.accountSession.deleteMany({
        where: { tokenHash: hash(tokenFrom(req)) },
      });
    await db.accountSession.create({
      data: {
        tokenHash: hash(raw),
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
      },
    });
  });
  cookie(res, raw, SESSION_SECONDS);
}

export async function sessionUser(req) {
  const token = tokenFrom(req);
  if (!token) return null;
  const session = await prisma.accountSession.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: true },
  });
  return session &&
    session.expiresAt > new Date() &&
    session.user.emailVerifiedAt
    ? session.user
    : null;
}

export async function requireLocalAuth(req) {
  const user = await sessionUser(req);
  if (!user) throw fail('Please log in to continue.', 401);
  return { user: publicUser(user) };
}

async function rateLimit(req, scope, email, max = 12) {
  await prisma.authRateLimit.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  // Forwarded addresses are accepted only from explicitly trusted reverse proxies.
  for (const [identity, limit] of [
    [`ip:${authClientAddress(req)}`, max * 3],
    [`email:${email}`, max],
  ]) {
    const key = hash(`${scope}:${identity}:${bucket}`);
    const result = await prisma.authRateLimit.upsert({
      where: { key },
      create: { key, expiresAt: new Date((bucket + 1) * 15 * 60 * 1000) },
      update: { attempts: { increment: 1 } },
    });
    if (result.attempts > limit)
      throw Object.assign(fail(
        'Too many attempts. Please wait 15 minutes and try again.',
        429,
        'over_request_rate_limit',
      ), { retryAfter: Math.max(1, Math.ceil(((bucket + 1) * 15 * 60 * 1000 - Date.now()) / 1000)) });
  }
}

export function resetEmailAvailable() {
  return accountMailConfiguration().available;
}

async function issueConfirmation(user, returnTo) {
  const raw = randomBytes(32).toString('hex');
  const tokenHash = hash(raw);
  const shouldSend = await prisma.$transaction(async (db) => {
    const current =
      await db.$queryRaw`SELECT "emailVerifiedAt" FROM "AccountUser" WHERE "id" = ${user.id} FOR UPDATE`;
    if (!current.length || current[0].emailVerifiedAt) return false;
    const recent = await db.emailVerificationToken.findUnique({
      where: { userId: user.id },
    });
    if (recent && Date.now() - recent.createdAt.getTime() < 60000) return false;
    await db.emailVerificationToken.deleteMany({ where: { userId: user.id } });
    await db.emailVerificationToken.create({
      data: {
        tokenHash,
        userId: user.id,
        returnTo: confirmationReturnPath(returnTo),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return true;
  });
  if (!shouldSend) return true;
  try {
    await sendAccountMail(user, 'confirmation', raw, returnTo);
    return true;
  } catch {
    await prisma.emailVerificationToken.deleteMany({ where: { tokenHash } });
    console.error(
      'Account confirmation email delivery failed. Check the email configuration.',
    );
    return false;
  }
}

export async function handleAuthRoutes(req, res, { url, sendJson, readBody }) {
  if (!url.pathname.startsWith('/api/auth/')) return false;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const user = await sessionUser(req);
    if (!user && tokenFrom(req)) cookie(res, '', 0);
    sendJson(res, 200, { user: user ? publicUser(user) : null });
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/config') {
    const mail = accountMailConfiguration();
    sendJson(res, 200, {
      passwordResetAvailable: mail.available,
      emailConfirmationRequired: true,
      emailDeliveryAvailable: mail.available,
      emailPreviewUrl: mail.previewUrl,
    });
    return true;
  }
  if (req.method !== 'POST') {
    sendJson(res, 404, { error: 'Account endpoint not found.' });
    return true;
  }
  assertTrustedMutation(req);
  if (!(req.headers['content-type'] || '').startsWith('application/json'))
    throw fail('Send account requests as JSON.', 415);
  if (url.pathname === '/api/auth/logout') {
    if (tokenFrom(req))
      await prisma.accountSession.deleteMany({
        where: { tokenHash: hash(tokenFrom(req)) },
      });
    cookie(res, '', 0);
    sendJson(res, 200, { ok: true });
    return true;
  }
  const body = await readBody(req, 8000);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw fail('Send account details as a JSON object.');
  if (url.pathname === '/api/auth/profile') {
    const user = await sessionUser(req);
    if (!user) throw fail('Please log in to continue.', 401);
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120 || /[\u0000-\u001f]/.test(body.name))
      throw fail('Enter a display name between 1 and 120 characters.');
    // Profile edits may only change the display name. Identity and privileges
    // always come from the authenticated session, never from request fields.
    const updated = await prisma.accountUser.update({ where: { id: user.id }, data: { name: body.name.trim() } });
    sendJson(res, 200, { user: publicUser(updated) });
    return true;
  }
  if (url.pathname === '/api/auth/change-password') {
    const user = await sessionUser(req);
    if (!user) throw fail('Please log in to continue.', 401);
    await rateLimit(req, 'change-password', user.email, 5);
    if (typeof body.currentPassword !== 'string' || Buffer.byteLength(body.currentPassword) > 1024 ||
        !await verifyPassword(body.currentPassword, user.passwordHash))
      throw fail('Your current password is incorrect.', 400, 'invalid_current_password');
    const password = passwordInput(body.password);
    if (password === body.currentPassword) throw fail('Choose a password different from your current one.', 400, 'same_password');
    const passwordHash = await hashPassword(password);
    const raw = randomBytes(32).toString('hex');
    const updated = await prisma.$transaction(async (db) => {
      const current = await db.$queryRaw`SELECT "passwordHash" FROM "AccountUser" WHERE "id" = ${user.id} FOR UPDATE`;
      if (current[0]?.passwordHash !== user.passwordHash)
        throw fail('Your password changed during this request. Please log in again.', 401);
      const session = await db.accountSession.findUnique({ where: { tokenHash: hash(tokenFrom(req)) } });
      if (!session || session.userId !== user.id || session.expiresAt <= new Date())
        throw fail('Please log in to continue.', 401);
      const account = await db.accountUser.update({ where: { id: user.id }, data: { passwordHash } });
      await db.accountSession.deleteMany({ where: { userId: user.id } });
      await db.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await db.accountSession.create({ data: { tokenHash: hash(raw), userId: user.id, expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) } });
      return account;
    });
    cookie(res, raw, SESSION_SECONDS);
    sendJson(res, 200, { user: publicUser(updated) });
    return true;
  }
  if (url.pathname === '/api/auth/resend-confirmation') {
    if (!accountMailConfiguration().available)
      throw fail(
        'Account emails are not set up yet. Please contact the site owner.',
        503,
        'email_not_configured',
      );
    const email = emailAddress(body.email);
    await rateLimit(req, 'confirmation-resend', email, 3);
    const user = await prisma.accountUser.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt)
      await issueConfirmation(user, body.returnTo);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (url.pathname === '/api/auth/confirm-email') {
    const token = typeof body.token === 'string' ? body.token : '';
    await rateLimit(req, 'confirmation', token.slice(0, 16), 12);
    if (!/^[a-f0-9]{64}$/.test(token))
      throw fail(
        'This confirmation link is invalid or has expired. Request a new link.',
        400,
        'invalid_confirmation_token',
      );
    const returnTo = await prisma.$transaction(async (db) => {
      const record = await db.emailVerificationToken.findUnique({
        where: { tokenHash: hash(token) },
      });
      if (!record || record.expiresAt <= new Date())
        throw fail(
          'This confirmation link is invalid or has expired. Request a new link.',
          400,
          'invalid_confirmation_token',
        );
      await db.$queryRaw`SELECT "id" FROM "AccountUser" WHERE "id" = ${record.userId} FOR UPDATE`;
      const consumed = await db.emailVerificationToken.deleteMany({
        where: { tokenHash: hash(token), expiresAt: { gt: new Date() } },
      });
      if (!consumed.count)
        throw fail(
          'This confirmation link has already been used. Request a new link.',
          400,
          'invalid_confirmation_token',
        );
      await db.accountUser.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      });
      await db.accountSession.deleteMany({ where: { userId: record.userId } });
      await db.emailVerificationToken.deleteMany({
        where: { userId: record.userId },
      });
      return record.returnTo;
    });
    cookie(res, '', 0);
    sendJson(res, 200, { ok: true, returnTo });
    return true;
  }
  if (url.pathname === '/api/auth/signup') {
    const email = emailAddress(body.email);
    await rateLimit(req, 'signup', email, 8);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120)
      throw fail('Enter a name up to 120 characters.');
    const password = passwordInput(body.password);
    if (!accountMailConfiguration().available)
      throw fail(
        'Account confirmation emails are not set up yet. Please contact the site owner.',
        503,
        'email_not_configured',
      );
    // Derive for both new and existing addresses, and return the same public
    // outcome without changing an existing account's password or name.
    const passwordHash = await hashPassword(password);
    let user = await prisma.accountUser.findUnique({ where: { email } });
    if (!user) {
      try {
        user = await prisma.accountUser.create({ data: { email, name, passwordHash } });
      } catch (error) {
        if (error.code !== 'P2002') throw error;
        user = await prisma.accountUser.findUnique({ where: { email } });
        if (!user) throw error;
      }
    }
    const emailSent = user.emailVerifiedAt ? true : await issueConfirmation(user, body.returnTo);
    sendJson(res, 201, { needsEmailConfirmation: true, emailSent });
    return true;
  }
  if (url.pathname === '/api/auth/login') {
    const email = emailAddress(body.email);
    await rateLimit(req, 'login', email);
    if (
      typeof body.password !== 'string' ||
      Buffer.byteLength(body.password) > 1024
    )
      throw fail(
        'Your email or password is incorrect.',
        401,
        'invalid_credentials',
      );
    const user = await prisma.accountUser.findUnique({ where: { email } });
    // Equal-cost derivation when the address does not exist.
    const encoded =
      user?.passwordHash ||
      `scrypt$131072$8$1$${'0'.repeat(32)}$${'0'.repeat(128)}`;
    const valid = await verifyPassword(body.password, encoded);
    if (!user || !valid)
      throw fail(
        'Your email or password is incorrect.',
        401,
        'invalid_credentials',
      );
    if (!user.emailVerifiedAt)
      throw fail(
        'Confirm your email before logging in. You can resend the confirmation below.',
        403,
        'email_not_confirmed',
      );
    await createSession(req, res, user);
    sendJson(res, 200, { user: publicUser(user) });
    return true;
  }
  if (url.pathname === '/api/auth/forgot-password') {
    if (!resetEmailAvailable())
      throw fail(
        'Password reset emails are not set up yet. Please contact the site owner.',
        503,
        'email_not_configured',
      );
    const email = emailAddress(body.email);
    await rateLimit(req, 'recovery', email, 3);
    const user = await prisma.accountUser.findUnique({ where: { email } });
    if (user) {
      const raw = randomBytes(32).toString('hex');
      await prisma.$transaction([
        prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
        prisma.passwordResetToken.create({
          data: {
            tokenHash: hash(raw),
            userId: user.id,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          },
        }),
      ]);
      // Give identical public responses for unknown addresses and delivery failures.
      try {
        await sendAccountMail(user, 'reset', raw);
      } catch {
        console.error(
          'Password recovery email delivery failed. Check the SMTP configuration.',
        );
      }
    }
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (url.pathname === '/api/auth/reset-password') {
    const token = typeof body.token === 'string' ? body.token : '';
    await rateLimit(req, 'reset', token.slice(0, 16), 8);
    if (!/^[a-f0-9]{64}$/.test(token))
      throw fail(
        'This reset link is invalid or has expired. Request a new link.',
        400,
        'invalid_reset_token',
      );
    const passwordHash = await hashPassword(passwordInput(body.password));
    await prisma.$transaction(async (db) => {
      const record = await db.passwordResetToken.findUnique({
        where: { tokenHash: hash(token) },
      });
      if (!record || record.expiresAt <= new Date())
        throw fail(
          'This reset link is invalid or has expired. Request a new link.',
          400,
          'invalid_reset_token',
        );
      const consumed = await db.passwordResetToken.deleteMany({
        where: { tokenHash: hash(token), expiresAt: { gt: new Date() } },
      });
      if (!consumed.count)
        throw fail(
          'This reset link has already been used. Request a new link.',
        );
      await db.accountUser.update({
        where: { id: record.userId },
        data: { passwordHash, emailVerifiedAt: new Date() },
      });
      await db.accountSession.deleteMany({ where: { userId: record.userId } });
      await db.passwordResetToken.deleteMany({
        where: { userId: record.userId },
      });
      await db.emailVerificationToken.deleteMany({
        where: { userId: record.userId },
      });
    });
    cookie(res, '', 0);
    sendJson(res, 200, { ok: true });
    return true;
  }
  sendJson(res, 404, { error: 'Account endpoint not found.' });
  return true;
}
