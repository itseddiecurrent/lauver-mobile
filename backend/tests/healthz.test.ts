import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

describe('GET /healthz', () => {
  it('returns a stable healthy response', async () => {
    const response = await request(createApp()).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      service: 'lauver-api',
    });
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('unknown routes', () => {
  it('return the public error contract without a stack trace', async () => {
    const response = await request(createApp()).get('/does-not-exist');
    const body = response.body as {
      code: unknown;
      message: unknown;
      requestId: unknown;
    };

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      code: 'not_found',
      message: 'Route not found',
    });
    expect(body.requestId).toBe(response.headers['x-request-id']);
    expect(body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(body).toLowerCase()).not.toContain('stack');
  });
});

describe('malformed JSON', () => {
  it('returns the public error contract without exposing parser details', async () => {
    const response = await request(createApp())
      .post('/healthz')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: 'invalid_json',
      message: 'Request body must contain valid JSON',
      requestId: response.headers['x-request-id'],
    });
    expect(JSON.stringify(response.body).toLowerCase()).not.toContain('syntax');
    expect(JSON.stringify(response.body).toLowerCase()).not.toContain('stack');
  });
});
