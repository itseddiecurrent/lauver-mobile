import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createDatabaseStub, createTestApp } from './helpers/test-app.js';

describe('GET /healthz', () => {
  it('returns liveness without depending on the database', async () => {
    const checkHealth = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const database = createDatabaseStub({
      checkHealth,
    });
    const response = await request(createTestApp({ database })).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'lauver-api' });
    expect(checkHealth).not.toHaveBeenCalled();
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('GET /readyz', () => {
  it('returns 200 when PostgreSQL is reachable', async () => {
    const checkHealth = vi.fn().mockResolvedValue(undefined);
    const database = createDatabaseStub({ checkHealth });
    const response = await request(createTestApp({ database })).get('/readyz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ready',
      service: 'lauver-api',
      database: 'ok',
    });
    expect(checkHealth).toHaveBeenCalledOnce();
  });

  it('returns a safe 503 error when PostgreSQL is unavailable', async () => {
    const database = createDatabaseStub({
      checkHealth: vi.fn().mockRejectedValue(new Error('password=should-not-leak')),
    });
    const response = await request(createTestApp({ database })).get('/readyz');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      code: 'service_unavailable',
      message: 'Service is not ready',
      requestId: response.headers['x-request-id'],
    });
    expect(JSON.stringify(response.body)).not.toContain('password');
    expect(JSON.stringify(response.body).toLowerCase()).not.toContain('stack');
  });
});

describe('CORS allowlist', () => {
  it('allows configured browser origins', async () => {
    const response = await request(
      createTestApp({ corsAllowedOrigins: ['https://admin-staging.lauver.ai'] }),
    )
      .options('/readyz')
      .set('Origin', 'https://admin-staging.lauver.ai')
      .set('Access-Control-Request-Method', 'GET');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://admin-staging.lauver.ai');
  });

  it('rejects origins outside the allowlist', async () => {
    const response = await request(
      createTestApp({ corsAllowedOrigins: ['https://admin-staging.lauver.ai'] }),
    )
      .options('/readyz')
      .set('Origin', 'https://attacker.example')
      .set('Access-Control-Request-Method', 'GET');

    expect(response.status).toBe(403);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.body).toEqual({
      code: 'origin_not_allowed',
      message: 'Origin is not allowed',
      requestId: response.headers['x-request-id'],
    });
  });

  it('allows requests without a browser Origin header for the native app', async () => {
    await request(createTestApp()).get('/healthz').expect(200);
  });
});

describe('public error contract', () => {
  it('returns a safe 404 for unknown routes', async () => {
    const response = await request(createTestApp()).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      code: 'not_found',
      message: 'Route not found',
      requestId: response.headers['x-request-id'],
    });
    expect(JSON.stringify(response.body).toLowerCase()).not.toContain('stack');
  });

  it('returns a safe 400 for malformed JSON', async () => {
    const response = await request(createTestApp())
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
