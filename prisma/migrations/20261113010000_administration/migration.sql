ALTER TABLE "AccountUser"
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspensionReason" TEXT,
  ADD COLUMN "lastLoginAt" TIMESTAMP(3),
  ADD COLUMN "lastActiveAt" TIMESTAMP(3);

ALTER TABLE "ContractFile"
  ADD COLUMN "displayTitle" TEXT,
  ADD COLUMN "displayCategory" TEXT,
  ADD COLUMN "displayDescription" TEXT,
  ADD COLUMN "libraryKind" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedBy" TEXT,
  ADD COLUMN "reviewNote" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "ContractFile_archivedAt_idx" ON "ContractFile"("archivedAt");

CREATE TABLE "SupportTicket" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "AccountUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL DEFAULT 'support',
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "targetId" TEXT,
  "targetTitle" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "SupportTicket_userId_updatedAt_idx" ON "SupportTicket"("userId", "updatedAt");
CREATE INDEX "SupportTicket_status_kind_updatedAt_idx" ON "SupportTicket"("status", "kind", "updatedAt");

CREATE TABLE "SupportReply" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ticketId" TEXT NOT NULL REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "authorId" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "isStaff" BOOLEAN NOT NULL DEFAULT false,
  "isInternal" BOOLEAN NOT NULL DEFAULT false,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SupportReply_ticketId_createdAt_idx" ON "SupportReply"("ticketId", "createdAt");

CREATE TABLE "PlatformActivity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorId" TEXT,
  "actorName" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "description" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PlatformActivity_createdAt_idx" ON "PlatformActivity"("createdAt");
CREATE INDEX "PlatformActivity_actorId_createdAt_idx" ON "PlatformActivity"("actorId", "createdAt");
CREATE INDEX "PlatformActivity_action_createdAt_idx" ON "PlatformActivity"("action", "createdAt");
