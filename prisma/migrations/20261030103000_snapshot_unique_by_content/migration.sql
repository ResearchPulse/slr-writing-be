-- DropIndex
DROP INDEX "ReviewSnapshot_projectId_sourceRunId_corpusHash_key";

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSnapshot_projectId_sourceRunId_corpusHash_integrityHa_key" ON "ReviewSnapshot"("projectId", "sourceRunId", "corpusHash", "integrityHash");

