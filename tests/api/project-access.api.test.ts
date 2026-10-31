import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/config/prisma.js';
import { FakeSlrBe } from '../slr-client/fake-slr-be.js';

// Integration test: needs PostgreSQL. Creating a project must first prove, with the caller's own token, that
// the caller can read the SLR project on slr-be.
const app = createApp();
const fake = new FakeSlrBe();
const tag = `access-${Date.now()}`;
let counter = 0;
const originalBase = env.SLR_API_BASE_URL;
const originalTimeout = env.SLR_API_TIMEOUT_MS;
const slrId = () => `${tag}-slr-${counter++}`;
const create = (slrProjectId: string, headers: Record<string, string> = { Authorization: 'Bearer user-token' }) =>
  request(app).post('/api/projects').set({ 'X-Dev-User-Id': `${tag}-alice`, ...headers }).send({ name: 'Review', slrProjectId });
const stored = (slrProjectId: string) => prisma.project.count({ where: { slrProjectId } });

beforeAll(async () => { await fake.start(); env.SLR_API_BASE_URL = fake.baseUrl; env.SLR_VERIFY_PROJECT_ACCESS = true; });
afterAll(async () => {
  env.SLR_API_BASE_URL = originalBase; env.SLR_API_TIMEOUT_MS = originalTimeout; env.SLR_VERIFY_PROJECT_ACCESS = false;
  await fake.stop(); await prisma.$disconnect();
});
beforeEach(() => fake.reset());
afterEach(() => { env.SLR_VERIFY_PROJECT_ACCESS = true; env.SLR_API_TIMEOUT_MS = originalTimeout; });

describe('creating a project checks access on slr-be', () => {
  it('creates the project when slr-be lets the caller read the SLR project, forwarding the caller token', async () => {
    const id = slrId();
    fake.json(`/api/projects/${id}`, { success: true, data: { id, role: 1, roleText: 'OWNER' } });
    const res = await create(id);
    expect(res.status).toBe(201);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ method: 'GET', url: `/api/projects/${id}`, authorization: 'Bearer user-token' });
  });

  it('refuses with 403 SLR_PROJECT_ACCESS_DENIED when slr-be says forbidden, and stores nothing', async () => {
    const id = slrId();
    fake.json(`/api/projects/${id}`, { message: 'You are not a member of this project' }, 403);
    const res = await create(id);
    expect([res.status, res.body.error.code]).toEqual([403, 'SLR_PROJECT_ACCESS_DENIED']);
    expect(await stored(id)).toBe(0);
  });

  it('answers a project that does not exist exactly like one the caller cannot see (no probing)', async () => {
    const denied = slrId(); const missing = slrId();
    fake.json(`/api/projects/${denied}`, {}, 403);
    fake.json(`/api/projects/${missing}`, {}, 404);
    const a = await create(denied); const b = await create(missing);
    expect([a.status, a.body.error.code, a.body.error.message]).toEqual([b.status, b.body.error.code, b.body.error.message]);
    expect(a.status).toBe(403);
  });

  it('passes on a rejected token as 401 SLR_AUTH_REJECTED and stores nothing', async () => {
    const id = slrId();
    fake.json(`/api/projects/${id}`, {}, 401);
    const res = await create(id);
    expect([res.status, res.body.error.code]).toEqual([401, 'SLR_AUTH_REJECTED']);
    expect(await stored(id)).toBe(0);
  });

  it.each([[500, 502, 'SLR_UPSTREAM_ERROR'], [503, 502, 'SLR_UPSTREAM_ERROR']])('fails closed when slr-be answers %i', async (upstream, status, code) => {
    const id = slrId();
    fake.json(`/api/projects/${id}`, {}, upstream);
    const res = await create(id);
    expect([res.status, res.body.error.code]).toEqual([status, code]);
    expect(await stored(id)).toBe(0);
  });

  it('fails closed when slr-be is slow (504) or unreachable (502)', async () => {
    const slow = slrId();
    fake.hang(`/api/projects/${slow}`);
    env.SLR_API_TIMEOUT_MS = 200;
    const a = await create(slow);
    expect([a.status, a.body.error.code]).toEqual([504, 'SLR_TIMEOUT']);
    expect(await stored(slow)).toBe(0);

    env.SLR_API_BASE_URL = 'http://127.0.0.1:1';
    try {
      const unreachable = slrId();
      const b = await create(unreachable);
      expect([b.status, b.body.error.code]).toEqual([502, 'SLR_UNREACHABLE']);
      expect(await stored(unreachable)).toBe(0);
    } finally { env.SLR_API_BASE_URL = fake.baseUrl; }
  });

  it('asks slr-be before it looks at duplicates, so a stranger cannot learn that someone linked a project', async () => {
    const id = slrId();
    fake.json(`/api/projects/${id}`, {});
    expect((await create(id)).status).toBe(201);
    fake.json(`/api/projects/${id}`, {}, 403);
    const again = await create(id);
    expect([again.status, again.body.error.code]).toEqual([403, 'SLR_PROJECT_ACCESS_DENIED']);
  });

  it('still reports a duplicate (409) to someone who does have access', async () => {
    const id = slrId();
    fake.json(`/api/projects/${id}`, {});
    expect((await create(id)).status).toBe(201);
    const again = await create(id);
    expect([again.status, again.body.error.code]).toEqual([409, 'PROJECT_EXISTS']);
  });

  it('does not call slr-be for an invalid id (dot segments, empty, too long)', async () => {
    for (const bad of ['.', '..', '', 'x'.repeat(201)]) {
      const res = await create(bad);
      expect(res.status).toBe(400);
    }
    expect(fake.requests).toHaveLength(0);
  });

  it('keeps odd ids inside one path segment when asking slr-be', async () => {
    const odd = `${tag}-a?b#c/d%2e%2e`;
    fake.json(`/api/projects/${encodeURIComponent(odd)}`, {});
    const res = await create(odd);
    expect(res.status).toBe(201);
    expect(fake.requests[0].url).toBe(`/api/projects/${encodeURIComponent(odd)}`);
  });

  it('sends no Authorization header when the caller has none, and lets slr-be decide', async () => {
    const id = slrId();
    fake.json(`/api/projects/${id}`, {}, 401);
    const res = await create(id, {});
    expect(res.status).toBe(401);
    expect(fake.requests[0].authorization).toBeUndefined();
  });

  it('never leaks the slr-be body, url or host in an error', async () => {
    const id = slrId();
    fake.json(`/api/projects/${id}`, { message: 'secret internal detail' }, 500);
    const text = JSON.stringify((await create(id)).body);
    expect(text).not.toContain('secret');
    expect(text).not.toContain(fake.baseUrl);
    expect(text).not.toContain(id);
  });

  it('skips the check when it is switched off', async () => {
    env.SLR_VERIFY_PROJECT_ACCESS = false;
    const id = slrId();
    const res = await create(id);
    expect(res.status).toBe(201);
    expect(fake.requests).toHaveLength(0);
  });
});
