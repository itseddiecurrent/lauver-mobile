import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

const databaseURL = 'postgresql://lauver:local@localhost:5432/lauver';

describe('loadConfig', () => {
  it('uses safe local defaults around the required database URL', () => {
    expect(loadConfig({ DATABASE_URL: databaseURL })).toEqual({
      nodeEnvironment: 'development',
      host: '0.0.0.0',
      port: 3_000,
      databaseURL,
      corsAllowedOrigins: [],
      logLevel: 'info',
      shutdownTimeoutMilliseconds: 25_000,
    });
  });

  it('parses staging configuration and a deduplicated CORS allowlist', () => {
    expect(
      loadConfig({
        NODE_ENV: 'staging',
        HOST: '0.0.0.0',
        PORT: '10000',
        DATABASE_URL: databaseURL,
        CORS_ALLOWED_ORIGINS: 'https://admin-staging.lauver.ai, https://admin-staging.lauver.ai',
        LOG_LEVEL: 'warn',
        SHUTDOWN_TIMEOUT_MS: '15000',
      }),
    ).toEqual({
      nodeEnvironment: 'staging',
      host: '0.0.0.0',
      port: 10_000,
      databaseURL,
      corsAllowedOrigins: ['https://admin-staging.lauver.ai'],
      logLevel: 'warn',
      shutdownTimeoutMilliseconds: 15_000,
    });
  });

  it('requires a database URL', () => {
    expect(() => loadConfig({})).toThrow();
  });

  it('rejects non-PostgreSQL database URLs', () => {
    expect(() => loadConfig({ DATABASE_URL: 'https://database.example.com' })).toThrow();
  });

  it('rejects invalid ports', () => {
    expect(() => loadConfig({ DATABASE_URL: databaseURL, PORT: '70000' })).toThrow();
  });

  it('rejects CORS origins containing a path', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: databaseURL,
        CORS_ALLOWED_ORIGINS: 'https://admin.lauver.ai/path',
      }),
    ).toThrow('Invalid CORS origin');
  });

  it('rejects non-HTTP CORS origins', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: databaseURL,
        CORS_ALLOWED_ORIGINS: 'file://local-app',
      }),
    ).toThrow('Invalid CORS origin');
  });

  it.each(['test', 'staging', 'production'] as const)(
    'supports the %s backend environment',
    (nodeEnvironment) => {
      expect(loadConfig({ DATABASE_URL: databaseURL, NODE_ENV: nodeEnvironment }).nodeEnvironment).toBe(
        nodeEnvironment,
      );
    },
  );

  it('rejects unknown backend environments', () => {
    expect(() => loadConfig({ DATABASE_URL: databaseURL, NODE_ENV: 'preview' })).toThrow();
  });
});
