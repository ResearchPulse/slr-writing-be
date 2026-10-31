import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import {
  computeIntegrityHash, importSnapshot, SnapshotNotReadyError, validateImport,
} from '../../src/modules/snapshots/snapshot-import.service.js';
import { importInputSchema } from '../../src/modules/snapshots/slr-source.schemas.js';
import { buildSyntheticRun } from '../fixtures/synthetic-run.js';

// Integration test: needs PostgreSQL with migrations applied (npm run db:up && npm run db:deploy).
// ProvenanceEvent is append-only, so imported snapshots cannot be deleted; every test uses its own project instead.
const tag = `import-${Date.now()}`;
let counter = 0;

async function setup(mutate?: (input: any) => void) {
  const slrProjectId = `${tag}-${counter++}`;
  const project = await prisma.project.create({ data: { name: slrProjectId, ownerId: tag, slrProjectId } });
  const input = buildSyntheticRun() as any;
  input.run.project_id = slrProjectId;
  input.corpus.project_id = slrProjectId;
  mutate?.(input);
  return { project, input };
}

describe('importSnapshot', () => {
  afterAll(() => prisma.$disconnect());

  it('stores the whole run and links it together', async () => {
    const { project, input } = await setup();
    const { snapshot, created } = await importSnapshot({ projectId: project.id, importedBy: 'u1', input });
    expect(created).toBe(true);
    expect(snapshot.status).toBe('READY');
    expect(snapshot.integrityHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const counts = await Promise.all([
      prisma.researchQuestion.count({ where: { snapshotId: snapshot.id } }),
      prisma.study.count({ where: { snapshotId: snapshot.id } }),
      prisma.sourceDocument.count({ where: { snapshotId: snapshot.id } }),
      prisma.extractedFinding.count({ where: { snapshotId: snapshot.id } }),
      prisma.evidence.count({ where: { snapshotId: snapshot.id } }),
      prisma.claim.count({ where: { snapshotId: snapshot.id } }),
      prisma.snapshotArtifact.count({ where: { snapshotId: snapshot.id } }),
      prisma.evidenceFinding.count({ where: { evidence: { snapshotId: snapshot.id } } }),
      prisma.claimItem.count({ where: { claim: { snapshotId: snapshot.id } } }),
    ]);
    expect(counts).toEqual([1, 2, 2, 2, 1, 1, 4, 1, 1]);
  });

  it('keeps nulls as nulls and the anchor fields intact', async () => {
    const { project, input } = await setup();
    const { snapshot } = await importSnapshot({ projectId: project.id, importedBy: 'u1', input });
    const noDoi = await prisma.study.findFirstOrThrow({ where: { snapshotId: snapshot.id, externalId: 'paper-2' } });
    expect(noDoi.doi).toBeNull();
    const evidence = await prisma.evidence.findFirstOrThrow({ where: { snapshotId: snapshot.id } });
    expect(evidence).toMatchObject({ page: 5, section: 'Results', paragraph: 12, charStart: 10, charEnd: 60, quoteHashVerified: true });
  });

  it('traces a theme back to its source quote', async () => {
    const { project, input } = await setup();
    const { snapshot } = await importSnapshot({ projectId: project.id, importedBy: 'u1', input });
    const claim = await prisma.claim.findFirstOrThrow({
      where: { snapshotId: snapshot.id },
      include: { items: { include: { finding: { include: { evidence: { include: { evidence: { include: { document: true, study: true } } } } } } } } },
    });
    const evidence = claim.items[0].finding!.evidence[0].evidence;
    expect(evidence.quote).toContain('improved the outcome');
    expect(evidence.document.externalId).toBe('doc-1');
    expect(evidence.study.title).toBe('Synthetic study one');
  });

  it('is idempotent for the same run and corpus hash', async () => {
    const { project, input } = await setup();
    const first = await importSnapshot({ projectId: project.id, importedBy: 'u1', input });
    const second = await importSnapshot({ projectId: project.id, importedBy: 'u2', input });
    expect(second.created).toBe(false);
    expect(second.snapshot.id).toBe(first.snapshot.id);
    expect(await prisma.provenanceEvent.count({ where: { projectId: project.id } })).toBe(1);
  });

  it('resolves concurrent imports of the same run to one snapshot', async () => {
    const { project, input } = await setup();
    const results = await Promise.all([1, 2, 3].map(() => importSnapshot({ projectId: project.id, importedBy: 'u1', input })));
    expect(new Set(results.map((result) => result.snapshot.id)).size).toBe(1);
    expect(await prisma.reviewSnapshot.count({ where: { projectId: project.id } })).toBe(1);
  });

  it('creates a new snapshot when the corpus hash changes', async () => {
    const { project, input } = await setup();
    const first = await importSnapshot({ projectId: project.id, importedBy: 'u1', input });
    input.run.corpus_hash = 'corpus-hash-synthetic-2';
    input.corpus.corpus_hash = 'corpus-hash-synthetic-2';
    const second = await importSnapshot({ projectId: project.id, importedBy: 'u1', input });
    expect(second.created).toBe(true);
    expect(second.snapshot.id).not.toBe(first.snapshot.id);
  });

  it('rejects a blocked run and stores nothing', async () => {
    const { project, input } = await setup((i) => { i.run.artifacts[0].review_status = 'unreviewed'; });
    await expect(importSnapshot({ projectId: project.id, importedBy: 'u1', input })).rejects.toBeInstanceOf(SnapshotNotReadyError);
    expect(await prisma.reviewSnapshot.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.provenanceEvent.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('rejects a run from a different SLR project', async () => {
    const { project, input } = await setup((i) => { i.run.project_id = 'someone-elses'; });
    await expect(importSnapshot({ projectId: project.id, importedBy: 'u1', input })).rejects.toMatchObject({ code: 'RUN_PROJECT_MISMATCH' });
  });

  it('rejects an unknown project and a malformed payload', async () => {
    await expect(importSnapshot({ projectId: '00000000-0000-0000-0000-000000000000', importedBy: 'u1', input: {} }))
      .rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    const { project } = await setup();
    await expect(importSnapshot({ projectId: project.id, importedBy: 'u1', input: { run: {} } }))
      .rejects.toMatchObject({ code: 'INVALID_IMPORT_INPUT' });
  });

  it('rolls back everything when a row fails inside the transaction', async () => {
    // A year beyond a 32-bit integer passes validation but fails on insert, after the snapshot row was created.
    const { project, input } = await setup((i) => { i.corpus.studies[0].year = 3_000_000_000; });
    await expect(importSnapshot({ projectId: project.id, importedBy: 'u1', input })).rejects.toThrow();
    expect(await prisma.reviewSnapshot.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.study.count({ where: { snapshot: { projectId: project.id } } })).toBe(0);
    expect(await prisma.provenanceEvent.count({ where: { projectId: project.id } })).toBe(0);
  });
});

describe('validateImport and computeIntegrityHash', () => {
  it('reports blocking issues without storing anything', () => {
    const input = buildSyntheticRun() as any;
    input.corpus.research_questions = [];
    expect(validateImport(input).status).toBe('BLOCKED');
  });

  it('hashes the same content identically whatever the key order', () => {
    const a = importInputSchema.parse(buildSyntheticRun());
    const reordered = importInputSchema.parse(JSON.parse(JSON.stringify(buildSyntheticRun(), (_k, v) =>
      (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v))));
    expect(computeIntegrityHash(reordered)).toBe(computeIntegrityHash(a));
  });

  it('changes when the content changes', () => {
    const a = importInputSchema.parse(buildSyntheticRun());
    const raw = buildSyntheticRun() as any;
    raw.corpus.studies[0].title = 'changed';
    expect(computeIntegrityHash(importInputSchema.parse(raw))).not.toBe(computeIntegrityHash(a));
  });
});
