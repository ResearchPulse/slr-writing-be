import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/config/prisma.js';
import { buildSyntheticRun } from '../fixtures/synthetic-run.js';
import { FakeSlrBe } from '../slr-client/fake-slr-be.js';

const app = createApp();
const fake = new FakeSlrBe();
const tag = `qa-from-slr-${Date.now()}`;
const alice = `${tag}-alice`;
const bob = `${tag}-bob`;
const RUN = 'run-20260101000000-abc123';
const as = (uid: string, token: string | null = 'Bearer user-token') => ({ 'X-Dev-User-Id': uid, ...(token === null ? {} : { Authorization: token }) });
let counter = 0;
const originalBase = env.SLR_API_BASE_URL;
const originalTimeout = env.SLR_API_TIMEOUT_MS;
const unhandled: unknown[] = [];
const onUnhandled = (r: unknown) => unhandled.push(r);

async function newProject(uid = alice, slrProjectId = `${tag}-slr-${counter++}`) {
  const res = await request(app).post('/api/projects').set(as(uid)).send({ name: 'Review', slrProjectId });
  expect(res.status).toBe(201);
  return { id: res.body.data.id as string, slrProjectId };
}
const runFor = (slrProjectId: string, runId = RUN, mutate?: (i: any) => void) => {
  const input = buildSyntheticRun(runId) as any;
  input.run.project_id = slrProjectId;
  input.corpus.project_id = slrProjectId;
  mutate?.(input);
  return input;
};
const post = (id: string, body: unknown, uid = alice, token: string | null = 'Bearer user-token') =>
  request(app).post(`/api/projects/${id}/snapshots/from-slr`).set(as(uid, token)).send(body as object);
const snapshotCount = (projectId: string) => prisma.reviewSnapshot.count({ where: { projectId } });

beforeAll(async () => { process.on('unhandledRejection', onUnhandled); await fake.start(); env.SLR_API_BASE_URL = fake.baseUrl; });
afterAll(async () => {
  process.off('unhandledRejection', onUnhandled);
  env.SLR_API_BASE_URL = originalBase; env.SLR_API_TIMEOUT_MS = originalTimeout;
  await fake.stop(); await prisma.$disconnect();
});
beforeEach(() => { fake.reset(); env.SLR_API_TIMEOUT_MS = originalTimeout; });

