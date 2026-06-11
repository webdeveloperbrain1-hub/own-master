-- CreateEnum
CREATE TYPE "ContractFileType" AS ENUM ('doc', 'docx', 'pdf', 'rtf', 'txt');

-- CreateEnum
CREATE TYPE "AIScanStatus" AS ENUM ('not_scanned', 'scanning', 'scanned', 'needs_review', 'failed');

-- CreateTable
CREATE TABLE "ContractTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "originalFileName" TEXT NOT NULL,
    "fileType" "ContractFileType" NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sourceZipPath" TEXT,
    "extractedText" TEXT,
    "textQuality" TEXT,
    "aiScanStatus" "AIScanStatus" NOT NULL DEFAULT 'not_scanned',
    "fieldSchema" JSONB,
    "warnings" JSONB,
    "scanError" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedContract" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT,
    "dealData" JSONB NOT NULL,
    "outputDocxPath" TEXT NOT NULL,
    "outputPdfPath" TEXT,
    "missingRequiredFields" JSONB,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedContract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractTemplate_aiScanStatus_idx" ON "ContractTemplate"("aiScanStatus");

-- CreateIndex
CREATE INDEX "ContractTemplate_fileType_idx" ON "ContractTemplate"("fileType");

-- CreateIndex
CREATE INDEX "ContractTemplate_name_idx" ON "ContractTemplate"("name");

-- CreateIndex
CREATE INDEX "GeneratedContract_templateId_idx" ON "GeneratedContract"("templateId");

-- AddForeignKey
ALTER TABLE "GeneratedContract" ADD CONSTRAINT "GeneratedContract_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ContractTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
