import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().max(65_535).default(3_000),
});

export type AppConfig = {
  nodeEnvironment: z.infer<typeof environmentSchema>['NODE_ENV'];
  host: string;
  port: number;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);

  return {
    nodeEnvironment: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
  };
}
