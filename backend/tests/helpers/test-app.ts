import pino from 'pino';
import { vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AuthServicing } from '../../src/auth.js';
import type { Database } from '../../src/database.js';
import { InMemoryRateLimiter } from '../../src/rate-limiter.js';

export function createDatabaseStub(overrides: Partial<Database> = {}): Database {
  return {
    checkHealth: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

export function createTestApp(options: {
  database?: Database;
  corsAllowedOrigins?: readonly string[];
  authService?: AuthServicing;
  authRateLimiter?: InMemoryRateLimiter;
} = {}) {
  return createApp({
    database: options.database ?? createDatabaseStub(),
    corsAllowedOrigins: options.corsAllowedOrigins ?? [],
    logger: pino({ level: 'silent' }),
    authService: options.authService ?? createAuthServiceStub(),
    authRateLimiter: options.authRateLimiter ?? new InMemoryRateLimiter(60_000, 10),
  });
}

export function createAuthServiceStub(overrides: Partial<AuthServicing> = {}): AuthServicing {
  const unavailable = vi.fn().mockRejectedValue(new Error('Auth service stub was not configured'));
  return {
    register: unavailable,
    login: unavailable,
    signInWithApple: unavailable,
    refresh: unavailable,
    logout: unavailable,
    forgotPassword: unavailable,
    resetPassword: unavailable,
    restore: unavailable,
    ...overrides,
  };
}
