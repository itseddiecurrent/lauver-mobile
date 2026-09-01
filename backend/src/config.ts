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
});

export type AppConfig = {
  nodeEnvironment: z.infer<typeof environmentSchema>['NODE_ENV'];
  host: string;
  port: number;
  databaseURL: string;
  corsAllowedOrigins: string[];
  logLevel: z.infer<typeof environmentSchema>['LOG_LEVEL'];
  shutdownTimeoutMilliseconds: number;
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
  };
}
