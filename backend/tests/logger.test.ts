import { Writable } from 'node:stream';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { InMemoryRateLimiter } from '../src/rate-limiter.js';
import { createAuthServiceStub, createDatabaseStub, createProfileServiceStub } from './helpers/test-app.js';

describe('structured request logging', () => {
  it('redacts authorization and cookie headers', async () => {
    let output = '';
    const destination = new Writable({
      write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        output += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        callback();
      },
    });
    const app = createApp({
      database: createDatabaseStub(),
      corsAllowedOrigins: [],
      logger: createLogger('info', 'test', destination),
      authService: createAuthServiceStub({
        login: () => Promise.resolve({
          user: { id: 'user-id', email: 'runner@example.com' },
          accessToken: 'signed-access-token',
          refreshToken: 'response-refresh-token',
          expiresIn: 900,
        }),
        logout: () => Promise.resolve(),
      }),
      authRateLimiter: new InMemoryRateLimiter(60_000, 10),
      discoverService: { discover: () => Promise.resolve({ users: [], nextCursor: null }) },
      profileService: createProfileServiceStub(),
      safetyService: { block: () => Promise.resolve(), unblock: () => Promise.resolve(), blockedUsers: () => Promise.resolve({ users: [], nextCursor: null }), report: () => Promise.resolve({ referenceId: 'test', blockedUser: false }) },
      safetyRateLimiter: new InMemoryRateLimiter(60_000, 20),
      profileRateLimiter: new InMemoryRateLimiter(60_000, 10),
      stravaService: {
        start: () => Promise.reject(new Error('unused')),
        callback: () => Promise.resolve('connected'),
        status: () => Promise.reject(new Error('unused')),
        sync: () => Promise.reject(new Error('unused')),
        disconnect: () => Promise.reject(new Error('unused')),
      },
    });

    await request(app)
      .get('/healthz')
      .set('Authorization', 'Bearer should-never-appear')
      .set('Cookie', 'session=should-never-appear')
      .expect(200);

    await request(app)
      .post('/v1/auth/login')
      .send({ email: 'runner@example.com', password: 'RawPassword9' })
      .expect(200);
    await request(app)
      .post('/v1/auth/logout')
      .send({ refreshToken: 'raw-refresh-token-value' })
      .expect(204);

    await request(app).get(`/v1/integrations/strava/callback?state=${'s'.repeat(43)}&code=private-oauth-code&scope=read,activity:read`).expect(303);

    // Successful Render liveness probes are intentionally omitted from the
    // access log; verify suppression while still proving sensitive values are
    // absent from the remaining request records.
    expect(output).not.toContain('GET /healthz');
    expect(output).not.toContain('should-never-appear');
    expect(output).not.toContain('RawPassword9');
    expect(output).not.toContain('raw-refresh-token-value');
    expect(output).not.toContain('response-refresh-token');
    expect(output).not.toContain('private-oauth-code');
    expect(output).not.toContain('s'.repeat(43));
    expect(output).toContain('lauver-api');
  });
});
