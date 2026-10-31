import { createSign, generateKeyPairSync } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/config/prisma.js';
import { errorHandler } from '../../src/middleware/error.middleware.js';
import { requireAuth, setTokenVerifier, type TokenVerifier } from '../../src/middleware/auth.middleware.js';
import { createFirebaseVerifier, type VerifyIdToken } from '../../src/modules/auth/firebase-verifier.js';
import { FakeSlrBe } from '../slr-client/fake-slr-be.js';

// QA for token handling (M1). Needs PostgreSQL for the ownerId tests.
const PROJECT = 'qa-fb-project';
const tag = `qa-auth-${Date.now()}`;
let n = 0;
const unhandled: unknown[] = [];
const onUnhandled = (r: unknown) => unhandled.push(r);

// A tiny app that shows who requireAuth decided the caller is.
const me = express();
me.get('/me', requireAuth, (req: any, res) => res.json({ user: req.user }));
me.use(errorHandler);

const app = createApp();
const seen: string[] = [];
const recording = (result: (t: string) => any): TokenVerifier => async (t) => { seen.push(t); return result(t); };

beforeAll(() => process.on('unhandledRejection', onUnhandled));
afterEach(() => { setTokenVerifier(null); env.DEV_AUTH_ENABLED = true; env.NODE_ENV = 'test'; env.SLR_VERIFY_PROJECT_ACCESS = false; seen.length = 0; });
afterAll(async () => { process.off('unhandledRejection', onUnhandled); expect(unhandled).toEqual([]); await prisma.$disconnect(); });

describe('Authorization header parsing with a verifier, dev auth off', () => {
  const setup = () => { env.DEV_AUTH_ENABLED = false; setTokenVerifier(recording((t) => ({ uid: `u:${t}` }))); };

  it.each([
    ['Bearer abc', 200, 'abc'], ['bearer abc', 200, 'abc'], ['BEARER abc', 200, 'abc'], ['BeArEr abc', 200, 'abc'],
  ])('%j -> %i', async (h, status, token) => {
    setup();
    const res = await request(me).get('/me').set('Authorization', h);
    expect(res.status).toBe(status);
    expect(seen).toEqual([token]);
  });

  it('double space after Bearer passes the token with a leading space to the verifier (verifier decides)', async () => {
    setup();
    const res = await request(me).get('/me').set('Authorization', 'Bearer  abc');
    expect(res.status).toBe(200);
    expect(seen).toEqual([' abc']);
  });

  it.each(['', 'Bearer', 'Bearer ', 'Basic dXNlcjpwYXNz', 'Token abc', 'Bearerabc', 'abc', 'Bearer\tabc'])('%j is not a bearer token -> 401 UNAUTHORIZED, verifier not called', async (h) => {
    setup();
    const res = await request(me).get('/me').set('Authorization', h);
    expect([res.status, res.body.error.code]).toEqual([401, 'UNAUTHORIZED']);
    expect(seen).toEqual([]);
  });

  it('very long token (12 KB) reaches the verifier intact; > 16 KB is refused by Node with 431', async () => {
    setup();
    const long = 'x'.repeat(12_000);
    expect((await request(me).get('/me').set('Authorization', `Bearer ${long}`)).status).toBe(200);
    expect(seen[0]).toBe(long);
    const tooLong = await request(me).get('/me').set('Authorization', `Bearer ${'x'.repeat(20_000)}`);
    expect(tooLong.status).toBe(431);
  });

  it('the dev header is ignored when dev auth is off, with or without a token', async () => {
    setup();
    expect((await request(me).get('/me').set('X-Dev-User-Id', 'victim')).status).toBe(401);
    const res = await request(me).get('/me').set('X-Dev-User-Id', 'victim').set('Authorization', 'Bearer t');
    expect(res.body.user.uid).toBe('u:t');
  });

  it('dev auth is off when NODE_ENV is production even if DEV_AUTH_ENABLED is true', async () => {
    env.DEV_AUTH_ENABLED = true; env.NODE_ENV = 'production';
    const res = await request(me).get('/me').set('X-Dev-User-Id', 'victim');
    expect(res.status).toBe(401);
  });
});

describe('dev auth with a verifier present', () => {
  it('a bad bearer token is rejected and never falls back to the dev header', async () => {
    setTokenVerifier(async () => null);
    const res = await request(me).get('/me').set('Authorization', 'Bearer bad').set('X-Dev-User-Id', 'victim');
    expect([res.status, res.body.error.code]).toEqual([401, 'INVALID_TOKEN']);
  });

  it('observes: without a bearer token the dev header is used (dev only)', async () => {
    setTokenVerifier(async () => ({ uid: 'real' }));
    const res = await request(me).get('/me').set('Authorization', 'Basic x').set('X-Dev-User-Id', ' victim ');
    expect(res.body.user.uid).toBe('victim');
  });
});

