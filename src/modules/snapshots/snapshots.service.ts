import { prisma } from '../../config/prisma.js';
import { NotFoundError } from '../../shared/errors/app-error.js';

const snapshotSummary = {
  id: true, projectId: true, sourceSystem: true, sourceRunId: true, corpusHash: true, corpusVersion: true,
  generatorVersion: true, schemaVersion: true, status: true, importedBy: true, importedAt: true,
} as const;

export const listSnapshots = (projectId: string) =>
  prisma.reviewSnapshot.findMany({ where: { projectId }, select: snapshotSummary, orderBy: { importedAt: 'desc' } });

/** One snapshot with its readiness issues, row counts and artifact statuses (payloads are not returned). */
export async function getSnapshot(projectId: string, snapshotId: string) {
  const snapshot = await prisma.reviewSnapshot.findFirst({
    where: { id: snapshotId, projectId },
    select: {
      ...snapshotSummary,
      issues: true,
      integrityHash: true,
      artifacts: { select: { artifactType: true, artifactId: true, contentHash: true, reviewStatus: true, validationStatus: true } },
      _count: { select: { researchQuestions: true, studies: true, documents: true, findings: true, evidence: true, claims: true } },
    },
  });
  if (!snapshot) throw new NotFoundError('Snapshot not found', 'SNAPSHOT_NOT_FOUND');
  return snapshot;
}
