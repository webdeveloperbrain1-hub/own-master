-- CreateEnum
CREATE TYPE "ContractProgressStage" AS ENUM ('draft', 'ready_for_review', 'awaiting_signatures', 'signed', 'cancelled');

-- CreateTable
CREATE TABLE "ContractProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "draftId" TEXT,
    "accountContractId" TEXT,
    "status" "ContractProgressStage" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractProgress_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ContractProgress" ADD CONSTRAINT "ContractProgress_one_source"
CHECK (("draftId" IS NOT NULL) <> ("accountContractId" IS NOT NULL));

-- CreateTable
CREATE TABLE "ContractProgressEvent" (
    "id" TEXT NOT NULL,
    "progressId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" "ContractProgressStage",
    "toStatus" "ContractProgressStage" NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractProgressEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignedContractCopy" (
    "id" TEXT NOT NULL,
    "progressId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignedContractCopy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContractProgress_draftId_key" ON "ContractProgress"("draftId");

-- CreateIndex
CREATE INDEX "ContractProgress_userId_updatedAt_idx" ON "ContractProgress"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContractProgress_userId_accountContractId_key" ON "ContractProgress"("userId", "accountContractId");

-- CreateIndex
CREATE INDEX "ContractProgressEvent_progressId_createdAt_idx" ON "ContractProgressEvent"("progressId", "createdAt");

-- CreateIndex
CREATE INDEX "SignedContractCopy_progressId_uploadedAt_idx" ON "SignedContractCopy"("progressId", "uploadedAt");

-- AddForeignKey
ALTER TABLE "ContractProgress" ADD CONSTRAINT "ContractProgress_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ContractDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractProgressEvent" ADD CONSTRAINT "ContractProgressEvent_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "ContractProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedContractCopy" ADD CONSTRAINT "SignedContractCopy_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "ContractProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
