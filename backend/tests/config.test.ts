import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

const databaseURL = 'postgresql://lauver:local@localhost:5432/lauver';
const authAccessTokenSecret = 'test-auth-secret-at-least-32-characters';
const requiredEnvironment = {
  DATABASE_URL: databaseURL,
  AUTH_ACCESS_TOKEN_SECRET: authAccessTokenSecret,
};

describe('loadConfig', () => {
  it('requires server-only Strava credentials and a fixed HTTPS callback when enabled', () => {
    expect(() => loadConfig({ ...requiredEnvironment, STRAVA_ENABLED: 'true' })).toThrow('STRAVA_CLIENT_ID');
    const strava = { STRAVA_ENABLED:'true',STRAVA_CLIENT_ID:'12345',STRAVA_CLIENT_SECRET:'config-test-secret',
      STRAVA_CALLBACK_URL:'https://example.com/v1/integrations/strava/callback',STRAVA_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,18).toString('base64') };
    expect(loadConfig({ ...requiredEnvironment,...strava }).strava).toMatchObject({clientID:'12345',callbackURL:strava.STRAVA_CALLBACK_URL});
    for (const url of ['http://example.com/v1/integrations/strava/callback','https://example.com/other','https://example.com/v1/integrations/strava/callback?next=evil']) {
      expect(() => loadConfig({ ...requiredEnvironment,...strava,STRAVA_CALLBACK_URL:url })).toThrow('fixed HTTPS');
    }
    expect(() => loadConfig({ ...requiredEnvironment,...strava,STRAVA_TOKEN_ENCRYPTION_KEY:'invalid' })).toThrow('32-byte');
    expect(() => loadConfig({ ...requiredEnvironment,...strava,APPLE_TOKEN_ENCRYPTION_KEY:strava.STRAVA_TOKEN_ENCRYPTION_KEY })).toThrow('separate');
  });
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
      appleAuthEnabled: false,
      appleClientID: undefined,
      appleTeamID: undefined,
      appleKeyID: undefined,
      applePrivateKey: undefined,
      appleTokenEncryptionKey: undefined,
      profilePhotoStorageEnabled: false,
      objectStorageEndpoint: undefined,
      objectStorageRegion: undefined,
      objectStorageBucket: undefined,
      objectStorageAccessKeyID: undefined,
      objectStorageSecretAccessKey: undefined,
      objectStoragePublicBaseURL: undefined,
      objectStorageForcePathStyle: false,
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
      appleAuthEnabled: false,
      appleClientID: undefined,
      appleTeamID: undefined,
      appleKeyID: undefined,
      applePrivateKey: undefined,
      appleTokenEncryptionKey: undefined,
      profilePhotoStorageEnabled: false,
      objectStorageEndpoint: undefined,
      objectStorageRegion: undefined,
      objectStorageBucket: undefined,
      objectStorageAccessKeyID: undefined,
      objectStorageSecretAccessKey: undefined,
      objectStoragePublicBaseURL: undefined,
      objectStorageForcePathStyle: false,
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

  it('requires every server-side Apple secret and a 32-byte encryption key when enabled', () => {
    expect(() => loadConfig({ ...requiredEnvironment, APPLE_AUTH_ENABLED: 'true' }))
      .toThrow('APPLE_CLIENT_ID is required');

    expect(loadConfig({
      ...requiredEnvironment,
      APPLE_AUTH_ENABLED: 'true',
      APPLE_CLIENT_ID: 'ai.lauver.app.staging',
      APPLE_TEAM_ID: 'TEAM123456',
      APPLE_KEY_ID: 'KEY1234567',
      APPLE_PRIVATE_KEY: 'private-key-from-render-secret',
      APPLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    })).toMatchObject({
      appleAuthEnabled: true,
      appleClientID: 'ai.lauver.app.staging',
    });

    expect(() => loadConfig({
      ...requiredEnvironment,
      APPLE_AUTH_ENABLED: 'true',
      APPLE_CLIENT_ID: 'ai.lauver.app.staging',
      APPLE_TEAM_ID: 'TEAM123456',
      APPLE_KEY_ID: 'KEY1234567',
      APPLE_PRIVATE_KEY: 'private-key-from-render-secret',
      APPLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64'),
    })).toThrow('base64-encoded 32-byte key');
  });

  it('requires complete server-only object storage configuration when photo uploads are enabled', () => {
    expect(() => loadConfig({ ...requiredEnvironment, PROFILE_PHOTO_STORAGE_ENABLED: 'true' }))
      .toThrow('OBJECT_STORAGE_ENDPOINT is required');

    expect(loadConfig({
      ...requiredEnvironment,
      PROFILE_PHOTO_STORAGE_ENABLED: 'true',
      OBJECT_STORAGE_ENDPOINT: 'https://storage.example.com',
      OBJECT_STORAGE_REGION: 'auto',
      OBJECT_STORAGE_BUCKET: 'lauver-profile-photos-staging',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'server-side-access-key',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'server-side-secret-key',
      OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://photos-staging.lauver.ai',
      OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
    })).toMatchObject({
      profilePhotoStorageEnabled: true,
      objectStorageForcePathStyle: true,
      objectStorageBucket: 'lauver-profile-photos-staging',
    });

    expect(() => loadConfig({
      ...requiredEnvironment,
      PROFILE_PHOTO_STORAGE_ENABLED: 'true',
      OBJECT_STORAGE_ENDPOINT: 'ftp://storage.example.com',
      OBJECT_STORAGE_REGION: 'auto',
      OBJECT_STORAGE_BUCKET: 'photos',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'server-side-access-key',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'server-side-secret-key',
      OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://photos.example.com',
    })).toThrow('Object storage URLs must use HTTP or HTTPS');
  });
});
