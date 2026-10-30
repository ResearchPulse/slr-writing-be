import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SlrClient, isValidRunId } from '../../src/modules/slr-client/slr-client.js';
import { buildSyntheticRun } from '../fixtures/synthetic-run.js';
import { FakeSlrBe } from '../slr-client/fake-slr-be.js';

const fake = new FakeSlrBe();
const PROJECT = 'slr-project-1';
const RUN = 'run-20260101000000-abc123';
const RUN_PATH = `/api/projects/${PROJECT}/synthesis/artifacts/runs/${RUN}`;
const auth = { authorization: 'Bearer user-token' };
const client = (over: { timeoutMs?: number } = {}) => new SlrClient({ baseUrl: fake.baseUrl, timeoutMs: 3000, ...over });
const fetchRun = (c = client(), runId = RUN, ctx: { authorization?: string } = auth, project = PROJECT) => c.fetchRun(project, runId, ctx);
const code = async (p: Promise<unknown>) => p.then(() => 'no error', (e) => `${e.statusCode}:${e.code}`);

const unhandled: unknown[] = [];
const onUnhandled = (r: unknown) => unhandled.push(r);

beforeAll(async () => { process.on('unhandledRejection', onUnhandled); await fake.start(); });
afterAll(async () => { process.off('unhandledRejection', onUnhandled); await fake.stop(); });
beforeEach(() => fake.reset());

/** Raw server for socket-level misbehaviour. */
async function rawServer(handler: Parameters<typeof createServer>[1]) {
  const server: Server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

describe('QA: runId validation (path injection)', () => {
  it.each([
    '%2e%2e', '..', '.', 'run-1/../x', 'run%2F1', 'run-1?x=1', 'run-1#f', 'run\u0000x', 'run-1\n', 'run-1\r\n', ' run-1',
    'rün-1', 'run-１', '\u202erun', 'x'.repeat(129), 'run-1;x', 'run-1\\x', '_lead',
  ])('rejects %j without calling slr-be', async (runId) => {
    expect(isValidRunId(runId)).toBe(false);
    expect(await code(fetchRun(client(), runId))).toBe('400:INVALID_RUN_ID');
    expect(fake.requests).toHaveLength(0);
  });

  it('accepts a 128-char run id', () => expect(isValidRunId('a'.repeat(128))).toBe(true));
});

describe('QA: slrProjectId encoding', () => {
  it.each(['a?b=1', 'a#b', 'a%2e%2e', '%2e%2e', 'p\u0000x', 'ü-项目', 'a/../../x', 'x'.repeat(300)])('keeps %j inside one path segment', async (pid) => {
    fake.serveRun(encodeURIComponent(pid), buildSyntheticRun());
    await fetchRun(client(), RUN, auth, pid).catch(() => undefined);
    expect(fake.requests.length).toBeGreaterThan(0);
    for (const r of fake.requests) expect(r.url.startsWith(`/api/projects/${encodeURIComponent(pid)}/synthesis/artifacts/runs/${RUN}`)).toBe(true);
  });

  it.each(['..', '.', '...'])('dot-segment slrProjectId %j is rejected before any request is made', async (pid) => {
    expect(await code(fetchRun(client(), RUN, auth, pid))).toBe('400:INVALID_SLR_PROJECT_ID');
    expect(fake.requests).toHaveLength(0);
  });
});

describe('QA: token handling', () => {
  it('rejects CR/LF in the Authorization value without injecting headers', async () => {
    let seen: IncomingHttpHeaders | undefined;
    fake.on(RUN_PATH, (req, res) => { seen = req.headers; res.statusCode = 500; res.end('{}'); });
    const result = await code(fetchRun(client(), RUN, { authorization: 'Bearer a\r\nX-Injected: 1' }));
    expect(result).toMatch(/^5\d\d:|^4\d\d:/);
    expect(seen?.['x-injected']).toBeUndefined();
  });

  it('non-latin1 Authorization does not crash (clean error)', async () => {
    fake.serveRun(PROJECT, buildSyntheticRun());
    const result = await code(fetchRun(client(), RUN, { authorization: 'Bearer 令牌' }));
    expect(result).not.toBe('no error');
    expect(result).toMatch(/^\d{3}:SLR_/);
  });

  it('forwards non-Bearer schemes verbatim and only Authorization/Accept (no cookies, dev ids)', async () => {
    const headers: IncomingHttpHeaders[] = [];
    const input = buildSyntheticRun();
    const base = fake.serveRun(PROJECT, input);
    fake.on(base, (req, res) => { headers.push(req.headers); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(input.run)); });
    await fetchRun(client(), RUN, { authorization: 'Basic dXNlcjpwYXNz' });
    expect(headers[0].authorization).toBe('Basic dXNlcjpwYXNz');
    expect(headers[0].cookie).toBeUndefined();
    expect(headers[0]['x-dev-user-id']).toBeUndefined();
  });

  it('empty string authorization sends no header', async () => {
    fake.serveRun(PROJECT, buildSyntheticRun());
    await fetchRun(client(), RUN, { authorization: '' });
    expect(fake.requests.every((r) => r.authorization === undefined)).toBe(true);
  });

  it.each([301, 302, 303, 307, 308])('never follows a %i redirect for any of the calls (token stays home)', async (status) => {
    const other = new FakeSlrBe();
    await other.start();
    try {
      const input = buildSyntheticRun();
      const base = fake.serveRun(PROJECT, input);
      fake.on(`${base}/artifacts/A7`, (_q, res) => { res.statusCode = status; res.setHeader('location', `${other.baseUrl}/steal`); res.end(); });
      expect(await code(fetchRun())).toBe('502:SLR_UNREACHABLE');
      expect(other.requests).toHaveLength(0);
    } finally { await other.stop(); }
  });
});

