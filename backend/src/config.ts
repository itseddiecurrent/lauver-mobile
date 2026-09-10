import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().max(65_535).default(3_000),
  DATABASE_URL: z
    .url()
    .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol), {
      message: 'DATABASE_URL must use the PostgreSQL protocol',
    }),
  CORS_ALLOWED_ORIGINS: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(25_000),
  AUTH_ACCESS_TOKEN_SECRET: z.string().min(32),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
  AUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3_600).max(7_776_000).default(2_592_000),
  AUTH_PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(900),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  AUTH_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(1_000).default(10),
  PASSWORD_RESET_DELIVERY: z.enum(['disabled', 'resend']).default('disabled'),
  RESEND_API_KEY: z.string().min(1).optional(),
  PASSWORD_RESET_FROM_EMAIL: z.email().optional(),
  APPLE_AUTH_ENABLED: z.enum(['true', 'false']).default('false'),
  APPLE_CLIENT_ID: z.string().min(1).optional(),
  APPLE_TEAM_ID: z.string().min(1).optional(),
  APPLE_KEY_ID: z.string().min(1).optional(),
  APPLE_PRIVATE_KEY: z.string().min(1).optional(),
  APPLE_TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
}).superRefine((environment, context) => {
  if (environment.PASSWORD_RESET_DELIVERY === 'resend') {
    if (environment.RESEND_API_KEY === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when PASSWORD_RESET_DELIVERY=resend',
      });
    }
    if (environment.PASSWORD_RESET_FROM_EMAIL === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['PASSWORD_RESET_FROM_EMAIL'],
        message: 'PASSWORD_RESET_FROM_EMAIL is required when PASSWORD_RESET_DELIVERY=resend',
      });
    }
  }
  if (environment.APPLE_AUTH_ENABLED === 'true') {
    for (const key of [
      'APPLE_CLIENT_ID',
      'APPLE_TEAM_ID',
      'APPLE_KEY_ID',
      'APPLE_PRIVATE_KEY',
      'APPLE_TOKEN_ENCRYPTION_KEY',
    ] as const) {
      if (environment[key] === undefined) {
        context.addIssue({ code: 'custom', path: [key], message: `${key} is required when APPLE_AUTH_ENABLED=true` });
      }
    }
    if (
      environment.APPLE_TOKEN_ENCRYPTION_KEY !== undefined &&
      Buffer.from(environment.APPLE_TOKEN_ENCRYPTION_KEY, 'base64').length !== 32
    ) {
      context.addIssue({
        code: 'custom',
        path: ['APPLE_TOKEN_ENCRYPTION_KEY'],
        message: 'APPLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
      });
    }
  }
});

export type AppConfig = {
  nodeEnvironment: z.infer<typeof environmentSchema>['NODE_ENV'];
  host: string;
  port: number;
  databaseURL: string;
  corsAllowedOrigins: string[];
  logLevel: z.infer<typeof environmentSchema>['LOG_LEVEL'];
  shutdownTimeoutMilliseconds: number;
  authAccessTokenSecret: string;
  authAccessTokenTTLSeconds: number;
  authRefreshTokenTTLSeconds: number;
  authPasswordResetTTLSeconds: number;
  authRateLimitWindowMilliseconds: number;
  authRateLimitMaxAttempts: number;
  passwordResetDelivery: 'disabled' | 'resend';
  resendAPIKey?: string;
  passwordResetFromEmail?: string;
  appleAuthEnabled: boolean;
  appleClientID?: string;
  appleTeamID?: string;
  appleKeyID?: string;
  applePrivateKey?: string;
  appleTokenEncryptionKey?: string;
};

function parseAllowedOrigins(value: string): string[] {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  for (const origin of origins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
  }

  return [...new Set(origins)];
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);

  return {
    nodeEnvironment: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    databaseURL: parsed.DATABASE_URL,
    corsAllowedOrigins: parseAllowedOrigins(parsed.CORS_ALLOWED_ORIGINS),
    logLevel: parsed.LOG_LEVEL,
    shutdownTimeoutMilliseconds: parsed.SHUTDOWN_TIMEOUT_MS,
    authAccessTokenSecret: parsed.AUTH_ACCESS_TOKEN_SECRET,
    authAccessTokenTTLSeconds: parsed.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    authRefreshTokenTTLSeconds: parsed.AUTH_REFRESH_TOKEN_TTL_SECONDS,
    authPasswordResetTTLSeconds: parsed.AUTH_PASSWORD_RESET_TTL_SECONDS,
    authRateLimitWindowMilliseconds: parsed.AUTH_RATE_LIMIT_WINDOW_MS,
    authRateLimitMaxAttempts: parsed.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    passwordResetDelivery: parsed.PASSWORD_RESET_DELIVERY,
    resendAPIKey: parsed.RESEND_API_KEY,
    passwordResetFromEmail: parsed.PASSWORD_RESET_FROM_EMAIL,
    appleAuthEnabled: parsed.APPLE_AUTH_ENABLED === 'true',
    appleClientID: parsed.APPLE_CLIENT_ID,
    appleTeamID: parsed.APPLE_TEAM_ID,
    appleKeyID: parsed.APPLE_KEY_ID,
    applePrivateKey: parsed.APPLE_PRIVATE_KEY,
    appleTokenEncryptionKey: parsed.APPLE_TOKEN_ENCRYPTION_KEY,
  };
}
