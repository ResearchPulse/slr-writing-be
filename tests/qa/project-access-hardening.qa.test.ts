import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { openApiDocument } from '../../src/config/openapi.js';
import { prisma } from '../../src/config/prisma.js';
import { buildSyntheticRun } from '../fixtures/synthetic-run.js';
import { FakeSlrBe } from '../slr-client/fake-slr-be.js';

// QA for the slr-be access check on POST /projects, the manual import switch and OpenAPI. Needs PostgreSQL.
const app = createApp();
const fake = new FakeSlrBe();
const redirectTarget = new FakeSlrBe();
const tag = `qa-acc-${Date.now()}`;
const alice = `${tag}-alice`;
const TOKEN = 'Bearer qa-SECRET-token-123';
let n = 0;
const id = () => `${tag}-slr-${n++}`;
const orig = { base: env.SLR_API_BASE_URL, timeout: env.SLR_API_TIMEOUT_MS, max: env.SLR_API_MAX_RESPONSE_BYTES };
const unhandled: unknown[] = [];
const onUnhandled = (r: unknown) => unhandled.push(r);
const create = (slrProjectId: string, user = alice, name = 'Review') =>
  request(app).post('/api/projects').set({ 'X-Dev-User-Id': user, Authorization: TOKEN }).send({ name, slrProjectId });
const rows = (slrProjectId: string) => prisma.project.count({ where: { slrProjectId } });
const path = (slrProjectId: string) => `/api/projects/${encodeURIComponent(slrProjectId)}`;
const noLeak = (body: unknown, extra: string[] = []) => {
  const text = JSON.stringify(body);
  for (const s of ['SECRET', fake.baseUrl, '127.0.0.1', 'qa-SECRET-token', 'upstream-detail', ...extra]) expect(text).not.toContain(s);
};

beforeAll(async () => {
  process.on('unhandledRejection', onUnhandled);
  await fake.start(); await redirectTarget.start();
  env.SLR_API_BASE_URL = fake.baseUrl; env.SLR_VERIFY_PROJECT_ACCESS = true;
});
afterAll(async () => {
  env.SLR_API_BASE_URL = orig.base; env.SLR_API_TIMEOUT_MS = orig.timeout; env.SLR_API_MAX_RESPONSE_BYTES = orig.max; env.SLR_VERIFY_PROJECT_ACCESS = false;
  await fake.stop(); await redirectTarget.stop();
  process.off('unhandledRejection', onUnhandled);
  expect(unhandled).toEqual([]);
  await prisma.$disconnect();
});
beforeEach(() => { fake.reset(); redirectTarget.reset(); });
afterEach(() => {
  env.SLR_VERIFY_PROJECT_ACCESS = true; env.SLR_API_TIMEOUT_MS = orig.timeout; env.SLR_API_MAX_RESPONSE_BYTES = orig.max;
  env.ALLOW_MANUAL_SNAPSHOT_IMPORT = true; env.DEV_AUTH_ENABLED = true;
});

