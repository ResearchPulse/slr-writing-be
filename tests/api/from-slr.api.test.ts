import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/config/prisma.js';
import { buildSyntheticRun } from '../fixtures/synthetic-run.js';
import { FakeSlrBe } from '../slr-client/fake-slr-be.js';

// Integration test: needs PostgreSQL with migrations applied, plus a fake slr-be on a local port.
const app = createApp();
const fake = new FakeSlrBe();
const tag = `from-slr-${Date.now()}`;
const alice = `${tag}-alice`;
const bob = `${tag}-bob`;
const as = (uid: string) => ({ 'X-Dev-User-Id': uid, Authorization: 'Bearer user-token' });
let counter = 0;
const originalBase = env.SLR_API_BASE_URL;

async function newProject(uid = alice) {
  const slrProjectId = `${tag}-slr-${counter++}`;
  const res = await request(app).post('/api/projects').set(as(uid)).send({ name: 'Review', slrProjectId });
  return { id: res.body.data.id as string, slrProjectId };
}
const runFor = (slrProjectId: string, runId = 'run-20260101000000-abc123', mutate?: (i: any) => void) => {
  const input = buildSyntheticRun(runId) as any;
  input.run.project_id = slrProjectId;
  input.corpus.project_id = slrProjectId;
  mutate?.(input);
  return input;
};
const post = (id: string, body: unknown, uid = alice) => request(app).post(`/api/projects/${id}/snapshots/from-slr`).set(as(uid)).send(body as object);

beforeAll(async () => { await fake.start(); env.SLR_API_BASE_URL = fake.baseUrl; });
afterAll(async () => { env.SLR_API_BASE_URL = originalBase; await fake.stop(); await prisma.$disconnect(); });
beforeEach(() => fake.reset());

describe('POST /snapshots/from-slr', () => {
  it('fetches the run with the caller token and imports it (201), then 200 on repeat', async () => {
    const { id, slrProjectId } = await newProject();
    fake.serveRun(slrProjectId, runFor(slrProjectId));
    const first = await post(id, { runId: 'run-20260101000000-abc123' });
    expect(first.status).toBe(201);
    expect(first.body.data.created).toBe(true);
    expect(fake.requests.every((r) => r.authorization === 'Bearer user-token')).toBe(true);
    const second = await post(id, { runId: 'run-20260101000000-abc123' });
    expect(second.status).toBe(200);
    expect(second.body.data.snapshot.id).toBe(first.body.data.snapshot.id);
  });

  it('asks slr-be for the SLR project linked to this project, not one chosen by the caller', async () => {
    const { id, slrProjectId } = await newProject();
    fake.serveRun(slrProjectId, runFor(slrProjectId));
    await post(id, { runId: 'run-20260101000000-abc123', slrProjectId: 'someone-elses', projectId: 'x' });
    expect(fake.requests.every((r) => r.url.startsWith(`/api/projects/${slrProjectId}/`))).toBe(true);
  });

  it('applies the readiness gate: a run that is not approved gives 422 and stores nothing', async () => {
    const { id, slrProjectId } = await newProject();
    fake.serveRun(slrProjectId, runFor(slrProjectId, undefined, (i) => { i.run.artifacts[0].review_status = 'unreviewed'; }));
    const res = await post(id, { runId: 'run-20260101000000-abc123' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SNAPSHOT_NOT_READY');
    expect((await request(app).get(`/api/projects/${id}/snapshots`).set(as(alice))).body.data).toEqual([]);
  });

  it('rejects a run whose project id differs from the linked SLR project', async () => {
    const { id, slrProjectId } = await newProject();
    fake.serveRun(slrProjectId, runFor('another-slr-project'));
    const res = await post(id, { runId: 'run-20260101000000-abc123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RUN_PROJECT_MISMATCH');
  });

  it.each([{}, { runId: '' }, { runId: 5 }, { runId: '../x' }, { runId: 'a/b' }, { runId: null }])('rejects body %j with INVALID_RUN_ID and never calls slr-be', async (body) => {
    const { id } = await newProject();
    const res = await post(id, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_RUN_ID');
    expect(fake.requests).toHaveLength(0);
  });

  it('hides another user\'s project as 404 and never calls slr-be', async () => {
    const { id, slrProjectId } = await newProject(alice);
    fake.serveRun(slrProjectId, runFor(slrProjectId));
    const res = await post(id, { runId: 'run-20260101000000-abc123' }, bob);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
    expect(fake.requests).toHaveLength(0);
  });

  it('requires authentication', async () => {
    const { id } = await newProject();
    env.DEV_AUTH_ENABLED = false;
    try {
      const res = await request(app).post(`/api/projects/${id}/snapshots/from-slr`).send({ runId: 'run-1' });
      expect(res.status).toBe(401);
      expect(fake.requests).toHaveLength(0);
    } finally { env.DEV_AUTH_ENABLED = true; }
  });

  it('maps slr-be failures to clean errors', async () => {
    const { id, slrProjectId } = await newProject();
    const runPath = `/api/projects/${slrProjectId}/synthesis/artifacts/runs/run-1`;
    fake.json(runPath, { message: 'internal stack trace here' }, 401);
    let res = await post(id, { runId: 'run-1' });
    expect([res.status, res.body.error.code]).toEqual([401, 'SLR_AUTH_REJECTED']);
    fake.json(runPath, {}, 403);
    res = await post(id, { runId: 'run-1' });
    expect([res.status, res.body.error.code]).toEqual([403, 'SLR_FORBIDDEN']);
    fake.json(runPath, {}, 404);
    res = await post(id, { runId: 'run-1' });
    expect([res.status, res.body.error.code]).toEqual([404, 'SLR_NOT_FOUND']);
    fake.json(runPath, {}, 500);
    res = await post(id, { runId: 'run-1' });
    expect([res.status, res.body.error.code]).toEqual([502, 'SLR_UPSTREAM_ERROR']);
    expect(JSON.stringify(res.body)).not.toContain('stack trace');
    fake.raw(runPath, 'not json');
    res = await post(id, { runId: 'run-1' });
    expect([res.status, res.body.error.code]).toEqual([502, 'SLR_INVALID_RESPONSE']);
  });

  it('is documented in the OpenAPI spec', async () => {
    const res = await request(app).get('/api-docs.json');
    expect(Object.keys(res.body.paths)).toContain('/api/projects/{projectId}/snapshots/from-slr');
  });
});
