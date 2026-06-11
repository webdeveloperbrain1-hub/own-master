-- AlterTable
ALTER TABLE "ContractTemplate" ADD COLUMN     "fileHash" TEXT;

-- CreateIndex
CREATE INDEX "ContractTemplate_fileHash_idx" ON "ContractTemplate"("fileHash");