describe('verifier misbehaviour', () => {
  it('a TokenVerifier that throws gives 500 without leaking its message', async () => {
    env.DEV_AUTH_ENABLED = false;
    setTokenVerifier(async () => { throw new Error('SECRET-key-material'); });
    const res = await request(me).get('/me').set('Authorization', 'Bearer t');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
  });

  it('createFirebaseVerifier converts a synchronous throw into null', async () => {
    const v = createFirebaseVerifier({ projectId: PROJECT, verify: (() => { throw new Error('boom'); }) as unknown as VerifyIdToken });
    expect(await v('t')).toBeNull();
  });

  it('extra fields from the library are dropped (only uid/email)', async () => {
    const v = createFirebaseVerifier({ projectId: PROJECT, verify: async () => ({ uid: 'u', aud: PROJECT, email: 'a@b.c', admin: true, role: 'OWNER' } as any) });
    expect(await v('t')).toEqual({ uid: 'u', email: 'a@b.c' });
  });

  it.each([['number', 42], ['object', { toString: 'x' }], ['array', ['a@b.c']], ['true', true]])('a non-string email (%s) should be dropped', async (_k, email) => {
    const v = createFirebaseVerifier({ projectId: PROJECT, verify: async () => ({ uid: 'u', aud: PROJECT, email } as any) });
    const user = await v('t');
    expect(user).not.toBeNull();
    expect(user!.email === undefined || typeof user!.email === 'string').toBe(true);
  });

  it('a decoded token without aud should be rejected (the code says a replaced verifier must not widen access)', async () => {
    const v = createFirebaseVerifier({ projectId: PROJECT, verify: async () => ({ uid: 'u' }) });
    expect(await v('t')).toBeNull();
  });

  it.each([['array aud', [PROJECT]], ['padded aud', ` ${PROJECT}`], ['case aud', PROJECT.toUpperCase()]])('rejects %s', async (_k, aud) => {
    const v = createFirebaseVerifier({ projectId: PROJECT, verify: async () => ({ uid: 'u', aud } as any) });
    expect(await v('t')).toBeNull();
  });

  it.each([['null string', 'null'], ['__proto__', '__proto__'], ['constructor', 'constructor'], ['unicode', 'ユーザー🙂'], ['long', 'u'.repeat(5000)]])('uid %s is taken literally', async (_k, uid) => {
    const v = createFirebaseVerifier({ projectId: PROJECT, verify: async () => ({ uid, aud: PROJECT }) });
    expect(await v('t')).toEqual({ uid });
  });

  it('observes: a whitespace-only uid is accepted as is (Firebase never issues one)', async () => {
    const v = createFirebaseVerifier({ projectId: PROJECT, verify: async () => ({ uid: '   ', aud: PROJECT }) });
    expect(await v('t')).toEqual({ uid: '   ' });
  });

  it('observes: a hanging verifier hangs the request (no timeout in the middleware)', async () => {
    env.DEV_AUTH_ENABLED = false;
    setTokenVerifier(createFirebaseVerifier({ projectId: PROJECT, verify: () => new Promise(() => {}) }));
    const err = await request(me).get('/me').set('Authorization', 'Bearer t').timeout(1500).then(() => null, (e) => e);
    expect(err?.timeout ?? err?.code).toBeTruthy();
  });
});

describe('a user cannot become another user (ownerId = verified uid)', () => {
  it.each(['__proto__', 'null', 'ユーザー🙂', 'u'.repeat(300)])('creating as uid %j stores exactly that owner and ignores body/dev header', async (uid) => {
    setTokenVerifier(createFirebaseVerifier({ projectId: PROJECT, verify: async () => ({ uid, aud: PROJECT }) }));
    const res = await request(app).post('/api/projects').set('Authorization', 'Bearer t').set('X-Dev-User-Id', 'victim')
      .send({ name: 'x', slrProjectId: `${tag}-${n++}`, ownerId: 'victim', owner: 'victim' });
    expect(res.status).toBe(201);
    expect(res.body.data.ownerId).toBe(uid);
    const row = await prisma.project.findUnique({ where: { id: res.body.data.id } });
    expect(row!.ownerId).toBe(uid);
  });

  it('another verified user cannot read the project (404)', async () => {
    setTokenVerifier(async (t) => ({ uid: t }));
    const created = await request(app).post('/api/projects').set('Authorization', `Bearer ${tag}-alice`).send({ name: 'x', slrProjectId: `${tag}-${n++}` });
    const other = await request(app).get(`/api/projects/${created.body.data.id}`).set('Authorization', `Bearer ${tag}-bob`).set('X-Dev-User-Id', `${tag}-alice`);
    expect(other.status).toBe(404);
  });
});

