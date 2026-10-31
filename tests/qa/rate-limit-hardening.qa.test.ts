import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../src/middleware/error.middleware.js';
import { createUserRateLimiter } from '../../src/middleware/rate-limit.middleware.js';

// QA for the per-user limiter. The real-app part loads a fresh copy of the app with a limit of 3, because the
// limiter reads its size once when the snapshots routes module loads. Needs PostgreSQL.
const small = (max: number, windowMs = 60_000, setUser = true) => {
  const a = express();
  a.use((req, _res, next) => { if (setUser && req.header('x-user') !== undefined) (req as any).user = { uid: req.header('x-user') }; next(); });
  a.post('/work', createUserRateLimiter({ max, windowMs }), (_req, res) => res.json({ ok: true }));
  a.use(errorHandler);
  return a;
};

describe('createUserRateLimiter in isolation', () => {
  it('exactly `max` of many concurrent requests pass, the rest are 429 RATE_LIMITED', async () => {
    const a = small(5);
    const results = await Promise.all(Array.from({ length: 30 }, () => request(a).post('/work').set('x-user', 'c1')));
    const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {} as Record<number, number>);
    expect(counts).toEqual({ 200: 5, 429: 25 });
    expect(results.find((r) => r.status === 429)!.body).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
  });

  it('the window resets', async () => {
    const a = small(1, 400);
    expect((await request(a).post('/work').set('x-user', 'w')).status).toBe(200);
    expect((await request(a).post('/work').set('x-user', 'w')).status).toBe(429);
    await new Promise((r) => setTimeout(r, 600));
    expect((await request(a).post('/work').set('x-user', 'w')).status).toBe(200);
  });

  it('returns draft-7 RateLimit headers and Retry-After, no legacy X-RateLimit headers', async () => {
    const a = small(2);
    const ok = await request(a).post('/work').set('x-user', 'h');
    expect(ok.headers['ratelimit']).toMatch(/limit=2, remaining=1, reset=\d+/);
    expect(ok.headers['ratelimit-policy']).toBe('2;w=60');
    expect(ok.headers['x-ratelimit-limit']).toBeUndefined();
    await request(a).post('/work').set('x-user', 'h');
    const blocked = await request(a).post('/work').set('x-user', 'h');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('uid "anonymous" shares the bucket with requests without a user (observed; unreachable in the app since auth runs first)', async () => {
    const a = small(1);
    expect((await request(a).post('/work')).status).toBe(200);
    expect((await request(a).post('/work').set('x-user', 'anonymous')).status).toBe(429);
  });

  it('uids that differ only by case or unicode form are separate buckets (they are separate users)', async () => {
    const a = small(1);
    expect((await request(a).post('/work').set('x-user', 'bob')).status).toBe(200);
    expect((await request(a).post('/work').set('x-user', 'BOB')).status).toBe(200);
  });

  it('uid "__proto__" and "constructor" are counted like any other key', async () => {
    const a = small(1);
    for (const uid of ['__proto__', 'constructor', 'hasOwnProperty']) {
      expect((await request(a).post('/work').set('x-user', uid)).status).toBe(200);
      expect((await request(a).post('/work').set('x-user', uid)).status).toBe(429);
    }
  });

  it('many distinct users do not crash the store (memory is per window)', async () => {
    const a = small(1);
    for (let i = 0; i < 300; i++) expect((await request(a).post('/work').set('x-user', `m${i}`)).status).toBe(200);
  });
});

describe('the limiter inside the real app (limit 3)', () => {
  let app: any; let prisma: any; let env: any;
  const tag = `qa-rl-${Date.now()}`;
  let n = 0;
  const as = (u: string) => ({ 'X-Dev-User-Id': u });
  const newProject = async (u: string) => (await request(app).post('/api/projects').set(as(u)).send({ name: 'x', slrProjectId: `${tag}-${n++}` })).body.data.id as string;
  const fromSlr = (pid: string, u: string, runId: unknown = 'not a valid run', suffix = '/snapshots/from-slr') =>
    request(app).post(`/api/projects/${pid}${suffix}`).set(as(u)).send({ runId });

  beforeAll(async () => {
    process.env.FROM_SLR_RATE_LIMIT_PER_MINUTE = '3';
    vi.resetModules();
    ({ createApp: app } = await import('../../src/app.js'));
    app = app();
    ({ prisma } = await import('../../src/config/prisma.js'));
    ({ env } = await import('../../src/config/env.js'));
    env.SLR_VERIFY_PROJECT_ACCESS = false;
  });
  afterAll(async () => { process.env.FROM_SLR_RATE_LIMIT_PER_MINUTE = '10000'; await prisma.$disconnect(); });

  it('picked up the limit of 3', () => expect(env.FROM_SLR_RATE_LIMIT_PER_MINUTE).toBe(3));

  it('requests that fail validation (bad runId) still consume quota', async () => {
    const u = `${tag}-val`; const pid = await newProject(u);
    for (let i = 0; i < 3; i++) expect((await fromSlr(pid, u)).body.error.code).toBe('INVALID_RUN_ID');
    expect((await fromSlr(pid, u)).body.error.code).toBe('RATE_LIMITED');
  });

  it('requests to a project the caller does not own do NOT consume quota (ownership is checked first, 404)', async () => {
    const owner = `${tag}-own`; const stranger = `${tag}-str`;
    const pid = await newProject(owner); const own = await newProject(stranger);
    for (let i = 0; i < 5; i++) expect((await fromSlr(pid, stranger)).status).toBe(404);
    expect((await fromSlr(own, stranger)).body.error.code).toBe('INVALID_RUN_ID');
  });

  it('quota is shared across the caller\'s projects and across path variants (trailing slash, case)', async () => {
    const u = `${tag}-var`; const p1 = await newProject(u); const p2 = await newProject(u);
    await fromSlr(p1, u); await fromSlr(p2, u, 'x y', '/snapshots/from-slr/'); await fromSlr(p1, u, 'x y', '/SNAPSHOTS/FROM-SLR');
    for (const [p, s] of [[p1, '/snapshots/from-slr'], [p2, '/snapshots/from-slr/'], [p1, '/Snapshots/From-Slr']] as const) {
      expect((await fromSlr(p, u, 'x y', s)).status).toBe(429);
    }
  });

  it('dev header padding cannot dodge the limit (trimmed to the same uid)', async () => {
    const u = `${tag}-pad`; const pid = await newProject(u);
    for (let i = 0; i < 3; i++) await fromSlr(pid, u);
    const padded = await request(app).post(`/api/projects/${pid}/snapshots/from-slr`).set('X-Dev-User-Id', `  ${u}\t`).send({ runId: 'x y' });
    expect(padded.status).toBe(429);
  });

  it('other users are not affected, and other routes are not limited', async () => {
    const u = `${tag}-busy`; const pid = await newProject(u);
    for (let i = 0; i < 4; i++) await fromSlr(pid, u);
    expect((await request(app).get(`/api/projects/${pid}/snapshots`).set(as(u))).status).toBe(200);
    const other = `${tag}-calm`; const op = await newProject(other);
    expect((await fromSlr(op, other)).body.error.code).toBe('INVALID_RUN_ID');
  });

  it('many concurrent calls at the limit: exactly 3 pass the limiter, never a 500', async () => {
    const u = `${tag}-conc`; const pid = await newProject(u);
    const results = await Promise.all(Array.from({ length: 12 }, () => fromSlr(pid, u)));
    const codes = results.map((r) => r.body.error.code);
    expect(codes.filter((c) => c === 'INVALID_RUN_ID')).toHaveLength(3);
    expect(codes.filter((c) => c === 'RATE_LIMITED')).toHaveLength(9);
    expect(results.every((r) => r.status < 500)).toBe(true);
  });

  it('429 body does not leak the uid or internal detail', async () => {
    const u = `${tag}-leak`; const pid = await newProject(u);
    for (let i = 0; i < 3; i++) await fromSlr(pid, u);
    const res = await fromSlr(pid, u);
    expect(res.status).toBe(429);
    expect(JSON.stringify(res.body)).not.toContain(u);
    expect(Object.keys(res.body.error).sort()).toEqual(['code', 'message', 'requestId']);
  });
});