describe('QA: upstream failure modes', () => {
  it.each([400, 405, 409, 410, 429, 500, 501, 502, 503, 504, 599])('status %i -> 502 SLR_UPSTREAM_ERROR', async (s) => {
    fake.json(RUN_PATH, { message: 'secret' }, s);
    expect(await code(fetchRun())).toBe('502:SLR_UPSTREAM_ERROR');
  });

  it.each([401, 403, 404])('status %i on an artifact (not the run) still maps cleanly', async (s) => {
    const base = fake.serveRun(PROJECT, buildSyntheticRun());
    fake.json(`${base}/artifacts/A10`, {}, s);
    expect(await code(fetchRun())).toMatch(new RegExp(`^${s}:SLR_`));
  });

  it('204 No Content -> SLR_INVALID_RESPONSE', async () => {
    fake.on(RUN_PATH, (_q, res) => { res.statusCode = 204; res.end(); });
    expect(await code(fetchRun())).toBe('502:SLR_INVALID_RESPONSE');
  });

  it.each([
    ['html', '<!doctype html><html><body>Login</body></html>'],
    ['truncated json', '{"success":true,"data":{"run_id":"run-2026'],
    ['whitespace', '   '],
    ['bom + garbage', '\ufeff{x}'],
  ])('%s body -> SLR_INVALID_RESPONSE', async (_n, body) => {
    fake.raw(RUN_PATH, body);
    expect(await code(fetchRun())).toBe('502:SLR_INVALID_RESPONSE');
  });

  it.each([
    ['data null', { success: true, data: null }],
    ['data array', { success: true, data: [] }],
    ['data string', { success: true, data: 'x' }],
    ['data number', { success: true, data: 1 }],
    ['top-level null', null],
    ['top-level array', []],
    ['top-level string', 'run'],
    ['success true no data', { success: true }],
    ['wrong types', { success: true, data: { ...buildSyntheticRun().run, run_id: 123 } }],
    ['missing artifacts', { success: true, data: { ...buildSyntheticRun().run, artifacts: undefined } }],
    ['unknown artifact type', { success: true, data: { ...buildSyntheticRun().run, artifacts: [{ ...buildSyntheticRun().run.artifacts[0], artifact_type: 'A99' }] } }],
  ])('run envelope %s -> 502 SLR_INVALID_RESPONSE', async (_n, body) => {
    fake.json(RUN_PATH, body);
    expect(await code(fetchRun())).toBe('502:SLR_INVALID_RESPONSE');
  });

  it.each([
    ['success:false', { success: false, data: buildSyntheticRun().run }],
    ['isSuccess:false + success:false', { success: false, isSuccess: false, message: 'x' }],
  ])('%s -> SLR_UPSTREAM_ERROR', async (_n, body) => {
    fake.json(RUN_PATH, body);
    expect(await code(fetchRun())).toBe('502:SLR_UPSTREAM_ERROR');
  });

  it('extra unknown fields are tolerated', async () => {
    const input = buildSyntheticRun() as any;
    input.run.zzz = { nested: [1, 2] };
    input.corpus.unknown_new_field = 'x';
    fake.serveRun(PROJECT, input, (d) => ({ success: true, data: d, extra: 1, meta: { page: 1 } }));
    expect((await fetchRun()).run.run_id).toBe(RUN);
  });

  it('wrong content-type with valid JSON is accepted (lenient)', async () => {
    const input = buildSyntheticRun();
    const base = fake.serveRun(PROJECT, input);
    fake.on(base, (_q, res) => { res.setHeader('content-type', 'text/html'); res.end(JSON.stringify(input.run)); });
    expect((await fetchRun()).run.run_id).toBe(RUN);
  });

  it('connection reset before headers -> 502 SLR_UNREACHABLE', async () => {
    const s = await rawServer((req) => { req.socket.destroy(); });
    try {
      expect(await code(new SlrClient({ baseUrl: s.url, timeoutMs: 3000 }).fetchRun(PROJECT, RUN, auth))).toBe('502:SLR_UNREACHABLE');
    } finally { await s.close(); }
  });

  it('connection reset mid-body -> 502', async () => {
    const s = await rawServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '10000' });
      res.write('{"success":true,"data":{');
      setTimeout(() => res.socket?.destroy(), 30);
    });
    try {
      expect(await code(new SlrClient({ baseUrl: s.url, timeoutMs: 3000 }).fetchRun(PROJECT, RUN, auth))).toMatch(/^502:/);
    } finally { await s.close(); }
  });

  it('slow body after headers is cut by the timeout and reported as a timeout (504)', async () => {
    const s = await rawServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"success":true,');
      const t = setInterval(() => res.write(' '), 50);
      res.on('close', () => clearInterval(t));
    });
    try {
      const started = Date.now();
      const result = await code(new SlrClient({ baseUrl: s.url, timeoutMs: 300 }).fetchRun(PROJECT, RUN, auth));
      expect(Date.now() - started).toBeLessThan(2500);
      expect(result).toBe('504:SLR_TIMEOUT');
    } finally { await s.close(); }
  });

  it('hang on the corpus fires the timeout', async () => {
    const base = fake.serveRun(PROJECT, buildSyntheticRun());
    fake.hang(`${base}/artifacts/corpus`);
    const started = Date.now();
    expect(await code(fetchRun(client({ timeoutMs: 200 })))).toBe('504:SLR_TIMEOUT');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('hang on one artifact fires the timeout', async () => {
    const base = fake.serveRun(PROJECT, buildSyntheticRun());
    fake.hang(`${base}/artifacts/A2`);
    expect(await code(fetchRun(client({ timeoutMs: 200 })))).toBe('504:SLR_TIMEOUT');
  });

  it('refuses an oversized upstream body (resource limit)', async () => {
    const input = buildSyntheticRun() as any;
    const base = fake.serveRun(PROJECT, input);
    let sent = 0;
    const pad = 'x'.repeat(1024 * 1024);
    fake.on(base, (_q, res) => {
      res.setHeader('content-type', 'application/json');
      const head = JSON.stringify({ success: true, data: input.run }).slice(0, -2);
      res.write(`${head},"pad":"`);
      for (let i = 0; i < 64; i += 1) { res.write(pad); sent += pad.length; }
      res.end('"}}');
    });
    const result = await code(fetchRun(client({ timeoutMs: 20_000 })));
    // 64 MiB of padding: expected the client to cap bodies and fail, rather than buffer and parse it all.
    expect(result).not.toBe('no error');
    expect(sent).toBeGreaterThan(0);
  }, 40_000);
});

