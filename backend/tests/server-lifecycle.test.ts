import { createServer } from 'node:http';

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/database.js';
import { shutdownServer } from '../src/server-lifecycle.js';

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
}

describe('shutdownServer', () => {
  it('stops accepting traffic and disconnects PostgreSQL', async () => {
    const server = createServer((_request, response) => response.end('ok'));
    const disconnect = vi.fn(() => {
      expect(server.listening).toBe(false);
      return Promise.resolve();
    });
    const database: Database = {
      checkHealth: vi.fn().mockResolvedValue(undefined),
      disconnect,
    };
    await listen(server);

    await shutdownServer(server, database, pino({ level: 'silent' }), 'SIGTERM', 1_000);

    expect(server.listening).toBe(false);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('reports a database disconnect failure', async () => {
    const server = createServer((_request, response) => response.end('ok'));
    const database: Database = {
      checkHealth: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockRejectedValue(new Error('disconnect failed')),
    };
    await listen(server);

    await expect(
      shutdownServer(server, database, pino({ level: 'silent' }), 'SIGTERM', 1_000),
    ).rejects.toThrow('shutdown operations failed');
    expect(server.listening).toBe(false);
  });
});