describe('slr-be answers', () => {
  it.each([
    ['envelope with data', { success: true, data: { id: 'x' } }], ['empty object', {}], ['array', []], ['null', null], ['number', 5], ['string', 'ok'],
    ['envelope with null data', { success: true, data: null }],
  ])('200 with %s body is treated as access granted (status decides)', async (_k, body) => {
    const s = id(); fake.json(path(s), body);
    expect((await create(s)).status).toBe(201);
  });

  it('200 with {success:false} envelope fails closed (502) and stores nothing', async () => {
    const s = id(); fake.json(path(s), { success: false, message: 'upstream-detail' });
    const res = await create(s);
    expect([res.status, res.body.error.code]).toEqual([502, 'SLR_UPSTREAM_ERROR']);
    expect(await rows(s)).toBe(0); noLeak(res.body, [s]);
  });

  it.each([
    [204, '', 502, 'SLR_INVALID_RESPONSE'], [200, '<html>upstream-detail</html>', 502, 'SLR_INVALID_RESPONSE'], [200, '', 502, 'SLR_INVALID_RESPONSE'],
    [429, '{"message":"upstream-detail"}', 502, 'SLR_UPSTREAM_ERROR'], [500, 'upstream-detail', 502, 'SLR_UPSTREAM_ERROR'],
    [401, '{"message":"upstream-detail"}', 401, 'SLR_AUTH_REJECTED'], [418, '', 502, 'SLR_UPSTREAM_ERROR'],
  ])('status %i body %j -> %i %s, nothing stored, nothing leaked', async (status, body, want, code) => {
    const s = id(); fake.raw(path(s), body, status);
    const res = await create(s);
    expect([res.status, res.body.error.code]).toEqual([want, code]);
    expect(await rows(s)).toBe(0); noLeak(res.body, [s]);
  });

  it.each([301, 302, 307, 308])('a %i redirect is not followed (token never reaches the target) and fails closed', async (code) => {
    const s = id();
    redirectTarget.json(path(s), {});
    fake.on(path(s), (_req, res) => { res.statusCode = code; res.setHeader('location', `${redirectTarget.baseUrl}${path(s)}`); res.end(); });
    const res = await create(s);
    expect(res.status).toBe(502);
    expect(redirectTarget.requests).toHaveLength(0);
    expect(await rows(s)).toBe(0); noLeak(res.body, [redirectTarget.baseUrl]);
  });

  it('hang -> 504, connection reset -> 502, nothing stored', async () => {
    const a = id(); fake.hang(path(a)); env.SLR_API_TIMEOUT_MS = 300;
    const r1 = await create(a);
    expect([r1.status, r1.body.error.code]).toEqual([504, 'SLR_TIMEOUT']);
    const b = id(); fake.on(path(b), (req) => req.socket.destroy());
    const r2 = await create(b);
    expect([r2.status, r2.body.error.code]).toEqual([502, 'SLR_UNREACHABLE']);
    const c = id(); fake.on(path(c), (_req, res) => { res.statusCode = 200; res.write('{"success":tr'); setTimeout(() => res.socket?.destroy(), 20); });
    const r3 = await create(c);
    expect(r3.status).toBe(502);
    expect(await rows(a) + await rows(b) + await rows(c)).toBe(0);
  });

  it('a huge body is cut off at the size limit (502 SLR_RESPONSE_TOO_LARGE), with and without content-length', async () => {
    env.SLR_API_MAX_RESPONSE_BYTES = 1000;
    const a = id(); fake.raw(path(a), JSON.stringify({ pad: 'x'.repeat(5000) }));
    const r1 = await create(a);
    expect([r1.status, r1.body.error.code]).toEqual([502, 'SLR_RESPONSE_TOO_LARGE']);
    const b = id(); fake.on(path(b), (_req, res) => { res.statusCode = 200; res.write('{"pad":"'); res.write('x'.repeat(3000)); res.end('"}'); });
    const r2 = await create(b);
    expect([r2.status, r2.body.error.code]).toEqual([502, 'SLR_RESPONSE_TOO_LARGE']);
  });
});

describe('403 and 404 from slr-be are indistinguishable', () => {
  it('same status, body (except requestId) and headers (except date/etag/x-request-id)', async () => {
    const denied = `${tag}-same-a`; const missing = `${tag}-same-b`; // same length ids
    fake.on(path(denied), (_req, res) => { res.statusCode = 403; res.setHeader('x-upstream', 'forbidden'); res.end('{"message":"not a member"}'); });
    fake.on(path(missing), (_req, res) => { res.statusCode = 404; res.setHeader('x-upstream', 'missing'); res.end('{"message":"no such project"}'); });
    const a = await create(denied); const b = await create(missing);
    const strip = (body: any) => ({ ...body, error: { ...body.error, requestId: undefined } });
    expect(a.status).toBe(403);
    expect(strip(a.body)).toEqual(strip(b.body));
    const hdr = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).filter(([k]) => !['date', 'etag', 'x-request-id'].includes(k)));
    expect(hdr(a.headers)).toEqual(hdr(b.headers));
    expect(JSON.stringify(a.headers)).not.toContain('forbidden');
  });
});

