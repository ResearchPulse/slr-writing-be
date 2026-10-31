import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { setTokenVerifier } from '../../src/middleware/auth.middleware.js';
import { createFirebaseVerifier, type VerifyIdToken } from '../../src/modules/auth/firebase-verifier.js';

const PROJECT = 'shared-firebase-project';
const make = (verify: VerifyIdToken, over: { checkRevoked?: boolean } = {}) => createFirebaseVerifier({ projectId: PROJECT, verify, ...over });

describe('createFirebaseVerifier', () => {
  it('returns the uid and email of a valid token', async () => {
    const verifier = make(async () => ({ uid: 'u1', aud: PROJECT, email: 'a@b.c' }));
    expect(await verifier('t')).toEqual({ uid: 'u1', email: 'a@b.c' });
  });

  it('omits the email when the token has none', async () => {
    expect(await make(async () => ({ uid: 'u1', aud: PROJECT }))('t')).toEqual({ uid: 'u1' });
  });

  it('rejects a token issued for another Firebase project', async () => {
    expect(await make(async () => ({ uid: 'u1', aud: 'someone-elses-project' }))('t')).toBeNull();
  });

  it.each([[''], [undefined as unknown as string], [42 as unknown as string]])('rejects an empty or non-string uid (%j)', async (uid) => {
    expect(await make(async () => ({ uid, aud: PROJECT }))('t')).toBeNull();
  });

  it('rejects when the library says the token is invalid, expired or revoked', async () => {
    expect(await make(async () => { throw new Error('auth/id-token-expired'); })('t')).toBeNull();
  });

  it('never throws, even for a verifier that returns nothing', async () => {
    expect(await make((async () => undefined) as unknown as VerifyIdToken)('t')).toBeNull();
    expect(await make((async () => null) as unknown as VerifyIdToken)('t')).toBeNull();
  });

  it('asks for the revocation check only when configured', async () => {
    const verify = vi.fn<VerifyIdToken>(async () => ({ uid: 'u', aud: PROJECT }));
    await make(verify)('t');
    await make(verify, { checkRevoked: true })('t');
    expect(verify.mock.calls.map((call) => call[1])).toEqual([false, true]);
  });

  it('passes the token to the library untouched', async () => {
    const verify = vi.fn<VerifyIdToken>(async () => ({ uid: 'u', aud: PROJECT }));
    await make(verify)('abc.def.ghi');
    expect(verify.mock.calls[0][0]).toBe('abc.def.ghi');
  });

  it('refuses to be built without a project id', () => {
    expect(() => createFirebaseVerifier({ projectId: '  ' })).toThrow();
  });

  it('with the real library, malformed tokens are rejected', async () => {
    const verifier = createFirebaseVerifier({ projectId: PROJECT });
    for (const token of ['garbage', 'a.b.c', '', 'x'.repeat(5000), 'eyJhbGciOiJub25lIn0.e30.']) {
      expect(await verifier(token)).toBeNull();
    }
  });
});

describe('API with the Firebase verifier', () => {
  const app = createApp();
  afterEach(() => { setTokenVerifier(null); env.DEV_AUTH_ENABLED = true; });

  it('accepts a good token, rejects a bad one, and rejects a request without a token (dev auth off)', async () => {
    env.DEV_AUTH_ENABLED = false;
    setTokenVerifier(make(async (token) => {
      if (token !== 'good') throw new Error('invalid');
      return { uid: 'firebase-user', aud: PROJECT };
    }));
    expect((await request(app).get('/api/projects').set('Authorization', 'Bearer good')).status).toBe(200);
    const bad = await request(app).get('/api/projects').set('Authorization', 'Bearer bad');
    expect([bad.status, bad.body.error.code]).toEqual([401, 'INVALID_TOKEN']);
    const none = await request(app).get('/api/projects');
    expect([none.status, none.body.error.code]).toEqual([401, 'UNAUTHORIZED']);
  });

  it('does not let the dev header act as someone else when dev auth is off', async () => {
    env.DEV_AUTH_ENABLED = false;
    setTokenVerifier(make(async () => ({ uid: 'firebase-user', aud: PROJECT })));
    const res = await request(app).get('/api/projects').set('X-Dev-User-Id', 'victim');
    expect(res.status).toBe(401);
  });

  it('lets the token decide who the user is, ignoring the dev header', async () => {
    env.DEV_AUTH_ENABLED = true;
    setTokenVerifier(make(async () => ({ uid: 'firebase-user', aud: PROJECT })));
    const created = await request(app).post('/api/projects').set('Authorization', 'Bearer t').set('X-Dev-User-Id', 'victim')
      .send({ name: 'x', slrProjectId: `fb-${Date.now()}` });
    expect(created.status).toBe(201);
    expect(created.body.data.ownerId).toBe('firebase-user');
  });
});

describe('createFirebaseVerifier strictness', () => {
  it('rejects a decoded token that has no audience', async () => {
    expect(await make(async () => ({ uid: 'u' }))('t')).toBeNull();
  });

  it('keeps only a string email', async () => {
    for (const email of [42, true, [], {}, ''] as unknown[]) {
      expect(await make(async () => ({ uid: 'u', aud: PROJECT, email: email as string }))('t')).toEqual({ uid: 'u' });
    }
  });

  it('treats a verification that never finishes as invalid instead of hanging the request', async () => {
    const verifier = createFirebaseVerifier({ projectId: PROJECT, timeoutMs: 50, verify: () => new Promise(() => undefined) });
    const started = Date.now();
    expect(await verifier('t')).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