describe('raw HTTP edge cases against the real app', () => {
  let server: http.Server; let port = 0;
  const fake = new FakeSlrBe();
  const originalBase = env.SLR_API_BASE_URL;
  beforeAll(async () => {
    await fake.start();
    server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => { env.SLR_API_BASE_URL = originalBase; await fake.stop(); await new Promise((r) => server.close(r)); });

  const raw = (text: string) => new Promise<string>((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(text));
    let out = ''; s.on('data', (d) => { out += d.toString('latin1'); }); s.on('close', () => resolve(out)); s.on('error', () => resolve(out));
    setTimeout(() => s.destroy(), 2000);
  });

  it.each([
    ['bare CR inside the value', 'Authorization: Bearer a\rb\r\n'],
    ['obs-fold continuation line', 'Authorization: Bearer a\r\n b\r\n'],
    ['NUL inside the value', 'Authorization: Bearer a\x00b\r\n'],
  ])('%s is refused by the parser with 400 and the server stays up', async (_k, header) => {
    const out = await raw(`GET /api/projects HTTP/1.1\r\nHost: x\r\n${header}Connection: close\r\n\r\n`);
    expect(out.startsWith('HTTP/1.1 400')).toBe(true);
    expect((await request(server).get('/api/health')).status).toBe(200);
  });

  it('duplicate Authorization headers: the first is verified AND the first is forwarded to slr-be', async () => {
    env.SLR_API_BASE_URL = fake.baseUrl; env.SLR_VERIFY_PROJECT_ACCESS = true; fake.reset();
    const verified: string[] = [];
    setTokenVerifier(async (t) => { verified.push(t); return { uid: `${tag}-dup` }; });
    const id = `${tag}-dup-${n++}`;
    fake.json(`/api/projects/${id}`, {});
    const status = await new Promise<number>((resolve, reject) => {
      const body = JSON.stringify({ name: 'x', slrProjectId: id });
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/projects',
        headers: { Authorization: ['Bearer first', 'Bearer second'], 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
      req.on('error', reject); req.end(body);
    });
    expect(status).toBe(201);
    expect(verified).toEqual(['first']);
    expect(fake.requests[0].authorization).toBe('Bearer first');
  });

  it('the Authorization header reaches slr-be byte for byte (odd casing, double space, latin1 byte)', async () => {
    env.SLR_API_BASE_URL = fake.baseUrl; env.SLR_VERIFY_PROJECT_ACCESS = true;
    for (const h of ['bEaReR  tok.en-_/+=', 'Bearer té']) {
      fake.reset();
      const id = `${tag}-fw-${n++}`;
      fake.json(`/api/projects/${id}`, {});
      const res = await request(server).post('/api/projects').set('Authorization', h).set('X-Dev-User-Id', `${tag}-fw`).send({ name: 'x', slrProjectId: id });
      expect(res.status).toBe(201);
      // Node decodes header bytes as latin1 on both ends, so compare bytes.
      expect(Buffer.from(fake.requests[0].authorization!, 'latin1')).toEqual(Buffer.from(h, 'utf8'));
    }
  });
});

describe('real firebase-admin path with forged tokens', () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'attacker', user_id: 'attacker', iat: now - 10, exp: now + 3600, auth_time: now - 10 };
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const signRs = (header: object, payload: object) => {
    const input = `${b64(header)}.${b64(payload)}`;
    return `${input}.${createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url')}`;
  };
  const tokens: Record<string, string> = {
    'alg none': `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`,
    'RS256 local key, made-up kid': signRs({ alg: 'RS256', kid: 'qa-fake-kid', typ: 'JWT' }, claims),
    'RS256 local key, no kid': signRs({ alg: 'RS256', typ: 'JWT' }, claims),
    'HS256 with project id as secret': `${b64({ alg: 'HS256', kid: 'x' })}.${b64(claims)}.c2ln`,
    'expired RS256': signRs({ alg: 'RS256', kid: 'qa-fake-kid' }, { ...claims, exp: now - 100 }),
  };
  const lib = getAuth(initializeApp({ projectId: PROJECT }, 'qa-auth-direct'));
  const codes: Record<string, string> = {};

  it.each(Object.keys(tokens))('rejects %s (library error recorded, verifier returns null)', async (name) => {
    const outcome = await Promise.race([
      lib.verifyIdToken(tokens[name]).then(() => 'ACCEPTED', (e: any) => `${e?.code ?? e?.errorInfo?.code ?? 'error'}: ${String(e?.message).slice(0, 90)}`),
      new Promise<string>((r) => setTimeout(() => r('TIMEOUT'), 15_000)),
    ]);
    codes[name] = outcome;
    appendFileSync(join(tmpdir(), 'qa-firebase-outcomes.log'), `${name} -> ${outcome}
`);
    expect(outcome).not.toBe('ACCEPTED');
    expect(await createFirebaseVerifier({ projectId: PROJECT })(tokens[name])).toBeNull();
  }, 40_000);

  it('the app answers 401 INVALID_TOKEN to a forged token even with the dev header set', async () => {
    setTokenVerifier(createFirebaseVerifier({ projectId: PROJECT }));
    const res = await request(app).get('/api/projects').set('Authorization', `Bearer ${tokens['RS256 local key, made-up kid']}`).set('X-Dev-User-Id', 'victim');
    expect([res.status, res.body.error.code]).toEqual([401, 'INVALID_TOKEN']);
    expect(JSON.stringify(res.body)).not.toMatch(/kid|certificate|googleapis/i);
  }, 40_000);
});