describe('slrProjectId edge cases', () => {
  it.each([
    ['unicode', `${tag}-ユニコード-🙂`], ['%2e%2e', `${tag}%2e%2e`], ['only %2e%2e', '%2e%2e'], ['slash and dots', '../..'], ['backslash', '..\\..'],
    ['at length 200', `${tag}-`.padEnd(200, 'z')], ['padded', `  ${tag}-pad  `],
  ])('%s stays in one path segment', async (_k, raw) => {
    const s = raw.trim();
    fake.json(path(s), {});
    const res = await create(raw);
    expect(res.status).toBe(201);
    expect(fake.requests[0].url).toBe(path(s));
    expect(res.body.data.slrProjectId).toBe(s);
  });

  it.each([['whitespace only', '   \t '], ['dots after trim', ' .. '], ['201 chars', 'a'.repeat(201)], ['number', 5], ['null', null]])('%s -> 400 without asking slr-be', async (_k, raw) => {
    const res = await request(app).post('/api/projects').set({ 'X-Dev-User-Id': alice, Authorization: TOKEN }).send({ name: 'x', slrProjectId: raw });
    expect(res.status).toBe(400);
    expect(fake.requests).toHaveLength(0);
  });

  it('a NUL byte in slrProjectId should be a 400, not a 500, and leave no row', async () => {
    const s = `${tag}-nul\u0000x`;
    fake.json(path(s), {});
    const res = await create(s);
    expect(res.status).toBe(400);
    expect(await prisma.project.count({ where: { ownerId: alice, slrProjectId: { startsWith: `${tag}-nul` } } })).toBe(0);
  });

  it('a NUL byte in name should be a 400, not a 500', async () => {
    const s = id(); fake.json(path(s), {});
    const res = await create(s, alice, 'bad\u0000name');
    expect(res.status).toBe(400);
    expect(await rows(s)).toBe(0);
  });

});

