import { Writable } from 'node:stream';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { createDatabaseStub } from './helpers/test-app.js';

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
    });

    await request(app)
      .get('/healthz')
      .set('Authorization', 'Bearer should-never-appear')
      .set('Cookie', 'session=should-never-appear')
      .expect(200);

    expect(output).toContain('[Redacted]');
    expect(output).not.toContain('should-never-appear');
    expect(output).toContain('lauver-api');
  });
});
