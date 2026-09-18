import type { EventService } from '../../src/events.js';
import type { DiscoverServicing } from '../../src/discover.js';
import pino from 'pino';
import { vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AuthServicing } from '../../src/auth.js';
import type { Database } from '../../src/database.js';
import { InMemoryRateLimiter } from '../../src/rate-limiter.js';
import type { ProfileServicing } from '../../src/profile.js';
import type { SafetyServicing } from '../../src/safety.js';
import type { StravaServicing } from '../../src/strava.js';
import type { AdminService } from '../../src/admin.js';
import type { AccountDeletionServicing } from '../../src/account-deletion.js';

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
  profileService?: ProfileServicing;
  discoverService?: DiscoverServicing;
  profileRateLimiter?: InMemoryRateLimiter;
  safetyService?: SafetyServicing;
  safetyRateLimiter?: InMemoryRateLimiter;
  stravaService?: StravaServicing;
  eventService?: EventService;
  adminService?: AdminService;
  accountDeletionService?: AccountDeletionServicing;
} = {}) {
  return createApp({
    database: options.database ?? createDatabaseStub(),
    corsAllowedOrigins: options.corsAllowedOrigins ?? [],
    logger: pino({ level: 'silent' }),
    authService: options.authService ?? createAuthServiceStub(),
    authRateLimiter: options.authRateLimiter ?? new InMemoryRateLimiter(60_000, 10),
    discoverService: options.discoverService ?? { discover: vi.fn().mockResolvedValue({ users: [], nextCursor: null }) },
    profileService: options.profileService ?? createProfileServiceStub(),
    profileRateLimiter: options.profileRateLimiter ?? new InMemoryRateLimiter(60_000, 10),
    safetyService: options.safetyService ?? {
      block: vi.fn(), unblock: vi.fn(), blockedUsers: vi.fn().mockResolvedValue({ users: [], nextCursor: null }), report: vi.fn(),
    },
    safetyRateLimiter: options.safetyRateLimiter ?? new InMemoryRateLimiter(60_000, 20),
    stravaService: options.stravaService,
    eventService: options.eventService,
    adminService: options.adminService,
    accountDeletionService: options.accountDeletionService,
  });
}

export function createProfileServiceStub(overrides: Partial<ProfileServicing> = {}): ProfileServicing {
  const unavailable = vi.fn().mockRejectedValue(new Error('Profile service stub was not configured'));
  return {
    getOwnProfile: unavailable,
    getPublicProfile: unavailable,
    updateProfile: unavailable,
    createPhotoUpload: unavailable,
    completePhotoUpload: unavailable,
    deletePhoto: unavailable,
    processPhotoCleanup: unavailable,
    ...overrides,
  };
}

export function createAuthServiceStub(overrides: Partial<AuthServicing> = {}): AuthServicing {
  const unavailable = vi.fn().mockRejectedValue(new Error('Auth service stub was not configured'));
  return {
    register: unavailable,
    login: unavailable,
    reauthenticatePassword: unavailable,
    signInWithApple: unavailable,
    refresh: unavailable,
    logout: unavailable,
    forgotPassword: unavailable,
    resetPassword: unavailable,
    restore: unavailable,
    ...overrides,
  };
}
