-- CreateEnum
CREATE TYPE "SnapshotStatus" AS ENUM ('IMPORTED', 'READY', 'BLOCKED', 'STALE');

-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10');

-- CreateEnum
CREATE TYPE "ArtifactReviewStatus" AS ENUM ('unreviewed', 'needs_human_review', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ArtifactValidationStatus" AS ENUM ('valid', 'invalid', 'not_applicable');

-- CreateEnum
CREATE TYPE "ThemeLinkStatus" AS ENUM ('resolved', 'resolved_not_reported', 'unresolved');

-- CreateEnum
CREATE TYPE "ValueDrift" AS ENUM ('unchanged', 'changed', 'unknown');

-- CreateEnum
CREATE TYPE "ConsensusMatch" AS ENUM ('match', 'mismatch', 'unknown');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "slrProjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL DEFAULT 'slr-be',
    "sourceRunId" TEXT NOT NULL,
    "corpusHash" TEXT NOT NULL,
    "corpusVersion" TEXT NOT NULL,
    "generatorVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT '1.0',
    "status" "SnapshotStatus" NOT NULL DEFAULT 'IMPORTED',
    "integrityHash" TEXT NOT NULL,
    "importedBy" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issues" JSONB,

    CONSTRAINT "ReviewSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchQuestion" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "code" TEXT,
    "text" TEXT NOT NULL,

    CONSTRAINT "ResearchQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Study" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT[],
    "year" INTEGER,
    "doi" TEXT,
    "venue" TEXT,
    "keywords" TEXT[],
    "extractionStatus" TEXT NOT NULL,

    CONSTRAINT "Study_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceRevisions" TEXT[],
    "sourceHashes" TEXT[],

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedFinding" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "sectionName" TEXT NOT NULL,
    "role" TEXT,
    "valueText" TEXT NOT NULL,
    "isNotReported" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ExtractedFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "sourceRevision" TEXT NOT NULL,
    "sourceHash" TEXT,
    "quote" TEXT NOT NULL,
    "quoteHash" TEXT,
    "quoteHashVerified" BOOLEAN NOT NULL DEFAULT false,
    "page" INTEGER,
    "section" TEXT,
    "paragraph" INTEGER,
    "tableOrFigure" TEXT,
    "charStart" INTEGER,
    "charEnd" INTEGER,
    "consensusMatch" "ConsensusMatch" NOT NULL DEFAULT 'unknown',

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceFinding" (
    "evidenceId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,

    CONSTRAINT "EvidenceFinding_pkey" PRIMARY KEY ("evidenceId","findingId")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "researchQuestionId" TEXT,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimItem" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "findingId" TEXT,
    "studyId" TEXT,
    "linkStatus" "ThemeLinkStatus" NOT NULL,
    "valueDrift" "ValueDrift" NOT NULL DEFAULT 'unknown',
    "notes" TEXT,

    CONSTRAINT "ClaimItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnapshotArtifact" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "artifactType" "ArtifactType" NOT NULL,
    "artifactId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "reviewStatus" "ArtifactReviewStatus" NOT NULL,
    "validationStatus" "ArtifactValidationStatus" NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "SnapshotArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProvenanceEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "actor" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "inputRefs" JSONB,
    "outputRefs" JSONB,
    "method" TEXT,
    "notes" TEXT,

    CONSTRAINT "ProvenanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_ownerId_slrProjectId_key" ON "Project"("ownerId", "slrProjectId");

-- CreateIndex
CREATE INDEX "ReviewSnapshot_projectId_idx" ON "ReviewSnapshot"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSnapshot_projectId_sourceRunId_corpusHash_key" ON "ReviewSnapshot"("projectId", "sourceRunId", "corpusHash");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchQuestion_snapshotId_externalId_key" ON "ResearchQuestion"("snapshotId", "externalId");

-- CreateIndex
CREATE INDEX "Study_snapshotId_idx" ON "Study"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "Study_snapshotId_externalId_key" ON "Study"("snapshotId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_snapshotId_externalId_key" ON "SourceDocument"("snapshotId", "externalId");

-- CreateIndex
CREATE INDEX "ExtractedFinding_studyId_idx" ON "ExtractedFinding"("studyId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedFinding_snapshotId_externalId_key" ON "ExtractedFinding"("snapshotId", "externalId");

-- CreateIndex
CREATE INDEX "Evidence_studyId_idx" ON "Evidence"("studyId");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_snapshotId_externalId_key" ON "Evidence"("snapshotId", "externalId");

-- CreateIndex
CREATE INDEX "EvidenceFinding_findingId_idx" ON "EvidenceFinding"("findingId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_snapshotId_externalId_key" ON "Claim"("snapshotId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimItem_claimId_externalId_key" ON "ClaimItem"("claimId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "SnapshotArtifact_snapshotId_artifactType_key" ON "SnapshotArtifact"("snapshotId", "artifactType");

-- CreateIndex
CREATE INDEX "ProvenanceEvent_projectId_createdAt_idx" ON "ProvenanceEvent"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReviewSnapshot" ADD CONSTRAINT "ReviewSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchQuestion" ADD CONSTRAINT "ResearchQuestion_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ReviewSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Study" ADD CONSTRAINT "Study_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ReviewSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ReviewSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedFinding" ADD CONSTRAINT "ExtractedFinding_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ReviewSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedFinding" ADD CONSTRAINT "ExtractedFinding_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ReviewSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SourceDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceFinding" ADD CONSTRAINT "EvidenceFinding_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceFinding" ADD CONSTRAINT "EvidenceFinding_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "ExtractedFinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ReviewSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_researchQuestionId_fkey" FOREIGN KEY ("researchQuestionId") REFERENCES "ResearchQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimItem" ADD CONSTRAINT "ClaimItem_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimItem" ADD CONSTRAINT "ClaimItem_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "ExtractedFinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimItem" ADD CONSTRAINT "ClaimItem_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotArtifact" ADD CONSTRAINT "SnapshotArtifact_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ReviewSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProvenanceEvent" ADD CONSTRAINT "ProvenanceEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProvenanceEvent" ADD CONSTRAINT "ProvenanceEvent_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ReviewSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ProvenanceEvent is append-only: block UPDATE and DELETE.
CREATE OR REPLACE FUNCTION provenance_event_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ProvenanceEvent is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER provenance_event_no_update_delete
BEFORE UPDATE OR DELETE ON "ProvenanceEvent"
FOR EACH ROW EXECUTE FUNCTION provenance_event_append_only();
