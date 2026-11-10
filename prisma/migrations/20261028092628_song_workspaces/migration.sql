-- AlterTable
ALTER TABLE "ContractDraft" ADD COLUMN     "userId" TEXT NOT NULL DEFAULT 'demo-admin';
-- Existing local drafts belong to the development demo. New drafts must
-- always receive their owner from the authenticated server session.
ALTER TABLE "ContractDraft" ALTER COLUMN "userId" DROP DEFAULT;

-- CreateTable
CREATE TABLE "MusicProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lyrics" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "audioType" TEXT,
    "audioPath" TEXT,
    "legacyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectComment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectContract" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "draftId" TEXT,
    "accountContractId" TEXT,
    "title" TEXT NOT NULL,
    "contractType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectContract_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ProjectContract" ADD CONSTRAINT "ProjectContract_one_source"
CHECK (("draftId" IS NOT NULL) <> ("accountContractId" IS NOT NULL));

-- CreateIndex
CREATE INDEX "MusicProject_userId_updatedAt_idx" ON "MusicProject"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MusicProject_userId_legacyId_key" ON "MusicProject"("userId", "legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectContract_projectId_draftId_key" ON "ProjectContract"("projectId", "draftId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectContract_projectId_accountContractId_key" ON "ProjectContract"("projectId", "accountContractId");

-- CreateIndex
CREATE INDEX "ContractDraft_userId_idx" ON "ContractDraft"("userId");

-- AddForeignKey
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "MusicProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectContract" ADD CONSTRAINT "ProjectContract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "MusicProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectContract" ADD CONSTRAINT "ProjectContract_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ContractDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
