import { BlockList, isIP } from 'node:net';
import { accountMailConfiguration } from './accountMail.mjs';

const ip = (value) => {
  const text = String(value || '').trim();
  return text.startsWith('::ffff:') && isIP(text.slice(7)) === 4 ? text.slice(7) : text;
};
const proxies = (env) => (env.AUTH_TRUSTED_PROXY_IPS || '').split(',').map(ip).filter(Boolean);

export function authClientAddress(req, env = process.env) {
  const remote = ip(req.socket?.remoteAddress) || 'unknown';
  const trusted = new BlockList();
  for (const address of proxies(env)) {
    const family = isIP(address);
    if (family) trusted.addAddress(address, family === 4 ? 'ipv4' : 'ipv6');
  }
  const isTrusted = (address) => {
    const family = isIP(address);
    return Boolean(family && trusted.check(address, family === 4 ? 'ipv4' : 'ipv6'));
  };
  if (!isTrusted(remote)) return remote;
  const header = req.headers['x-forwarded-for'];
  if (typeof header !== 'string' || header.length > 2048) return remote;
  const chain = header.split(',').map(ip);
  if (!chain.length || chain.some((address) => !isIP(address))) return remote;
  let client = remote;
  for (let index = chain.length - 1; index >= 0 && isTrusted(client); index--) client = chain[index];
  return client;
}

export function productionAuthErrors(env = process.env) {
  const errors = [];
  let origin;
  try {
    const parsed = new URL(env.APP_ORIGIN);
    if (parsed.protocol !== 'https:' || parsed.origin !== env.APP_ORIGIN ||
      parsed.username || parsed.password || /\.(?:example|invalid|test|local)$/.test(parsed.hostname) || ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) throw new Error();
    origin = parsed.origin;
  } catch { errors.push('APP_ORIGIN must be the public HTTPS website origin, without a path or trailing slash.'); }
  if (!origin || env.CORS_ORIGIN !== origin)
    errors.push('CORS_ORIGIN must exactly match APP_ORIGIN.');
  if (env.VITE_API_BASE_URL && env.VITE_API_BASE_URL !== origin)
    errors.push('Serve /api through the website origin and leave VITE_API_BASE_URL empty (or equal to APP_ORIGIN).');
  if (!accountMailConfiguration({ ...env, NODE_ENV: 'production' }).available)
    errors.push('Configure SMTP email delivery: EMAIL_DELIVERY_MODE=smtp, SMTP_HOST, SMTP_PORT, SMTP_FROM, and matching SMTP_USER / SMTP_PASSWORD when authentication is needed.');
  if (proxies(env).some((address) => !isIP(address)))
    errors.push('AUTH_TRUSTED_PROXY_IPS must contain only explicit proxy IP addresses, separated by commas.');
  try {
    const database = new URL(env.DATABASE_URL);
    if (!['postgresql:', 'postgres:'].includes(database.protocol) || !database.hostname ||
      !database.username || !database.password || /replace-with/i.test(database.password) || database.password === 'ownmasters_password') throw new Error();
  } catch { errors.push('DATABASE_URL must point to PostgreSQL with dedicated production credentials, replacing the development password.'); }
  return errors;
}

export function assertProductionAuthConfiguration(env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const errors = productionAuthErrors(env);
  if (errors.length) throw new Error(`Production account configuration is incomplete:\n${errors.map((error) => `- ${error}`).join('\n')}`);
}
