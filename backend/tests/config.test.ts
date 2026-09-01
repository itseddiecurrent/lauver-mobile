import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses safe local defaults', () => {
    expect(loadConfig({})).toEqual({
      nodeEnvironment: 'development',
      host: '0.0.0.0',
      port: 3_000,
    });
  });

  it('parses Render-style string ports', () => {
    expect(loadConfig({ NODE_ENV: 'staging', HOST: '0.0.0.0', PORT: '10000' })).toEqual({
      nodeEnvironment: 'staging',
      host: '0.0.0.0',
      port: 10_000,
    });
  });

  it('rejects invalid ports', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow();
  });

  it.each(['test', 'staging', 'production'] as const)(
    'supports the %s backend environment',
    (nodeEnvironment) => {
      expect(loadConfig({ NODE_ENV: nodeEnvironment }).nodeEnvironment).toBe(nodeEnvironment);
    },
  );

  it('rejects unknown backend environments', () => {
    expect(() => loadConfig({ NODE_ENV: 'preview' })).toThrow();
  });
});
