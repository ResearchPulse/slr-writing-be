import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma.js';

// Integration test: needs PostgreSQL with migrations applied (npm run db:up && npm run db:deploy).
const tag = `test-${Date.now()}`;
let projectId: string;
let snapshotId: string;

const snapshotData = (corpusHash: string) => ({
  projectId,
  sourceRunId: 'run-20260101000000-abc123',
  corpusHash,
  corpusVersion: 'slr-artifact-corpus-v2',
  generatorVersion: '1.1.0',
  integrityHash: 'sha256:test',
  importedBy: 'tester',
});

describe('snapshot schema', () => {
  beforeAll(async () => {
    const project = await prisma.project.create({ data: { name: tag, ownerId: tag, slrProjectId: tag } });
    projectId = project.id;
    const snapshot = await prisma.reviewSnapshot.create({ data: snapshotData('hash-1') });
    snapshotId = snapshot.id;
  });

  afterAll(async () => {
    // ProvenanceEvent is append-only, so the test project and its event stay behind; snapshot rows are removed.
    await prisma.study.deleteMany({ where: { snapshotId } });
    await prisma.reviewSnapshot.delete({ where: { id: snapshotId } });
    await prisma.$disconnect();
  });

  it('rejects importing the same run and corpus hash twice', async () => {
    await expect(prisma.reviewSnapshot.create({ data: snapshotData('hash-1') })).rejects.toThrow();
  });

  it('accepts the same run with a different corpus hash', async () => {
    const second = await prisma.reviewSnapshot.create({ data: snapshotData('hash-2') });
    expect(second.id).not.toBe(snapshotId);
    await prisma.reviewSnapshot.delete({ where: { id: second.id } });
  });

  it('rejects duplicate external ids inside one snapshot', async () => {
    const data = { snapshotId, externalId: 'study-1', title: 'A', extractionStatus: 'COMPLETED' };
    await prisma.study.create({ data });
    await expect(prisma.study.create({ data })).rejects.toThrow();
  });

  it('rejects evidence that points to a missing document', async () => {
    const study = await prisma.study.findFirstOrThrow({ where: { snapshotId, externalId: 'study-1' } });
    await expect(prisma.evidence.create({
      data: {
        snapshotId, studyId: study.id, documentId: '00000000-0000-0000-0000-000000000000',
        externalId: 'e1', fieldId: 'f1', sourceRevision: 'r1', quote: 'q',
      },
    })).rejects.toThrow();
  });

  it('keeps ProvenanceEvent append-only', async () => {
    const event = await prisma.provenanceEvent.create({
      data: { projectId, actor: 'tester', activity: 'import' },
    });
    await expect(prisma.provenanceEvent.update({ where: { id: event.id }, data: { notes: 'x' } })).rejects.toThrow();
    await expect(prisma.provenanceEvent.delete({ where: { id: event.id } })).rejects.toThrow();
  });
});
