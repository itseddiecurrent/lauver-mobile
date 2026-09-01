import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';

describe('health endpoint integration', () => {
  it('is reachable through the Express request pipeline', async () => {
    await request(createApp())
      .get('/healthz')
      .expect('Content-Type', /json/)
      .expect(200)
      .then((response) => {
        expect(response.body).toEqual({ status: 'ok', service: 'lauver-api' });
      });
  });
});
