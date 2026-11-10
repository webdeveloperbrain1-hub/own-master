import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../server/lib/env.mjs';
import { productionAuthErrors } from '../server/lib/auth/authConfiguration.mjs';
import { productionSiteErrors } from '../server/lib/deployment/siteConfiguration.mjs';
import { billingConfig } from '../server/lib/billing/billingConfig.mjs';

process.env.NODE_ENV = 'production';
loadEnv();
const errors = [...productionAuthErrors(), ...productionSiteErrors()];
try { billingConfig(); } catch (error) { errors.push(error.message); }
if (errors.length) {
  console.error('Deployment settings need attention:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const { prisma } = await import('../server/lib/prisma.mjs');
  const check = async (label, work) => {
    try { await work(); console.log(`PASS ${label}`); }
    catch { console.error(`FAIL ${label}`); process.exitCode = 1; }
  };
  await check('Built website, account-email logo and bundled contract library', async () => {
    await fs.access(path.resolve('dist/index.html'));
    await fs.access(path.resolve('public/own-masters-logo.png'));
    await fs.access(path.resolve('server/assets/contract-library.zip'));
  });
  await check('Database connection and application tables (apply all migrations first)', async () => {
    await Promise.all([
      prisma.accountUser.findFirst({ select: { id: true, emailVerifiedAt: true } }),
      prisma.accountSession.findFirst({ select: { expiresAt: true } }),
      prisma.emailVerificationToken.findFirst({ select: { expiresAt: true } }),
      prisma.passwordResetToken.findFirst({ select: { expiresAt: true } }),
      prisma.authRateLimit.findFirst({ select: { expiresAt: true } }),
      prisma.musicProject.findFirst({ select: { id: true } }),
      prisma.contractDraft.findFirst({ select: { id: true } }),
      prisma.contractProgress.findFirst({ select: { id: true } }),
      prisma.billingAccount.findFirst({ select: { userId: true } }),
    ]);
  });
  await check('Writable contract/audio storage', async () => {
    if (!process.env.CONTRACT_STORAGE_ROOT) throw new Error('Missing storage directory');
    const root = path.resolve(process.env.CONTRACT_STORAGE_ROOT);
    await fs.mkdir(root, { recursive: true });
    const probe = path.join(root, `.deployment-check-${randomUUID()}`);
    try { await fs.writeFile(probe, 'ok', { flag: 'wx' }); }
    finally { await fs.unlink(probe).catch(() => {}); }
  });
  await check('Private cloud storage configuration (when enabled)', async () => {
    const { verifyPrivateStorage } = await import('../server/lib/storage/privateFiles.mjs');
    await verifyPrivateStorage();
  });
  await check('LibreOffice document conversion', async () => {
    const { convertOfficeFile } = await import('../server/lib/contractFiling/documentLayout.mjs');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ownmasters-deployment-'));
    try {
      const input = path.join(directory, 'check.rtf');
      await fs.writeFile(input, '{\\rtf1\\ansi Own Masters document conversion check.}');
      await convertOfficeFile(input, path.join(directory, 'output'), 'pdf');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  if (process.argv.includes('--smtp')) {
    await check('SMTP connection and authentication (no email sent)', async () => {
      const { createAccountMailTransport } = await import('../server/lib/auth/accountMail.mjs');
      const transport = await createAccountMailTransport();
      try { await transport.verify(); } finally { transport.close(); }
    });
  }
  await prisma.$disconnect();
  console.log('Also verify actual email delivery, mobile use and backups on the public HTTPS domain.');
}
