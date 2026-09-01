import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createTestApp } from '../helpers/test-app.js';

describe('Step 00 health endpoint integration', () => {
  it('is reachable through the Express request pipeline without PostgreSQL', async () => {
    const response = await request(createTestApp()).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'lauver-api' });
  });
});