describe('concurrency', () => {
  it('two simultaneous creates of the same slrProjectId by the same user: one 201, one 409, one row, one provenance event', async () => {
    const s = id();
    fake.on(path(s), (_req, res) => setTimeout(() => { res.statusCode = 200; res.end('{}'); }, 30));
    const results = await Promise.all([create(s), create(s), create(s), create(s)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('PROJECT_EXISTS');
    expect(await rows(s)).toBe(1);
    const project = await prisma.project.findFirst({ where: { slrProjectId: s } });
    expect(await prisma.provenanceEvent.count({ where: { projectId: project!.id } })).toBe(1);
  });

  it('two different users may link the same SLR project at the same time', async () => {
    const s = id(); fake.json(path(s), {});
    const [a, b] = await Promise.all([create(s, `${tag}-u1`), create(s, `${tag}-u2`)]);
    expect([a.status, b.status]).toEqual([201, 201]);
  });

  it('the Authorization header is sent exactly once per create and unchanged', async () => {
    const s = id(); fake.json(path(s), {});
    await create(s);
    expect(fake.requests).toEqual([{ method: 'GET', url: path(s), authorization: TOKEN }]);
  });
});

describe('manual import switch', () => {
  async function project(user = alice) {
    const s = id(); fake.json(path(s), {});
    const created = await create(s, user);
    const run = buildSyntheticRun() as any; run.run.project_id = s; run.corpus.project_id = s;
    return { pid: created.body.data.id as string, run };
  }
  const as = (u: string) => ({ 'X-Dev-User-Id': u });

  it('order: unauthenticated 401, non-owner 404, unknown project 404, owner 403', async () => {
    const { pid, run } = await project();
    env.ALLOW_MANUAL_SNAPSHOT_IMPORT = false;
    env.DEV_AUTH_ENABLED = false;
    expect((await request(app).post(`/api/projects/${pid}/snapshots`).send(run)).status).toBe(401);
    env.DEV_AUTH_ENABLED = true;
    expect((await request(app).post(`/api/projects/${pid}/snapshots`).set(as(`${tag}-mallory`)).send(run)).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect((await request(app).post(`/api/projects/00000000-0000-0000-0000-000000000000/snapshots`).set(as(alice)).send(run)).status).toBe(404);
    const owner = await request(app).post(`/api/projects/${pid}/snapshots`).set(as(alice)).send(run);
    expect([owner.status, owner.body.error.code]).toEqual([403, 'MANUAL_IMPORT_DISABLED']);
  });

  it.each([
    ['trailing slash', (p: string) => `/api/projects/${p}/snapshots/`], ['upper case', (p: string) => `/api/projects/${p}/SNAPSHOTS`],
    ['double slash', (p: string) => `/api/projects/${p}//snapshots`], ['query', (p: string) => `/api/projects/${p}/snapshots?x=1`],
  ])('%s path variant cannot import when off', async (_k, url) => {
    const { pid, run } = await project();
    env.ALLOW_MANUAL_SNAPSHOT_IMPORT = false;
    const res = await request(app).post(url(pid)).set(as(alice)).send(run);
    expect([200, 201]).not.toContain(res.status);
    expect(await prisma.reviewSnapshot.count({ where: { projectId: pid } })).toBe(0);
  });

  it.each(['put', 'patch', 'delete'] as const)('%s on /snapshots does not import', async (verb) => {
    const { pid, run } = await project();
    env.ALLOW_MANUAL_SNAPSHOT_IMPORT = false;
    const res = await (request(app) as any)[verb](`/api/projects/${pid}/snapshots`).set(as(alice)).send(run);
    expect(res.status).toBe(404);
    expect(await prisma.reviewSnapshot.count({ where: { projectId: pid } })).toBe(0);
  });

  it('/validate stores nothing (no snapshot, no provenance) and from-slr ignores a posted run body', async () => {
    const { pid, run } = await project();
    env.ALLOW_MANUAL_SNAPSHOT_IMPORT = false;
    const before = await prisma.provenanceEvent.count({ where: { projectId: pid } });
    expect((await request(app).post(`/api/projects/${pid}/snapshots/validate`).set(as(alice)).send(run)).status).toBe(200);
    const fs = await request(app).post(`/api/projects/${pid}/snapshots/from-slr`).set(as(alice)).send({ ...run, runId: run.run.run_id });
    expect(fs.status).not.toBe(201); // slr-be fake has no run route -> 404 SLR_NOT_FOUND; posted run must not be used
    expect(await prisma.reviewSnapshot.count({ where: { projectId: pid } })).toBe(0);
    expect(await prisma.provenanceEvent.count({ where: { projectId: pid } })).toBe(before);
  });
});

describe('OpenAPI documents the new codes', () => {
  const op = (p: string, m: 'post' | 'get') => (openApiDocument.paths[p] as any)[m];
  it('POST /api/projects lists 403 (SLR_PROJECT_ACCESS_DENIED) and upstream failures 502/504', () => {
    const r = op('/api/projects', 'post').responses;
    expect(Object.keys(r)).toEqual(expect.arrayContaining(['403', '502', '504']));
    expect(JSON.stringify(r)).toContain('SLR_PROJECT_ACCESS_DENIED');
  });
  it('POST /snapshots lists 403 MANUAL_IMPORT_DISABLED', () => {
    expect(JSON.stringify(op('/api/projects/{projectId}/snapshots', 'post').responses)).toContain('MANUAL_IMPORT_DISABLED');
  });
  it('POST /from-slr has a 429 response entry', () => {
    expect(op('/api/projects/{projectId}/snapshots/from-slr', 'post').responses['429']).toBeDefined();
  });
});
