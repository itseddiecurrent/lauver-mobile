import type { Server } from 'node:http';

import type { Logger } from 'pino';

import type { Database } from './database.js';

function closeHTTPServer(server: Server, timeoutMilliseconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.closeAllConnections();
      reject(new Error(`HTTP server did not close within ${timeoutMilliseconds}ms`));
    }, timeoutMilliseconds);
    timeout.unref();

    server.close((error) => {
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
    server.closeIdleConnections();
  });
}

export async function shutdownServer(
  server: Server,
  database: Database,
  logger: Logger,
  signal: string,
  timeoutMilliseconds: number,
): Promise<void> {
  logger.info({ signal }, 'Graceful shutdown started');

  const failures: unknown[] = [];
  try {
    await closeHTTPServer(server, timeoutMilliseconds);
  } catch (error) {
    failures.push(error);
  }

  try {
    await database.disconnect();
  } catch (error) {
    failures.push(error);
  }

  if (failures.length > 0) {
    logger.error({ failures }, 'Graceful shutdown failed');
    throw new Error('One or more shutdown operations failed');
  }

  logger.info({ signal }, 'Graceful shutdown completed');
}
