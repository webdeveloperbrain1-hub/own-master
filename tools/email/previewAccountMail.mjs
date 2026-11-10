import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from '../../server/lib/env.mjs';
import { publicSiteConfiguration } from '../../server/lib/deployment/siteConfiguration.mjs';
import { renderAccountMail, accountMailLogo } from '../../server/lib/auth/accountMailTemplate.mjs';
import { renderDeliveryTestMail } from '../../server/lib/mail/letterTemplate.mjs';

loadEnv();
const logo = `data:image/png;base64,${(await fs.readFile(accountMailLogo.path)).toString('base64')}`;
const folder = path.resolve('.codex/account-email-preview');
await fs.mkdir(folder, { recursive: true });
const pages = {};
for (const kind of ['confirmation', 'reset']) {
  const link = new URL(kind === 'confirmation' ? '/auth/confirm' : '/reset-password', 'https://your-domain.example');
  if (kind === 'confirmation') link.searchParams.set('next', '/dashboard');
  link.hash = 'token=email-design-preview-not-a-valid-account-token';
  const { html } = renderAccountMail({ kind, name: 'Alex', link: link.href, supportEmail: publicSiteConfiguration().supportEmail });
  pages[kind] = html.replace(`cid:${accountMailLogo.cid}`, logo);
  await fs.writeFile(path.join(folder, `${kind}.html`), pages[kind]);
}
pages['delivery-test'] = renderDeliveryTestMail({ appOrigin: 'https://your-domain.example', supportEmail: publicSiteConfiguration().supportEmail }).html.replace(`cid:${accountMailLogo.cid}`, logo);
await fs.writeFile(path.join(folder, 'delivery-test.html'), pages['delivery-test']);
const gallery = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Own Masters email letters</title><style>body{margin:0;background:#f4f6fa;color:#17202e;font-family:Arial,Helvetica,sans-serif}main{max-width:860px;margin:auto;padding:48px 24px}header{border-radius:24px;background:#0b0f17;color:#fff;padding:32px}img{width:44px;height:44px;vertical-align:middle;margin-right:12px}h1{font-size:38px;line-height:1.1;letter-spacing:-1px;margin-bottom:16px}p{line-height:1.7;color:#586374}.intro{color:#c6ceda}nav{display:grid;gap:16px;margin:24px 0}a{display:block;padding:24px;border:1px solid #d5dce6;border-radius:18px;background:#fff;color:#17202e;text-decoration:none}a:hover,a:focus-visible{border-color:#17202e}strong{display:block;margin-bottom:8px;font-size:18px}small{line-height:1.6;color:#586374}footer{font-size:13px}</style></head><body><main><header><img src="${logo}" alt=""><b>Own Masters</b><h1>One letterhead.<br>Every message.</h1><p class="intro">The same logo, colors, typography and signature across your emails.</p></header><nav aria-label="Email previews"><a href="/confirmation"><strong>Email confirmation →</strong><small>Also used when a confirmation email is resent.</small></a><a href="/reset"><strong>Password recovery →</strong><small>The same letter design, with the reset action and 30-minute expiry.</small></a><a href="/delivery-test"><strong>Email delivery check →</strong><small>A branded test message with no account verification or password reset.</small></a></nav><footer><p>These previews use example links and send no email.</p><p>Be the label. Own the masters.</p></footer></main></body></html>`;
await fs.writeFile(path.join(folder, 'letters.html'), gallery);
console.log(`Saved standalone email previews to ${folder}. These contain inactive example links; no email is sent.`);
if (!process.argv.includes('--write-only')) {
  const port = Number(process.env.MAIL_PREVIEW_PORT || 8890);
  const routes = new Map([['/', 'confirmation'], ['/confirmation', 'confirmation'], ['/reset', 'reset'], ['/delivery-test', 'delivery-test'], ['/letters', 'letters']]);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://preview.internal');
    const kind = routes.get(url.pathname);
    if (req.method !== 'GET' || !kind) { res.writeHead(404); res.end('Not found.'); return; }
    try {
      const html = await fs.readFile(path.join(folder, `${kind}.html`));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
      res.end(html);
    } catch { res.writeHead(503); res.end('Run npm run mail:preview -- --write-only to refresh the previews.'); }
  });
  server.listen(port, '127.0.0.1', () => console.log(`All email letters: http://127.0.0.1:${port}/letters\nConfirmation: http://127.0.0.1:${port}/\nPassword reset: http://127.0.0.1:${port}/reset\nDelivery check: http://127.0.0.1:${port}/delivery-test`));
  process.once('SIGINT', () => server.close());
  process.once('SIGTERM', () => server.close());
}
