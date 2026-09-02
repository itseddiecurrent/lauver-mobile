import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

const databaseURL = 'postgresql://lauver:local@localhost:5432/lauver';
const authAccessTokenSecret = 'test-auth-secret-at-least-32-characters';
const requiredEnvironment = {
  DATABASE_URL: databaseURL,
  AUTH_ACCESS_TOKEN_SECRET: authAccessTokenSecret,
};

describe('loadConfig', () => {
  it('uses safe local defaults around the required database URL', () => {
    expect(loadConfig(requiredEnvironment)).toEqual({
      nodeEnvironment: 'development',
      host: '0.0.0.0',
      port: 3_000,
      databaseURL,
      corsAllowedOrigins: [],
      logLevel: 'info',
      shutdownTimeoutMilliseconds: 25_000,
      authAccessTokenSecret,
      authAccessTokenTTLSeconds: 900,
      authRefreshTokenTTLSeconds: 2_592_000,
      authPasswordResetTTLSeconds: 900,
      authRateLimitWindowMilliseconds: 60_000,
      authRateLimitMaxAttempts: 10,
      passwordResetDelivery: 'disabled',
      resendAPIKey: undefined,
      passwordResetFromEmail: undefined,
    });
  });

  it('parses staging configuration and a deduplicated CORS allowlist', () => {
    expect(
      loadConfig({
        NODE_ENV: 'staging',
        AUTH_ACCESS_TOKEN_SECRET: authAccessTokenSecret,
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
      authAccessTokenSecret,
      authAccessTokenTTLSeconds: 900,
      authRefreshTokenTTLSeconds: 2_592_000,
      authPasswordResetTTLSeconds: 900,
      authRateLimitWindowMilliseconds: 60_000,
      authRateLimitMaxAttempts: 10,
      passwordResetDelivery: 'disabled',
      resendAPIKey: undefined,
      passwordResetFromEmail: undefined,
    });
  });

  it('requires a database URL', () => {
    expect(() => loadConfig({})).toThrow();
  });

  it('rejects non-PostgreSQL database URLs', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'https://database.example.com',
        AUTH_ACCESS_TOKEN_SECRET: authAccessTokenSecret,
      }),
    ).toThrow();
  });

  it('rejects invalid ports', () => {
    expect(() => loadConfig({ ...requiredEnvironment, PORT: '70000' })).toThrow();
  });

  it('rejects CORS origins containing a path', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: databaseURL,
        AUTH_ACCESS_TOKEN_SECRET: authAccessTokenSecret,
        CORS_ALLOWED_ORIGINS: 'https://admin.lauver.ai/path',
      }),
    ).toThrow('Invalid CORS origin');
  });

  it('rejects non-HTTP CORS origins', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: databaseURL,
        AUTH_ACCESS_TOKEN_SECRET: authAccessTokenSecret,
        CORS_ALLOWED_ORIGINS: 'file://local-app',
      }),
    ).toThrow('Invalid CORS origin');
  });

  it.each(['test', 'staging', 'production'] as const)(
    'supports the %s backend environment',
    (nodeEnvironment) => {
      expect(loadConfig({ ...requiredEnvironment, NODE_ENV: nodeEnvironment }).nodeEnvironment).toBe(
        nodeEnvironment,
      );
    },
  );

  it('rejects unknown backend environments', () => {
    expect(() => loadConfig({ ...requiredEnvironment, NODE_ENV: 'preview' })).toThrow();
  });

  it('requires a strong access-token signing secret', () => {
    expect(() => loadConfig({ DATABASE_URL: databaseURL, AUTH_ACCESS_TOKEN_SECRET: 'short' })).toThrow();
  });

  it('requires complete Resend configuration when password-reset delivery is enabled', () => {
    expect(() => loadConfig({
      ...requiredEnvironment,
      PASSWORD_RESET_DELIVERY: 'resend',
    })).toThrow('RESEND_API_KEY is required');

    expect(loadConfig({
      ...requiredEnvironment,
      PASSWORD_RESET_DELIVERY: 'resend',
      RESEND_API_KEY: 'provider-api-key',
      PASSWORD_RESET_FROM_EMAIL: 'noreply@lauver.ai',
    })).toMatchObject({
      passwordResetDelivery: 'resend',
      resendAPIKey: 'provider-api-key',
      passwordResetFromEmail: 'noreply@lauver.ai',
    });
  });
});
