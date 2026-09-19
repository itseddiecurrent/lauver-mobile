import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnvironment } from 'dotenv';
import { Client } from 'pg';

import { validateTestDatabaseURL } from './test-database-safety.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnvironment({ path: path.join(backendRoot, '.env'), quiet: true });

function runNodeModule(modulePath: string, arguments_: string[], environment: NodeJS.ProcessEnv): void {
  const result = spawnSync(process.execPath, [modulePath, ...arguments_], {
    cwd: backendRoot,
    env: environment,
    stdio: 'inherit',
  });

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${path.basename(modulePath)} exited with status ${String(result.status)}`);
  }
}

async function resetPublicSchema(databaseURL: string): Promise<void> {
  const client = new Client({ connectionString: databaseURL });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const databaseURL = validateTestDatabaseURL(
    process.env.TEST_DATABASE_LOCAL ?? process.env.TEST_DATABASE_URL,
    process.env.ALLOW_REMOTE_TEST_DATABASE_RESET === 'true',
  );
  const environment = {
    ...process.env,
    DATABASE_URL: databaseURL,
    NODE_ENV: 'test',
    TEST_DATABASE_URL: databaseURL,
  };

  await resetPublicSchema(databaseURL);
  runNodeModule('node_modules/prisma/build/index.js', ['migrate', 'deploy'], environment);
  runNodeModule(
    'node_modules/vitest/vitest.mjs',
    ['run', '--config', 'vitest.integration.config.ts'],
    environment,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown integration-test failure';
  console.error(message);
  process.exitCode = 1;
});
