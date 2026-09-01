import { createServer } from 'node:http';

import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const server = createServer(createApp());

server.listen(config.port, config.host, () => {
  console.info(`Lauver API listening on ${config.host}:${config.port}`);
});

function shutdown(signal: string): void {
  console.info(`Received ${signal}; shutting down`);
  server.close((error) => {
    if (error) {
      console.error('Graceful shutdown failed', error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
