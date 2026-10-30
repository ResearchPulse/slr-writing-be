-- CreateTable
CREATE TABLE "SnapshotSupplement" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "schemaVersion" TEXT,
    "contentHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "SnapshotSupplement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SnapshotSupplement_snapshotId_kind_key" ON "SnapshotSupplement"("snapshotId", "kind");

-- AddForeignKey
ALTER TABLE "SnapshotSupplement" ADD CONSTRAINT "SnapshotSupplement_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ReviewSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
