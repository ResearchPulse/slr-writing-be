import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/config/prisma.js';
import { setTokenVerifier } from '../../src/middleware/auth.middleware.js';
import { buildSyntheticRun } from '../fixtures/synthetic-run.js';

// Integration test: needs PostgreSQL with migrations applied (npm run db:up && npm run db:deploy).
const app = createApp();
const tag = `api-${Date.now()}`;
let counter = 0;

const as = (uid: string) => ({ 'X-Dev-User-Id': uid });
const alice = `${tag}-alice`;
const bob = `${tag}-bob`;

async function newProject(uid = alice) {
  const slrProjectId = `${tag}-slr-${counter++}`;
  const res = await request(app).post('/api/projects').set(as(uid)).send({ name: 'Review', slrProjectId });
  expect(res.status).toBe(201);
  return { id: res.body.data.id as string, slrProjectId };
}

const runFor = (slrProjectId: string, mutate?: (input: any) => void) => {
  const input = buildSyntheticRun() as any;
  input.run.project_id = slrProjectId;
  input.corpus.project_id = slrProjectId;
  mutate?.(input);
  return input;
};

afterEach(() => {
  setTokenVerifier(null);
  env.DEV_AUTH_ENABLED = true;
});
afterAll(() => prisma.$disconnect());

describe('authentication', () => {
  it('rejects requests when dev auth is off and no verifier is set (fail closed)', async () => {
    env.DEV_AUTH_ENABLED = false;
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a bearer token when no verifier is configured and dev auth is off', async () => {
    env.DEV_AUTH_ENABLED = false;
    const res = await request(app).get('/api/projects').set('Authorization', 'Bearer abc');
    expect(res.status).toBe(401);
  });

  it('uses the verifier for bearer tokens and rejects invalid ones', async () => {
    env.DEV_AUTH_ENABLED = false;
    setTokenVerifier(async (token) => (token === 'good' ? { uid: `${tag}-verified` } : null));
    expect((await request(app).get('/api/projects').set('Authorization', 'Bearer good')).status).toBe(200);
    const bad = await request(app).get('/api/projects').set('Authorization', 'Bearer bad');
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_TOKEN');
  });
});

describe('projects', () => {
  it('creates a project, rejects a duplicate link, and lists only the caller\'s projects', async () => {
    const { id, slrProjectId } = await newProject(alice);
    const duplicate = await request(app).post('/api/projects').set(as(alice)).send({ name: 'Again', slrProjectId });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('PROJECT_EXISTS');

    const mine = await request(app).get('/api/projects').set(as(alice));
    expect(mine.body.data.map((p: any) => p.id)).toContain(id);
    const theirs = await request(app).get('/api/projects').set(as(bob));
    expect(theirs.body.data.map((p: any) => p.id)).not.toContain(id);
  });

  it('hides someone else\'s project as not found', async () => {
    const { id } = await newProject(alice);
    const res = await request(app).get(`/api/projects/${id}`).set(as(bob));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('validates the request body', async () => {
    const res = await request(app).post('/api/projects').set(as(alice)).send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('snapshots', () => {
  it('validates a run without storing anything', async () => {
    const { id, slrProjectId } = await newProject();
    const res = await request(app).post(`/api/projects/${id}/snapshots/validate`).set(as(alice)).send(runFor(slrProjectId));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('READY');
    const list = await request(app).get(`/api/projects/${id}/snapshots`).set(as(alice));
    expect(list.body.data).toEqual([]);
  });

  it('imports a run (201), then returns the same snapshot on re-import (200)', async () => {
    const { id, slrProjectId } = await newProject();
    const body = runFor(slrProjectId);
    const first = await request(app).post(`/api/projects/${id}/snapshots`).set(as(alice)).send(body);
    expect(first.status).toBe(201);
    expect(first.body.data.created).toBe(true);
    const second = await request(app).post(`/api/projects/${id}/snapshots`).set(as(alice)).send(body);
    expect(second.status).toBe(200);
    expect(second.body.data.created).toBe(false);
    expect(second.body.data.snapshot.id).toBe(first.body.data.snapshot.id);
  });

  it('shows the snapshot with counts, artifact statuses and no payloads', async () => {
    const { id, slrProjectId } = await newProject();
    const created = await request(app).post(`/api/projects/${id}/snapshots`).set(as(alice)).send(runFor(slrProjectId));
    const snapshotId = created.body.data.snapshot.id;
    const res = await request(app).get(`/api/projects/${id}/snapshots/${snapshotId}`).set(as(alice));
    expect(res.status).toBe(200);
    expect(res.body.data._count).toMatchObject({ studies: 2, evidence: 1, claims: 1, researchQuestions: 1 });
    expect(res.body.data.artifacts).toHaveLength(4);
    expect(JSON.stringify(res.body.data.artifacts)).not.toContain('payload');
  });

  it('returns 422 with the readiness report for a blocked run and stores nothing', async () => {
    const { id, slrProjectId } = await newProject();
    const body = runFor(slrProjectId, (i) => { i.run.artifacts[0].review_status = 'unreviewed'; });
    const res = await request(app).post(`/api/projects/${id}/snapshots`).set(as(alice)).send(body);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SNAPSHOT_NOT_READY');
    expect(res.body.error.details.issues.map((i: any) => i.code)).toContain('ARTIFACT_NOT_APPROVED');
    expect((await request(app).get(`/api/projects/${id}/snapshots`).set(as(alice))).body.data).toEqual([]);
  });

  it('rejects a run from another SLR project and a malformed payload', async () => {
    const { id, slrProjectId } = await newProject();
    const other = await request(app).post(`/api/projects/${id}/snapshots`).set(as(alice)).send(runFor('not-this-one'));
    expect(other.status).toBe(400);
    expect(other.body.error.code).toBe('RUN_PROJECT_MISMATCH');
    const bad = await request(app).post(`/api/projects/${id}/snapshots`).set(as(alice)).send({ run: {} });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_IMPORT_INPUT');
    expect(slrProjectId).toBeTruthy();
  });

  it('keeps one user from reading or writing another user\'s snapshots', async () => {
    const { id, slrProjectId } = await newProject(alice);
    const created = await request(app).post(`/api/projects/${id}/snapshots`).set(as(alice)).send(runFor(slrProjectId));
    const snapshotId = created.body.data.snapshot.id;

    expect((await request(app).get(`/api/projects/${id}/snapshots`).set(as(bob))).status).toBe(404);
    expect((await request(app).get(`/api/projects/${id}/snapshots/${snapshotId}`).set(as(bob))).status).toBe(404);
    expect((await request(app).post(`/api/projects/${id}/snapshots`).set(as(bob)).send(runFor(slrProjectId))).status).toBe(404);
    expect((await request(app).post(`/api/projects/${id}/snapshots/validate`).set(as(bob)).send(runFor(slrProjectId))).status).toBe(404);
  });

  it('does not find a snapshot through a different project of the same owner', async () => {
    const a = await newProject(alice);
    const b = await newProject(alice);
    const created = await request(app).post(`/api/projects/${a.id}/snapshots`).set(as(alice)).send(runFor(a.slrProjectId));
    const res = await request(app).get(`/api/projects/${b.id}/snapshots/${created.body.data.snapshot.id}`).set(as(alice));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SNAPSHOT_NOT_FOUND');
  });
});
