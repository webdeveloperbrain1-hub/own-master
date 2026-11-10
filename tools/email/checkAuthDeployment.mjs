import { loadEnv } from '../../server/lib/env.mjs';
import { productionAuthErrors } from '../../server/lib/auth/authConfiguration.mjs';
import { createAccountMailTransport } from '../../server/lib/auth/accountMail.mjs';

process.env.NODE_ENV = 'production';
loadEnv();
const errors = productionAuthErrors();
if (errors.length) {
  console.error('Account deployment configuration needs attention:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Production account settings passed.');
  const { prisma } = await import('../../server/lib/prisma.mjs');
  try {
    await Promise.all([
      prisma.accountUser.findFirst({ select: { id: true, emailVerifiedAt: true } }),
      prisma.accountSession.findFirst({ select: { expiresAt: true } }),
      prisma.emailVerificationToken.findFirst({ select: { expiresAt: true } }),
      prisma.passwordResetToken.findFirst({ select: { expiresAt: true } }),
      prisma.authRateLimit.findFirst({ select: { expiresAt: true } }),
    ]);
    console.log('Database connection and account tables passed.');
    if (process.argv.includes('--smtp')) {
      const transport = await createAccountMailTransport();
      try {
        await transport.verify();
        console.log('SMTP connection and authentication passed. No email was sent. Verify real inbox delivery before launch.');
      } finally { transport.close(); }
    } else console.log('Run again with --smtp to verify the SMTP connection without sending an email.');
  } catch {
    console.error('Database or SMTP verification failed. Check connectivity, applied Prisma migrations, and provider credentials.');
    process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}
