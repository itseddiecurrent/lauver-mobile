import pino from 'pino';
import { vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { Database } from '../../src/database.js';

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
} = {}) {
  return createApp({
    database: options.database ?? createDatabaseStub(),
    corsAllowedOrigins: options.corsAllowedOrigins ?? [],
    logger: pino({ level: 'silent' }),
  });
}
