-- CreateTable
CREATE TABLE "ContractFile" (
    "id" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "originalPath" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "textLength" INTEGER NOT NULL DEFAULT 0,
    "extractedText" TEXT,
    "extractionStatus" TEXT NOT NULL DEFAULT 'pending',
    "extractionWarnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "analysisStatus" TEXT NOT NULL DEFAULT 'pending',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "title" TEXT,
    "contractType" TEXT,
    "category" TEXT,
    "parties" JSONB,
    "effectiveDate" TEXT,
    "expirationDate" TEXT,
    "summary" TEXT,
    "keyTerms" JSONB,
    "obligations" JSONB,
    "rights" JSONB,
    "paymentTerms" TEXT,
    "territory" TEXT,
    "duration" TEXT,
    "governingLaw" TEXT,
    "renewalTerms" TEXT,
    "terminationTerms" TEXT,
    "riskFlags" JSONB,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION,
    "analyzerModel" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractTemplateFieldScan" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "analyzerModel" TEXT,
    "fields" JSONB NOT NULL,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractTemplateFieldScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractDraft" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "renderedText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContractFile_sha256_key" ON "ContractFile"("sha256");

-- CreateIndex
CREATE INDEX "ContractFile_contractType_idx" ON "ContractFile"("contractType");

-- CreateIndex
CREATE INDEX "ContractFile_category_idx" ON "ContractFile"("category");

-- CreateIndex
CREATE INDEX "ContractFile_needsReview_idx" ON "ContractFile"("needsReview");

-- CreateIndex
CREATE INDEX "ContractFile_analysisStatus_idx" ON "ContractFile"("analysisStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ContractTemplateFieldScan_templateId_key" ON "ContractTemplateFieldScan"("templateId");

-- CreateIndex
CREATE INDEX "ContractTemplateFieldScan_status_idx" ON "ContractTemplateFieldScan"("status");

-- CreateIndex
CREATE INDEX "ContractDraft_templateId_idx" ON "ContractDraft"("templateId");

-- CreateIndex
CREATE INDEX "ContractDraft_status_idx" ON "ContractDraft"("status");

-- AddForeignKey
ALTER TABLE "ContractTemplateFieldScan" ADD CONSTRAINT "ContractTemplateFieldScan_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ContractFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractDraft" ADD CONSTRAINT "ContractDraft_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ContractFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
