import { describe, expect, it } from 'vitest';
import { acceptanceConnectionURL, validateAcceptanceTarget } from '../scripts/verify-step-06-staging.js';

const staging = 'https://lauver-api-staging.onrender.com';
describe('Step 06 acceptance target boundary', () => {
  it('accepts only the named staging database and configured API', () => {
    expect(validateAcceptanceTarget('postgresql://example@db.example/lauver_staging', staging)).toBe('lauver_staging');
  });
  it.each([
    ['postgresql://example@db.example/lauver_production', staging, false],
    ['postgresql://example@db.example/lauver_staging', 'https://api.lauver.ai', false],
    ['postgresql://example@db.example/lauver_staging', staging + '/other', false],
    ['postgresql://example@db.example/lauver_staging', 'http://127.0.0.1:3000', true],
    ['postgresql://example@db.example/lauver_test', 'http://127.0.0.1:3000', true],
    ['postgresql://example@127.0.0.1/lauver', 'http://127.0.0.1:3000', true],
    ['https://db.example/lauver_staging', staging, false],
  ])('rejects a mismatched or production target', (database, api, local) => {
    expect(() => validateAcceptanceTarget(database, api, local)).toThrow();
  });
  it('allows an explicit isolated local run', () => {
    expect(validateAcceptanceTarget('postgresql://example@127.0.0.1/lauver_test', 'http://127.0.0.1:3000', true)).toBe('lauver_test');
  });
});

describe('Staging PostgreSQL transport', () => {
  it.each(['', '?sslmode=disable', '?sslmode=require'])('requires verified TLS for an external staging URL %s', (query) => {
    const normalized = new URL(acceptanceConnectionURL(`postgresql://fixture:fixture@db.example/lauver_staging${query}`));
    expect(normalized.searchParams.get('sslmode')).toBe('verify-full');
    expect(normalized.pathname).toBe('/lauver_staging');
    expect(normalized.username).toBe('fixture');
    expect(normalized.password).toBe('fixture');
  });
  it('preserves the isolated local connection configuration', () => {
    const url = 'postgresql://fixture@127.0.0.1/lauver_test';
    expect(acceptanceConnectionURL(url, true)).toBe(url);
  });
});
