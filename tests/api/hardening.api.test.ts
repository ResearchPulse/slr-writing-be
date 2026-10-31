import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/config/prisma.js';
import { errorHandler } from '../../src/middleware/error.middleware.js';
import { createUserRateLimiter } from '../../src/middleware/rate-limit.middleware.js';
import { buildSyntheticRun } from '../fixtures/synthetic-run.js';

// Integration test: needs PostgreSQL. Covers the manual-import switch and the per-user rate limiter.
const app = createApp();
const tag = `hard-${Date.now()}`;
let counter = 0;
const as = (uid: string) => ({ 'X-Dev-User-Id': uid });

afterEach(() => { env.ALLOW_MANUAL_SNAPSHOT_IMPORT = true; });
afterAll(() => prisma.$disconnect());

async function projectWithRun(uid = `${tag}-alice`) {
  const slrProjectId = `${tag}-slr-${counter++}`;
  const created = await request(app).post('/api/projects').set(as(uid)).send({ name: 'Review', slrProjectId });
  const run = buildSyntheticRun() as any;
  run.run.project_id = slrProjectId;
  run.corpus.project_id = slrProjectId;
  return { id: created.body.data.id as string, run };
}

describe('manual snapshot import switch', () => {
  it('refuses a run posted by hand when the switch is off, stores nothing, and says what to use instead', async () => {
    const { id, run } = await projectWithRun();
    env.ALLOW_MANUAL_SNAPSHOT_IMPORT = false;
    const res = await request(app).post(`/api/projects/${id}/snapshots`).set(as(`${tag}-alice`)).send(run);
    expect([res.status, res.body.error.code]).toEqual([403, 'MANUAL_IMPORT_DISABLED']);
    expect(res.body.error.message).toContain('from-slr');
    expect(await prisma.reviewSnapshot.count({ where: { projectId: id } })).toBe(0);
  });

  it('still allows the dry run (validate) and listing when the switch is off', async () => {
    const { id, run } = await projectWithRun();
    env.ALLOW_MANUAL_SNAPSHOT_IMPORT = false;
    const validate = await request(app).post(`/api/projects/${id}/snapshots/validate`).set(as(`${tag}-alice`)).send(run);
    expect(validate.status).toBe(200);
    expect((await request(app).get(`/api/projects/${id}/snapshots`).set(as(`${tag}-alice`))).status).toBe(200);
  });

  it('allows a manual import when the switch is on, and marks it manual', async () => {
    const { id, run } = await projectWithRun();
    env.ALLOW_MANUAL_SNAPSHOT_IMPORT = true;
    const res = await request(app).post(`/api/projects/${id}/snapshots`).set(as(`${tag}-alice`)).send(run);
    expect(res.status).toBe(201);
    expect(res.body.data.snapshot.sourceSystem).toBe('manual');
  });

  it('answers 404 for someone else project before it says anything about the switch', async () => {
    const { id, run } = await projectWithRun();
    env.ALLOW_MANUAL_SNAPSHOT_IMPORT = false;
    const res = await request(app).post(`/api/projects/${id}/snapshots`).set(as(`${tag}-bob`)).send(run);
    expect([res.status, res.body.error.code]).toEqual([404, 'PROJECT_NOT_FOUND']);
  });

  it('requires authentication even when the switch is off', async () => {
    const { id, run } = await projectWithRun();
    env.ALLOW_MANUAL_SNAPSHOT_IMPORT = false;
    env.DEV_AUTH_ENABLED = false;
    try {
      expect((await request(app).post(`/api/projects/${id}/snapshots`).send(run)).status).toBe(401);
    } finally { env.DEV_AUTH_ENABLED = true; }
  });
});

describe('createUserRateLimiter', () => {
  const build = (max: number, user = (req: express.Request) => req.header('x-user')) => {
    const small = express();
    small.use((req, _res, next) => { (req as any).user = user(req) ? { uid: user(req) } : undefined; next(); });
    small.post('/work', createUserRateLimiter({ max, windowMs: 60_000, code: 'RATE_LIMITED' }), (_req, res) => res.json({ ok: true }));
    small.use(errorHandler);
    return small;
  };

  it('allows up to the limit, then answers 429 RATE_LIMITED with Retry-After and the standard headers', async () => {
    const small = build(3);
    for (let i = 0; i < 3; i++) expect((await request(small).post('/work').set('x-user', 'u1')).status).toBe(200);
    const blocked = await request(small).post('/work').set('x-user', 'u1');
    expect([blocked.status, blocked.body.error.code]).toEqual([429, 'RATE_LIMITED']);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.headers['ratelimit']).toBeDefined();
  });

  it('counts each user separately, so one heavy user does not lock out another', async () => {
    const small = build(1);
    expect((await request(small).post('/work').set('x-user', 'u1')).status).toBe(200);
    expect((await request(small).post('/work').set('x-user', 'u1')).status).toBe(429);
    expect((await request(small).post('/work').set('x-user', 'u2')).status).toBe(200);
  });

  it('cannot be dodged by changing headers other than the user identity', async () => {
    const small = build(1);
    expect((await request(small).post('/work').set('x-user', 'u1').set('X-Forwarded-For', '1.1.1.1')).status).toBe(200);
    expect((await request(small).post('/work').set('x-user', 'u1').set('X-Forwarded-For', '2.2.2.2')).status).toBe(429);
  });

  it('puts all unidentified callers in one bucket instead of letting them through unlimited', async () => {
    const small = build(1, () => undefined);
    expect((await request(small).post('/work')).status).toBe(200);
    expect((await request(small).post('/work')).status).toBe(429);
  });

  it('does not reveal the message of the limit beyond a generic text', async () => {
    const small = build(1);
    await request(small).post('/work').set('x-user', 'u1');
    const blocked = await request(small).post('/work').set('x-user', 'u1');
    expect(blocked.body.error.message).toMatch(/too many/i);
    expect(JSON.stringify(blocked.body)).not.toContain('u1');
  });
});

describe('from-slr is limited in the real app', () => {
  it('has the limiter on the route (the test setting keeps it out of the way for the other tests)', async () => {
    const { id } = await projectWithRun(`${tag}-carol`);
    const res = await request(app).post(`/api/projects/${id}/snapshots/from-slr`).set(as(`${tag}-carol`)).send({ runId: 'not-a-run' });
    expect(res.headers['ratelimit']).toBeDefined();
    expect(env.FROM_SLR_RATE_LIMIT_PER_MINUTE).toBe(10000);
  });
});