describe('QA: consistency', () => {
  it('artifact listed in the run but fetched payload is another run\'s artifact (artifact_id mismatch) is rejected', async () => {
    const input = buildSyntheticRun() as any;
    const other = buildSyntheticRun('run-20250101000000-zzz999') as any;
    const base = fake.serveRun(PROJECT, input);
    fake.json(`${base}/artifacts/A1`, { success: true, data: other.artifacts.A1 });
    expect(await code(fetchRun())).toBe('502:SLR_INVALID_RESPONSE');
  });

  it('duplicate artifact types in the run are fetched once', async () => {
    const input = buildSyntheticRun() as any;
    input.run.artifacts.push({ ...input.run.artifacts[0] });
    fake.serveRun(PROJECT, input);
    await fetchRun();
    expect(fake.requests.filter((r) => r.url.endsWith('/artifacts/A1'))).toHaveLength(1);
  });

  it('run with no MVP artifacts fetches only run + corpus', async () => {
    const input = buildSyntheticRun() as any;
    input.run.artifacts = [];
    fake.serveRun(PROJECT, input);
    const r = await fetchRun();
    expect(r.artifacts).toEqual({});
    expect(fake.requests).toHaveLength(2);
  });

  it('artifact payload with a mismatching artifact_type is rejected', async () => {
    const input = buildSyntheticRun() as any;
    const base = fake.serveRun(PROJECT, input);
    fake.json(`${base}/artifacts/A10`, { success: true, data: { ...input.artifacts.A10, artifact_type: 'A3' } });
    expect(await code(fetchRun())).toBe('502:SLR_INVALID_RESPONSE');
  });

  it('run_id differing only by case is rejected', async () => {
    const input = buildSyntheticRun() as any;
    const base = fake.serveRun(PROJECT, input);
    fake.json(base, { success: true, data: { ...input.run, run_id: RUN.toUpperCase() } });
    expect(await code(fetchRun())).toBe('502:SLR_INVALID_RESPONSE');
  });
});

