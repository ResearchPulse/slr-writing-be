import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import { computeIntegrityHash, importSnapshot } from '../../src/modules/snapshots/snapshot-import.service.js';
import { importInputSchema } from '../../src/modules/snapshots/slr-source.schemas.js';
import { SlrClient } from '../../src/modules/slr-client/slr-client.js';
import { FakeSlrBe } from '../slr-client/fake-slr-be.js';

// Integration test with the run exported from a real slr-be (see real-slr-be-run.test.ts). Needs PostgreSQL.
const real = () => JSON.parse(readFileSync(new URL('../fixtures/real/slr-be-demo-run.json', import.meta.url), 'utf8'));
const tag = `real-${Date.now()}`;
let counter = 0;

async function setup() {
  const slrProjectId = `${tag}-${counter++}`;
  const project = await prisma.project.create({ data: { name: slrProjectId, ownerId: tag, slrProjectId } });
  const raw = real();
  raw.run.project_id = slrProjectId;
  raw.corpus.project_id = slrProjectId;
  if (raw.supplements) raw.supplements.prisma_writing_export.project.id = slrProjectId;
  return { project, raw, slrProjectId };
}

afterAll(() => prisma.$disconnect());

describe('importing the real run', () => {
  it('stores rows for studies, findings, claims, artifacts and both supplements', async () => {
    const { project, raw } = await setup();
    const { snapshot, created, readiness } = await importSnapshot({ projectId: project.id, importedBy: 'u', input: raw });
    expect(created).toBe(true);
    expect(readiness.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['NO_EVIDENCE']));

    const counts = await prisma.reviewSnapshot.findUniqueOrThrow({
      where: { id: snapshot.id },
      select: { _count: { select: { studies: true, findings: true, claims: true, evidence: true, artifacts: true, supplements: true } } },
    });
    expect(counts._count).toEqual({ studies: 6, findings: 30, claims: 3, evidence: 0, artifacts: 4, supplements: 2 });
    expect(await prisma.claimItem.count({ where: { claim: { snapshotId: snapshot.id } } })).toBe(12);

    const supplements = await prisma.snapshotSupplement.findMany({ where: { snapshotId: snapshot.id }, orderBy: { kind: 'asc' } });
    expect(supplements.map((s) => s.kind)).toEqual(['prisma_writing_export', 'rq_findings']);
    expect(supplements[0].schemaVersion).toBe('slr-prisma-writing-v1');
    expect(supplements.every((s) => /^sha256:[0-9a-f]{64}$/.test(s.contentHash))).toBe(true);
  });

  it('includes the supplements in the integrity hash, and leaves it unchanged when there are none', () => {
    const withSup = importInputSchema.parse(real());
    const without = importInputSchema.parse({ ...real(), supplements: undefined });
    expect(Object.keys(without.supplements)).toEqual([]);
    expect(computeIntegrityHash(withSup)).not.toBe(computeIntegrityHash(without));
    const changed = importInputSchema.parse(real());
    changed.supplements.prisma_writing_export!.flow.studiesIncluded = 99;
    expect(computeIntegrityHash(changed)).not.toBe(computeIntegrityHash(withSup));
  });

  it('imports a run without supplements (older callers) and stores none', async () => {
    const { project, raw } = await setup();
    delete raw.supplements;
    const { snapshot, readiness } = await importSnapshot({ projectId: project.id, importedBy: 'u', input: raw });
    expect(await prisma.snapshotSupplement.count({ where: { snapshotId: snapshot.id } })).toBe(0);
    expect(readiness.issues.map((i) => i.code)).toContain('PRISMA_EXPORT_MISSING');
  });

  it('rejects a malformed supplement instead of storing it', async () => {
    const { project, raw } = await setup();
    raw.supplements.prisma_writing_export = { schemaVersion: 'x' };
    await expect(importSnapshot({ projectId: project.id, importedBy: 'u', input: raw })).rejects.toMatchObject({ code: 'INVALID_IMPORT_INPUT' });
  });
});

