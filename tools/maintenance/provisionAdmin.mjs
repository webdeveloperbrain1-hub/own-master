import { loadEnv } from '../../server/lib/env.mjs';
import { prisma } from '../../server/lib/prisma.mjs';
import { hashPassword } from '../../server/lib/auth/localAuth.mjs';

loadEnv();

// Run explicitly with ADMIN_EMAIL and ADMIN_PASSWORD in the process environment.
// No default credentials or automatic admin creation during application startup.
try {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 8)
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 8 characters) before provisioning.');
  const passwordHash = await hashPassword(password);
  const account = await prisma.$transaction(async (tx) => {
    const user = await tx.accountUser.upsert({
      where: { email },
      create: { email, name: 'Library Administrator', passwordHash, role: 'admin', emailVerifiedAt: new Date() },
      update: { passwordHash, role: 'admin', emailVerifiedAt: new Date() },
      select: { id: true, email: true, role: true },
    });
    await tx.accountSession.deleteMany({ where: { userId: user.id } });
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await tx.emailVerificationToken.deleteMany({ where: { userId: user.id } });
    return user;
  });
  console.log(`Administrator ready: ${account.email} (${account.role}). Existing sessions revoked.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
