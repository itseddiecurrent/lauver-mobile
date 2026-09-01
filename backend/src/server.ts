import 'dotenv/config';

import { createServer } from 'node:http';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './database.js';
import { createLogger } from './logger.js';
import { shutdownServer } from './server-lifecycle.js';

const config = loadConfig();
const logger = createLogger(config.logLevel, config.nodeEnvironment);
const database = createDatabase(config.databaseURL);
const server = createServer(
  createApp({
    database,
    corsAllowedOrigins: config.corsAllowedOrigins,
    logger,
  }),
);

server.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port }, 'Lauver API listening');
});

let shuttingDown = false;
function handleSignal(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  void shutdownServer(
    server,
    database,
    logger,
    signal,
    config.shutdownTimeoutMilliseconds,
  ).catch((error: unknown) => {
    logger.error({ err: error }, 'Server shutdown failed');
    process.exitCode = 1;
  });
}

process.once('SIGINT', () => handleSignal('SIGINT'));
process.once('SIGTERM', () => handleSignal('SIGTERM'));
