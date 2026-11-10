import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { JSDOM } from 'jsdom';
import nodemailer from 'nodemailer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderAccountMail, accountMailLogo } from '../server/lib/auth/accountMailTemplate.mjs';
import { sendAccountMail } from '../server/lib/auth/accountMail.mjs';
import { renderOwnMastersLetter, renderDeliveryTestMail } from '../server/lib/mail/letterTemplate.mjs';

const token = 'a'.repeat(64);
const link = `https://ownmasters.example.test/auth/confirm?next=%2Fdashboard%2Fcontracts%3Fstage%3Ddraft%23document#token=${token}`;
const options = { kind: 'confirmation', name: 'Roni Studio', link, supportEmail: 'admin@teddbernard.com' };
const decodeQuotedPrintable = text => text.replace(/=\r?\n/g, '').replace(/=([a-f0-9]{2})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

test('ordinary messages use the shared letterhead without inventing an account action or expiry', () => {
  const message = renderOwnMastersLetter({
    subject: 'Own Masters update', name: 'Roni Studio', titleLines: ['Your music.', 'Your next move.'],
    body: ['A regular message about your workspace.', '<img src=x onerror=alert(1)>'],
    appOrigin: 'https://ownmasters.example.test', supportEmail: 'admin@teddbernard.com',
  });
  const dom = new JSDOM(message.html);
  try {
    assert.match(message.text, /Hi Roni,/);
    assert.match(message.text, /Be the label\. Own the masters\./);
    assert.equal(dom.window.document.querySelector('a.button'), null);
    assert.equal(dom.window.document.querySelectorAll('img').length, 1);
    assert.equal(dom.window.document.querySelector('[onerror]'), null);
    assert.ok(dom.window.document.body.textContent.includes('<img src=x onerror=alert(1)>'));
    assert.doesNotMatch(message.text, /expires|#token=/);
    assert.ok(message.html.includes('background-color:#0b0f17'));
    assert.throws(() => renderOwnMastersLetter({ subject: 'Hello\r\nBcc: other@example.test', titleLines: ['Hello'], body: 'Message', appOrigin: 'https://ownmasters.example.test' }), /Invalid.*subject/);
  } finally { dom.window.close(); }
});

test('delivery checks have the same letter design and contain no confirmation or reset token', async () => {
  const message = renderDeliveryTestMail({ appOrigin: 'https://ownmasters.example.test', supportEmail: 'admin@teddbernard.com' });
  const dom = new JSDOM(message.html);
  try {
    assert.equal(message.subject, 'Own Masters email delivery test');
    assert.equal(dom.window.document.querySelector('img').getAttribute('src'), `cid:${accountMailLogo.cid}`);
    assert.equal(dom.window.document.querySelector('a.button').getAttribute('href'), 'https://ownmasters.example.test/');
    assert.match(dom.window.document.querySelector('a.button').textContent, /Open Own Masters/);
    assert.match(message.text, /No action required/);
    assert.doesNotMatch(message.text, /#token=|expires in|\/auth\/confirm|\/reset-password/);
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    try {
      const sent = await transport.sendMail({ from: 'sender@example.test', to: 'recipient@example.test', ...message });
      const mime = sent.message.toString();
      assert.match(mime, /Content-Type: text\/html/);
      assert.match(mime, /Content-Type: text\/plain/);
      assert.ok(mime.includes(`Content-ID: <${accountMailLogo.cid}>`));
    } finally { transport.close(); }
  } finally { dom.window.close(); }
});

test('confirmation email has the Own Masters brand, exact action links and a readable plain-text alternative', () => {
  const message = renderAccountMail(options);
  const dom = new JSDOM(message.html);
  try {
    assert.equal(message.subject, 'Confirm your Own Masters email');
    assert.match(message.text, /Hi Roni,/);
    assert.match(message.text, /expires in 1 hour and can only be used once/);
    assert.ok(message.text.includes(`\n${link}\n`));
    assert.match(message.text, /Select Confirm email on that page/);
    assert.match(message.text, /Be the label\. Own the masters\./);
    const actions = [...dom.window.document.querySelectorAll('a')].filter(anchor => anchor.href.includes('#token='));
    assert.equal(actions.length, 2);
    assert.ok(actions.every(anchor => anchor.href === link));
    assert.match(actions[0].textContent, /Confirm email/);
    assert.match(dom.window.document.querySelector('h1').textContent, /Make your nextmove official\./);
    assert.match(message.html, /@media screen and \(max-width:600px\)/);
    assert.equal(dom.window.document.querySelector('img').getAttribute('src'), `cid:${accountMailLogo.cid}`);
    assert.equal(dom.window.document.querySelectorAll('script, iframe, img[src^="http"]').length, 0);
    assert.deepEqual(message.replyTo, { address: 'admin@teddbernard.com' });
  } finally { dom.window.close(); }
});

test('names are escaped, invalid support values are excluded, and only account links can be rendered', () => {
  const message = renderAccountMail({ ...options, name: '<img/src=x/onerror=alert(1)>', supportEmail: 'bad@example.test\r\nBcc: other@example.test' });
  const dom = new JSDOM(message.html);
  try {
    assert.equal(dom.window.document.querySelectorAll('img').length, 1);
    assert.equal(dom.window.document.querySelector('[onerror]'), null);
    assert.ok(dom.window.document.body.textContent.includes('<img/src=x/onerror=alert(1)>'));
    assert.equal(message.replyTo, undefined);
    assert.ok(dom.window.document.querySelector('a[href="https://ownmasters.example.test/contact"]'));
    assert.doesNotMatch(message.html, /Bcc:/);
    assert.match(renderAccountMail({ ...options, name: '' }).text, /Hi there,/);
    assert.throws(() => renderAccountMail({ ...options, link: 'javascript:alert(1)' }), /Invalid/);
    assert.throws(() => renderAccountMail({ ...options, kind: 'unknown' }), /Unknown/);
  } finally { dom.window.close(); }
});

test('password recovery uses the same design and retains the reset action and 30-minute lifetime', () => {
  const resetLink = `https://ownmasters.example.test/reset-password#token=${token}`;
  const message = renderAccountMail({ ...options, kind: 'reset', link: resetLink });
  const dom = new JSDOM(message.html);
  try {
    assert.equal(message.subject, 'Reset your Own Masters password');
    assert.match(message.text, /expires in 30 minutes/);
    assert.match(message.text, /Your password will stay the same/);
    assert.ok(message.text.includes(`\n${resetLink}\n`));
    assert.equal(dom.window.document.querySelector('a').getAttribute('href'), resetLink);
    assert.match(dom.window.document.querySelector('a').textContent, /Reset password/);
    assert.doesNotMatch(message.text, /expires in 1 hour/);
  } finally { dom.window.close(); }
});

test('the actual MIME message contains text, HTML and the embedded logo without remote image requests', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  try {
    const sent = await transport.sendMail({ from: 'Own Masters <sender@example.test>', to: 'recipient@example.test', ...renderAccountMail(options) });
    const mime = sent.message.toString();
    assert.match(mime, /Content-Type: multipart\/alternative/);
    assert.match(mime, /Content-Type: multipart\/related/);
    assert.match(mime, /Content-Type: text\/plain; charset=utf-8/);
    assert.match(mime, /Content-Type: text\/html; charset=utf-8/);
    assert.match(mime, /Content-Type: image\/png/);
    assert.ok(mime.includes(`Content-ID: <${accountMailLogo.cid}>`));
    assert.ok(mime.indexOf('Content-Type: text/plain') < mime.indexOf('Content-Type: text/html'));
    const original = new URL(decodeQuotedPrintable(mime).match(/https:\/\/ownmasters\.example\.test\/[^\s]+/)[0]);
    assert.equal(original.href, link);
    assert.equal(new URLSearchParams(original.hash.slice(1)).get('token'), token);
  } finally { transport.close(); }
});

test('account and delivery-test senders both deliver branded letters through loopback-only SMTP', async () => {
  const names = ['NODE_ENV', 'APP_ORIGIN', 'EMAIL_DELIVERY_MODE', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASSWORD', 'SUPPORT_EMAIL'];
  const previous = names.map(name => process.env[name]);
  const messages = [], sockets = new Set();
  const smtp = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 localhost Own Masters test SMTP\r\n');
    let buffer = '', collecting = false, message = '';
    socket.on('data', data => {
      buffer += data.toString();
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n'), line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (collecting) {
          if (line === '.') { messages.push(message); message = ''; collecting = false; socket.write('250 Captured locally\r\n'); }
          else message += line + '\r\n';
        } else if (/^(EHLO|HELO)/.test(line)) socket.write('250-localhost\r\n250 SIZE 1048576\r\n');
        else if (line === 'DATA') { collecting = true; socket.write('354 End with a dot\r\n'); }
        else if (line === 'QUIT') socket.end('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
  try {
    Object.assign(process.env, { NODE_ENV: 'development', APP_ORIGIN: 'https://ownmasters.example.test', EMAIL_DELIVERY_MODE: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_FROM: 'Own Masters <sender@example.test>', SUPPORT_EMAIL: 'admin@teddbernard.com' });
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    await sendAccountMail({ name: 'Roni Studio', email: 'recipient@example.test' }, 'confirmation', token, '/dashboard/contracts?stage=draft#document');
    assert.equal(messages.length, 1);
    const decoded = decodeQuotedPrintable(messages[0]);
    assert.match(decoded, /Content-Type: text\/html/);
    assert.match(decoded, /Make your next/);
    assert.match(decoded, /Hi Roni,/);
    const destination = new URL(decoded.match(/https:\/\/ownmasters\.example\.test\/[^\s]+/)[0]);
    assert.equal(destination.pathname, '/auth/confirm');
    assert.equal(destination.searchParams.get('next'), '/dashboard/contracts?stage=draft#document');
    assert.equal(new URLSearchParams(destination.hash.slice(1)).get('token'), token);
    await sendAccountMail({ name: 'Roni Studio', email: 'recipient@example.test' }, 'reset', token);
    assert.equal(messages.length, 2);
    const recovery = decodeQuotedPrintable(messages[1]);
    assert.match(recovery, /Content-Type: text\/html/);
    assert.match(recovery, /expires in 30 minutes/);
    assert.ok(recovery.includes(`Content-ID: <${accountMailLogo.cid}>`));
    const emptyWorkingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ownmasters-mail-cli-'));
    try {
      const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../tools/email/checkAccountMail.mjs', import.meta.url)), '--to', 'delivery@example.test'], {
        cwd: emptyWorkingDirectory,
        env: { ...process.env, SMTP_USER: '', SMTP_PASSWORD: '' },
        windowsHide: true,
        timeout: 10000,
      });
      assert.match(result.stdout, /SMTP provider accepted the test email/);
      assert.equal(messages.length, 3);
      const delivery = decodeQuotedPrintable(messages[2]);
      assert.match(delivery, /Subject: Own Masters email delivery test/);
      assert.match(delivery, /Content-Type: text\/html/);
      assert.match(delivery, /No action required/);
      assert.ok(delivery.includes(`Content-ID: <${accountMailLogo.cid}>`));
      assert.doesNotMatch(delivery, /#token=/);
    } finally { await fs.rm(emptyWorkingDirectory, { recursive: true, force: true }); }
  } finally {
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => smtp.close(resolve));
  }
});