describe('QA: resources', () => {
  it('all four artifacts failing at once (mixed statuses / resets) yields one clean error and no unhandled rejection', async () => {
    const base = fake.serveRun(PROJECT, buildSyntheticRun());
    fake.json(`${base}/artifacts/A1`, {}, 500);
    fake.json(`${base}/artifacts/A2`, {}, 404);
    fake.on(`${base}/artifacts/A7`, (req) => req.socket.destroy());
    fake.raw(`${base}/artifacts/A10`, '<html>');
    expect(await code(fetchRun())).toMatch(/^(502|404):SLR_/);
    await new Promise((r) => setTimeout(r, 200));
    expect(unhandled).toEqual([]);
  });

  it('error messages never contain the base URL, host, or upstream body', async () => {
    const msgs: string[] = [];
    fake.json(RUN_PATH, { message: 'SECRET-UPSTREAM-BODY at /internal/path' }, 500);
    msgs.push((await fetchRun().catch((e) => e)).message);
    fake.raw(RUN_PATH, 'SECRET-UPSTREAM-BODY');
    msgs.push((await fetchRun().catch((e) => e)).message);
    const dead = new SlrClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 2000 });
    msgs.push((await dead.fetchRun(PROJECT, RUN, auth).catch((e) => e)).message);
    for (const m of msgs) {
      expect(m).not.toContain('SECRET');
      expect(m).not.toContain('127.0.0.1');
      expect(m).not.toContain('ECONNREFUSED');
    }
  });

  it('no unhandled rejections overall', () => expect(unhandled).toEqual([]));
});
