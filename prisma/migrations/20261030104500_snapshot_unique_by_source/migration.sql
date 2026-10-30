-- DropIndex
DROP INDEX "ReviewSnapshot_projectId_sourceRunId_corpusHash_integrityHa_key";

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSnapshot_projectId_sourceSystem_sourceRunId_corpusHas_key" ON "ReviewSnapshot"("projectId", "sourceSystem", "sourceRunId", "corpusHash", "integrityHash");

