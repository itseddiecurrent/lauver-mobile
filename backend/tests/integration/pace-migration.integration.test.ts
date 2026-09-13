import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { expect, it } from 'vitest';

it('upgrades existing paces without changing their displayed seconds or cycling speed', async () => {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `pace_upgrade_${randomBytes(8).toString('hex')}`;
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query('CREATE TABLE users(id UUID PRIMARY KEY)');
    await client.query(await readFile(new URL('../../prisma/migrations/20260910000000_step_05_workout_profiles/migration.sql', import.meta.url), 'utf8'));
    await client.query("INSERT INTO users(id) VALUES('faca0000-0000-4000-8000-000000000001')");
    await client.query(`INSERT INTO user_sports(user_id,sport,pace_value,pace_unit,pace_bracket,updated_at) VALUES
      ('faca0000-0000-4000-8000-000000000001','running',5.02,'min/km','moderate',now()),
      ('faca0000-0000-4000-8000-000000000001','swimming',1.02,'min/100m','fast',now()),
      ('faca0000-0000-4000-8000-000000000001','cycling',25.5,'km/h','moderate',now()),
      ('faca0000-0000-4000-8000-000000000001','rowing',NULL,NULL,NULL,now())`);
    await client.query(await readFile(new URL('../../prisma/migrations/20260913010000_explicit_pace_ranges/migration.sql', import.meta.url), 'utf8'));
    const rows = await client.query('SELECT sport,pace_value::text,pace_unit FROM user_sports ORDER BY sport');
    expect(rows.rows).toEqual([
      { sport: 'cycling', pace_value: '25.500000', pace_unit: 'km/h' },
      { sport: 'rowing', pace_value: null, pace_unit: null },
      { sport: 'running', pace_value: '5.016667', pace_unit: 'min/km' },
      { sport: 'swimming', pace_value: '1.016667', pace_unit: 'min/100m' },
    ]);
    const columns = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='user_sports' AND column_name='pace_bracket'", [schema]);
    expect(columns.rows).toHaveLength(0);
    await client.query('SAVEPOINT invalid_pace');
    await expect(client.query("UPDATE user_sports SET pace_value=NULL WHERE sport='running'"))
      .rejects.toMatchObject({ code: '23514' });
    await client.query('ROLLBACK TO SAVEPOINT invalid_pace');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
