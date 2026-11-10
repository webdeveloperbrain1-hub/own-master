ALTER TABLE "AccountUser" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
CREATE TABLE "EmailVerificationToken" ("tokenHash" TEXT NOT NULL, "userId" TEXT NOT NULL, "returnTo" TEXT NOT NULL DEFAULT '/dashboard', "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("tokenHash"));
CREATE UNIQUE INDEX "EmailVerificationToken_userId_key" ON "EmailVerificationToken"("userId");
CREATE INDEX "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt");
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AccountUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
