import request from 'supertest';
import { createApp } from '../src/app.js';

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('returns the error envelope for unknown routes', async () => {
    const res = await request(createApp()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('documents the project and snapshot routes in the OpenAPI document', async () => {
    const res = await request(createApp()).get('/api-docs.json');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.paths)).toEqual(expect.arrayContaining([
      '/api/projects', '/api/projects/{projectId}/snapshots', '/api/projects/{projectId}/snapshots/{snapshotId}',
    ]));
  });
});
