import { describe, expect, it } from 'vitest';

import { postgresConnectionOptions } from '../src/postgres-connection.js';

describe('PostgreSQL adapter transport', () => {
  it('keeps encrypted Supabase connections while allowing its managed CA chain', () => {
    const options = postgresConnectionOptions(
      'postgresql://postgres.project:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require&uselibpqcompat=true',
    );

    expect(options.ssl).toEqual({ rejectUnauthorized: false });
    expect(options.connectionString).not.toContain('sslmode=');
    expect(options.connectionString).not.toContain('uselibpqcompat=');
  });

  it('keeps strict certificate verification for Render PostgreSQL', () => {
    const options = postgresConnectionOptions(
      'postgresql://lauver:secret@dpg-example-a.singapore-postgres.render.com/lauver?sslmode=require',
    );

    expect(options.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('does not add TLS settings to local PostgreSQL URLs', () => {
    expect(postgresConnectionOptions('postgresql://lauver:secret@127.0.0.1:5432/lauver')).toEqual({
      connectionString: 'postgresql://lauver:secret@127.0.0.1:5432/lauver',
    });
  });
});