describe('QA from-slr: input', () => {
  it.each([
    { runId: '%2e%2e' }, { runId: '..' }, { runId: 'run-1\n' }, { runId: ['run-1'] }, { runId: { a: 1 } }, { runId: true },
    { runId: 'run-1?x=1' }, { runId: 'r'.repeat(129) }, { runId: 'run\u0000' }, { runId: 'rün' },
  ])('rejects %j with 400 INVALID_RUN_ID and no upstream call', async (body) => {
    const { id } = await newProject();
    const res = await post(id, body);
    expect([res.status, res.body.error?.code]).toEqual([400, 'INVALID_RUN_ID']);
    expect(fake.requests).toHaveLength(0);
  });

  it('runId in the query string is ignored (body only)', async () => {
    const { id } = await newProject();
    const res = await request(app).post(`/api/projects/${id}/snapshots/from-slr?runId=${RUN}`).set(as(alice)).send({});
    expect(res.status).toBe(400);
  });

  it('non-JSON request body -> 400, no upstream call, no 500', async () => {
    const { id } = await newProject();
    const res = await request(app).post(`/api/projects/${id}/snapshots/from-slr`).set(as(alice)).set('content-type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(fake.requests).toHaveLength(0);
  });

  it('caller-supplied run/corpus/artifacts/slrProjectId in the body are ignored', async () => {
    const { id, slrProjectId } = await newProject();
    fake.serveRun(slrProjectId, runFor(slrProjectId));
    const forged = runFor(slrProjectId, RUN, (i) => { i.corpus.corpus_hash = 'forged'; i.run.corpus_hash = 'forged'; });
    const res = await post(id, { runId: RUN, slrProjectId: 'evil', projectId: 'evil', ...forged, input: forged });
    expect(res.status).toBe(201);
    expect(res.body.data.snapshot.corpusHash).toBe('corpus-hash-synthetic-1');
    expect(fake.requests.every((r) => r.url.startsWith(`/api/projects/${slrProjectId}/`))).toBe(true);
  });

  it('project id that does not exist -> 404, no upstream call', async () => {
    const res = await post('00000000-0000-0000-0000-000000000000', { runId: RUN });
    expect(res.status).toBe(404);
    expect(fake.requests).toHaveLength(0);
  });

  it.each(['..', '.'])('a project cannot be linked to the dot-segment SLR project id %j', async (slrProjectId) => {
    const res = await request(app).post('/api/projects').set(as(alice)).send({ name: 'Review', slrProjectId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(fake.requests).toHaveLength(0);
  });
});

describe('QA from-slr: auth', () => {
  it('no Authorization header: forwards none and maps upstream 401 cleanly', async () => {
    const { id, slrProjectId } = await newProject();
    fake.json(`/api/projects/${slrProjectId}/synthesis/artifacts/runs/${RUN}`, { message: 'no token' }, 401);
    const res = await post(id, { runId: RUN }, alice, null);
    expect([res.status, res.body.error.code]).toEqual([401, 'SLR_AUTH_REJECTED']);
    expect(fake.requests.every((r) => r.authorization === undefined)).toBe(true);
  });

  it('other user\'s project with their valid slr run -> 404, nothing stored', async () => {
    const { id, slrProjectId } = await newProject(alice);
    fake.serveRun(slrProjectId, runFor(slrProjectId));
    const res = await post(id, { runId: RUN }, bob);
    expect(res.status).toBe(404);
    expect(await snapshotCount(id)).toBe(0);
  });

  it('dev auth off with a Bearer token and no verifier -> 401, no upstream call', async () => {
    const { id } = await newProject();
    env.DEV_AUTH_ENABLED = false;
    try {
      const res = await request(app).post(`/api/projects/${id}/snapshots/from-slr`).set('Authorization', 'Bearer x').send({ runId: RUN });
      expect(res.status).toBe(401);
      expect(fake.requests).toHaveLength(0);
    } finally { env.DEV_AUTH_ENABLED = true; }
  });

  it('upstream 403 is 403 and nothing stored', async () => {
    const { id, slrProjectId } = await newProject();
    fake.json(`/api/projects/${slrProjectId}/synthesis/artifacts/runs/${RUN}`, {}, 403);
    const res = await post(id, { runId: RUN });
    expect([res.status, res.body.error.code]).toEqual([403, 'SLR_FORBIDDEN']);
    expect(await snapshotCount(id)).toBe(0);
  });
});

describe('QA from-slr: leakage', () => {
  it('responses never include upstream URL/base/body/stack', async () => {
    const { id, slrProjectId } = await newProject();
    const runPath = `/api/projects/${slrProjectId}/synthesis/artifacts/runs/${RUN}`;
    const bodies: string[] = [];
    for (const setup of [
      () => fake.json(runPath, { message: 'SECRET at /internal', stack: 'Error: SECRET\n at x' }, 500),
      () => fake.raw(runPath, '<html>SECRET</html>'),
      () => fake.json(runPath, { success: false, message: 'SECRET' }),
      () => fake.json(runPath, { success: true, data: { run_id: RUN, SECRET: 1 } }),
    ]) {
      setup();
      bodies.push(JSON.stringify((await post(id, { runId: RUN })).body));
    }
    env.SLR_API_BASE_URL = 'http://127.0.0.1:1';
    try { bodies.push(JSON.stringify((await post(id, { runId: RUN })).body)); } finally { env.SLR_API_BASE_URL = fake.baseUrl; }
    for (const b of bodies) {
      expect(b).not.toContain('SECRET');
      expect(b).not.toContain(fake.baseUrl);
      expect(b).not.toContain('127.0.0.1');
      expect(b).not.toContain('stack');
      expect(b).not.toContain('ECONNREFUSED');
    }
  });
});

describe('QA from-slr: timeouts', () => {
  it('upstream hang -> 504 within the configured timeout', async () => {
    const { id, slrProjectId } = await newProject();
    fake.hang(`/api/projects/${slrProjectId}/synthesis/artifacts/runs/${RUN}`);
    env.SLR_API_TIMEOUT_MS = 300;
    const t = Date.now();
    const res = await post(id, { runId: RUN });
    expect([res.status, res.body.error.code]).toEqual([504, 'SLR_TIMEOUT']);
    expect(Date.now() - t).toBeLessThan(5000);
  });
});

describe('QA from-slr: consistency through the readiness gate', () => {
  it('corpus_hash differs between run and corpus -> 422 CORPUS_HASH_MISMATCH, nothing stored', async () => {
    const { id, slrProjectId } = await newProject();
    fake.serveRun(slrProjectId, runFor(slrProjectId, RUN, (i) => { i.corpus.corpus_hash = 'other'; }));
    const res = await post(id, { runId: RUN });
    expect(res.status).toBe(422);
    expect(res.body.error.details.issues.map((x: any) => x.code)).toContain('CORPUS_HASH_MISMATCH');
    expect(await snapshotCount(id)).toBe(0);
  });

  it('run lists no MVP artifacts -> 422 ARTIFACT_MISSING', async () => {
    const { id, slrProjectId } = await newProject();
    fake.serveRun(slrProjectId, runFor(slrProjectId, RUN, (i) => { i.run.artifacts = []; }));
    const res = await post(id, { runId: RUN });
    expect(res.status).toBe(422);
    expect(res.body.error.details.issues.map((x: any) => x.code)).toContain('ARTIFACT_MISSING');
  });

  it('corpus project_id differs -> 400 RUN_PROJECT_MISMATCH', async () => {
    const { id, slrProjectId } = await newProject();
    fake.serveRun(slrProjectId, runFor(slrProjectId, RUN, (i) => { i.corpus.project_id = 'other'; }));
    const res = await post(id, { runId: RUN });
    expect([res.status, res.body.error.code]).toEqual([400, 'RUN_PROJECT_MISMATCH']);
  });

  it('run lists A1 twice -> clean 4xx/422, not a 500', async () => {
    const { id, slrProjectId } = await newProject();
    fake.serveRun(slrProjectId, runFor(slrProjectId, RUN, (i) => { i.run.artifacts.push({ ...i.run.artifacts[0], artifact_id: 'A1-dup' }); }));
    const res = await post(id, { runId: RUN });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(500);
    expect(await snapshotCount(id)).toBe(0);
  });

  it('duplicate claim item ids from upstream -> clean 4xx/422, not a 500', async () => {
    const { id, slrProjectId } = await newProject();
    fake.serveRun(slrProjectId, runFor(slrProjectId, RUN, (i) => { i.corpus.claims[0].items.push({ ...i.corpus.claims[0].items[0] }); }));
    const res = await post(id, { runId: RUN });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(500);
  });

  it('stored artifact payload id agrees with the run summary artifact id', async () => {
    const { id, slrProjectId } = await newProject();
    const input = runFor(slrProjectId);
    const base = fake.serveRun(slrProjectId, input);
    const other = buildSyntheticRun('run-20250101000000-zzz999') as any;
    fake.json(`/${base.slice(1)}/artifacts/A1`, { success: true, data: other.artifacts.A1 });
    const res = await post(id, { runId: RUN });
    if (res.status === 201) {
      const row = await prisma.snapshotArtifact.findFirst({ where: { snapshotId: res.body.data.snapshot.id, artifactType: 'A1' } });
      expect((row!.payload as any).artifact_id).toBe(row!.artifactId);
    } else {
      expect(res.status).toBe(502);
    }
  });
});

describe('QA from-slr: concurrency', () => {
  it('two simultaneous imports of the same run -> one 201, one 200, one row', async () => {
    const { id, slrProjectId } = await newProject();
    fake.serveRun(slrProjectId, runFor(slrProjectId));
    const [a, b] = await Promise.all([post(id, { runId: RUN }), post(id, { runId: RUN })]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.data.snapshot.id).toBe(b.body.data.snapshot.id);
    expect(await snapshotCount(id)).toBe(1);
    expect(await prisma.snapshotArtifact.count({ where: { snapshotId: a.body.data.snapshot.id } })).toBe(4);
  });

  it('six simultaneous imports -> exactly one 201, rest 200, one row, no 500', async () => {
    const { id, slrProjectId } = await newProject();
    fake.serveRun(slrProjectId, runFor(slrProjectId));
    const results = await Promise.all(Array.from({ length: 6 }, () => post(id, { runId: RUN })));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201), JSON.stringify(results.map((r) => r.body.error))).toHaveLength(1);
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    expect(new Set(results.map((r) => r.body.data.snapshot.id)).size).toBe(1);
    expect(await snapshotCount(id)).toBe(1);
  });

  it('same run in two different projects of the same user yields two snapshots', async () => {
    const p1 = await newProject();
    const p2 = await newProject();
    fake.serveRun(p1.slrProjectId, runFor(p1.slrProjectId));
    fake.serveRun(p2.slrProjectId, runFor(p2.slrProjectId));
    const [a, b] = await Promise.all([post(p1.id, { runId: RUN }), post(p2.id, { runId: RUN })]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.data.snapshot.id).not.toBe(b.body.data.snapshot.id);
  });

  it('re-import after upstream corpus hash changed creates a new snapshot (immutability)', async () => {
    const { id, slrProjectId } = await newProject();
    fake.serveRun(slrProjectId, runFor(slrProjectId));
    const first = await post(id, { runId: RUN });
    fake.reset();
    fake.serveRun(slrProjectId, runFor(slrProjectId, RUN, (i) => { i.run.corpus_hash = 'h2'; i.corpus.corpus_hash = 'h2'; }));
    const second = await post(id, { runId: RUN });
    expect([first.status, second.status]).toEqual([201, 201]);
    const firstAgain = await request(app).get(`/api/projects/${id}/snapshots/${first.body.data.snapshot.id}`).set(as(alice));
    expect(firstAgain.body.data.corpusHash ?? firstAgain.body.data.snapshot?.corpusHash).toBe('corpus-hash-synthetic-1');
  });

  it('no unhandled rejections', () => expect(unhandled).toEqual([]));
});
