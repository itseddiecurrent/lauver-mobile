import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/database.js';
import { createTestApp } from '../helpers/test-app.js';

const testDatabaseURL = process.env.TEST_DATABASE_URL;
if (testDatabaseURL === undefined) {
  throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
}

const database = createDatabase(testDatabaseURL);
const sqlClient = new Client({ connectionString: testDatabaseURL });

beforeAll(async () => {
  await sqlClient.connect();
});

afterAll(async () => {
  await database.disconnect();
  await sqlClient.end();
});

describe('PostgreSQL integration', () => {
  it('reports ready through the real Prisma/PostgreSQL connection', async () => {
    const response = await request(createTestApp({ database })).get('/readyz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ready',
      service: 'lauver-api',
      database: 'ok',
    });
  });

  it('applied the Step 01 migration to an initially empty schema', async () => {
    const result = await sqlClient.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.service_metadata')::text AS table_name",
    );

    expect(result.rows[0]?.table_name).toBe('service_metadata');
  });
});
