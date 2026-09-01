import { describe, expect, it } from 'vitest';

import { validateTestDatabaseURL } from '../scripts/test-database-safety.js';

describe('integration database reset boundary', () => {
  it('allows an explicitly named local test database', () => {
    const value = 'postgresql://lauver:local@localhost:5432/lauver_test';
    expect(validateTestDatabaseURL(value, false)).toBe(value);
  });

  it('refuses to reset a database without the test suffix', () => {
    expect(() =>
      validateTestDatabaseURL('postgresql://lauver:local@localhost:5432/lauver', false),
    ).toThrow('does not end in `_test`');
  });

  it('refuses to reset a remote test database without an explicit override', () => {
    expect(() =>
      validateTestDatabaseURL('postgresql://lauver:local@db.example.com:5432/lauver_test', false),
    ).toThrow('Refusing to reset a remote database');
  });

  it('allows an explicitly authorized remote test database', () => {
    const value = 'postgresql://lauver:local@db.example.com:5432/lauver_test';
    expect(validateTestDatabaseURL(value, true)).toBe(value);
  });
});