describe('fetching the real run through the client', () => {
  const fake = new FakeSlrBe();
  beforeAll(() => fake.start());
  afterAll(() => fake.stop());
  beforeEach(() => fake.reset());
  const fetchIt = (slrProjectId: string, runId: string) => new SlrClient({ baseUrl: fake.baseUrl, timeoutMs: 3000 }).fetchRun(slrProjectId, runId, { authorization: 'Bearer t' });
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => `${e.statusCode}:${e.code}`);

  it('collects the run, corpus, artifacts and both supplements', async () => {
    const { raw, slrProjectId } = await setup();
    fake.serveRun(slrProjectId, raw);
    const input = await fetchIt(slrProjectId, raw.run.run_id);
    expect(Object.keys(input.supplements).sort()).toEqual(['prisma_writing_export', 'rq_findings']);
    expect(input.supplements.prisma_writing_export?.flow.studiesIncluded).toBe(6);
  });

  it('still works when the project has no PRISMA export or RQ findings (404)', async () => {
    const { raw, slrProjectId } = await setup();
    delete raw.supplements;
    fake.serveRun(slrProjectId, raw);
    expect((await fetchIt(slrProjectId, raw.run.run_id)).supplements).toEqual({});
  });

  it('fails the whole fetch when a supplement errors for any reason other than 404', async () => {
    const { raw, slrProjectId } = await setup();
    fake.serveRun(slrProjectId, raw);
    fake.json(`/api/projects/${slrProjectId}/prisma/writing-export.json`, {}, 500);
    expect(await code(fetchIt(slrProjectId, raw.run.run_id))).toBe('502:SLR_UPSTREAM_ERROR');
    fake.json(`/api/projects/${slrProjectId}/prisma/writing-export.json`, {}, 403);
    expect(await code(fetchIt(slrProjectId, raw.run.run_id))).toBe('403:SLR_FORBIDDEN');
  });

  it('fails when the PRISMA export has the wrong shape', async () => {
    const { raw, slrProjectId } = await setup();
    fake.serveRun(slrProjectId, raw);
    fake.json(`/api/projects/${slrProjectId}/prisma/writing-export.json`, { success: true, data: { schemaVersion: 'x' } });
    expect(await code(fetchIt(slrProjectId, raw.run.run_id))).toBe('502:SLR_INVALID_RESPONSE');
  });
});

describe('content decides the snapshot', () => {
  it('blocks a PRISMA export that belongs to another project', async () => {
    const { project, raw } = await setup();
    raw.supplements.prisma_writing_export.project.id = 'some-other-project';
    await expect(importSnapshot({ projectId: project.id, importedBy: 'u', input: raw })).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_READY' });
  });

  it('keeps one snapshot for identical content and adds another when the PRISMA export changes', async () => {
    const { project, raw } = await setup();
    const a = await importSnapshot({ projectId: project.id, importedBy: 'u', input: structuredClone(raw) });
    const again = await importSnapshot({ projectId: project.id, importedBy: 'u', input: structuredClone(raw) });
    expect(again.created).toBe(false);
    expect(again.snapshot.id).toBe(a.snapshot.id);
    raw.supplements.prisma_writing_export.flow.recordsScreened = 7;
    const changed = await importSnapshot({ projectId: project.id, importedBy: 'u', input: raw });
    expect(changed.created).toBe(true);
    expect(changed.snapshot.id).not.toBe(a.snapshot.id);
  });

  it('marks what the service posted by hand as manual, and what it fetched itself as slr-be', async () => {
    const { project, raw } = await setup();
    const manual = await importSnapshot({ projectId: project.id, importedBy: 'u', input: raw });
    expect(manual.snapshot.sourceSystem).toBe('manual');
    const fetched = await importSnapshot({ projectId: project.id, importedBy: 'u', input: structuredClone(raw), source: 'slr-be' });
    expect(fetched.snapshot.sourceSystem).toBe('slr-be');
  });
});
