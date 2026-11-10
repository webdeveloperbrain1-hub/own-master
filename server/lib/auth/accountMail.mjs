import { renderAccountMail } from './accountMailTemplate.mjs';
import { publicSiteConfiguration } from '../deployment/siteConfiguration.mjs';

const loopback = (host) =>
  ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host);

export function accountMailConfiguration(env = process.env) {
  const mode = env.EMAIL_DELIVERY_MODE || 'smtp';
  let origin;
  try {
    origin = new URL(env.APP_ORIGIN);
  } catch {
    return { available: false, previewUrl: null };
  }
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password || origin.pathname !== '/' || origin.search || origin.hash
  )
    return { available: false, previewUrl: null };
  const port = Number(env.SMTP_PORT || 587);
  const gmail = ['smtp.gmail.com', 'smtp.googlemail.com'].includes(env.SMTP_HOST?.trim().toLowerCase());
  const configured = Boolean(env.SMTP_HOST?.trim() && env.SMTP_FROM?.trim()) &&
    !/[\r\n]/.test(`${env.SMTP_HOST}${env.SMTP_FROM}`) &&
    Number.isInteger(port) && port > 0 && port <= 65535 &&
    Boolean(env.SMTP_USER) === Boolean(env.SMTP_PASSWORD) &&
    (!gmail || Boolean(env.SMTP_USER && env.SMTP_PASSWORD));
  if (mode === 'preview') {
    const available =
      configured &&
      env.NODE_ENV !== 'production' &&
      loopback(origin.hostname) &&
      loopback(env.SMTP_HOST) &&
      Number(env.SMTP_PORT) === 1025;
    return {
      available,
      previewUrl: available ? 'http://127.0.0.1:8025' : null,
    };
  }
  return {
    available:
      mode === 'smtp' &&
      configured &&
      (env.NODE_ENV !== 'production' || (origin.protocol === 'https:' && !loopback(origin.hostname))),
    previewUrl: null,
  };
}

export function confirmationReturnPath(value) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return '/dashboard';
  try {
    const url = new URL(value, 'https://ownmasters.invalid');
    if (
      url.origin !== 'https://ownmasters.invalid' ||
      (url.pathname !== '/dashboard' && !url.pathname.startsWith('/dashboard/'))
    )
      return '/dashboard';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/dashboard';
  }
}

export async function createAccountMailTransport() {
  if (!accountMailConfiguration().available)
    throw new Error('Account email delivery is not configured.');
  const { default: nodemailer } = await import('nodemailer');
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465 && !loopback(process.env.SMTP_HOST),
    ...(!accountMailConfiguration().previewUrl && process.env.SMTP_USER
      ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

export async function sendAccountMail(
  user,
  kind,
  raw,
  returnTo = '/dashboard',
) {
  const transport = await createAccountMailTransport();
  const confirmation = kind === 'confirmation';
  const link = new URL(
    confirmation ? '/auth/confirm' : '/reset-password',
    process.env.APP_ORIGIN,
  );
  if (confirmation)
    link.searchParams.set('next', confirmationReturnPath(returnTo));
  link.hash = `token=${raw}`;
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: { address: user.email },
      ...renderAccountMail({ kind, name: user.name, link: link.href, supportEmail: publicSiteConfiguration().supportEmail }),
    });
  } finally { transport.close(); }
}
