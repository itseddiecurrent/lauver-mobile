/**
 * Tests for makeDistFmt and makeElevFmt from useUnits.
 * Both are pure functions that accept a unit string and return a formatter.
 */

jest.mock('../../src/lib/firebase', () => ({ firebaseAuth: {} }));
jest.mock('../../src/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
jest.mock('../../src/lib/supabase');

import { makeDistFmt, makeElevFmt, makeWeightFmt } from '../../src/hooks/useUnits';

// ─── makeDistFmt ──────────────────────────────────────────────────────────────

describe('makeDistFmt("km")', () => {
  const fmt = makeDistFmt('km');

  test('formats whole km', () => {
    expect(fmt(5)).toBe('5 km');
  });

  test('formats decimal km', () => {
    expect(fmt(10.5)).toBe('10.5 km');
  });

  test('formats 0 km', () => {
    expect(fmt(0)).toBe('0 km');
  });

  test('returns — for null', () => {
    expect(fmt(null)).toBe('—');
  });

  test('returns — for undefined', () => {
    expect(fmt(undefined)).toBe('—');
  });
});

describe('makeDistFmt("mi")', () => {
  const fmt = makeDistFmt('mi');

  test('converts 1 km ≈ 0.6 mi', () => {
    expect(fmt(1)).toBe('0.6 mi');
  });

  test('converts 10 km ≈ 6.2 mi', () => {
    expect(fmt(10)).toBe('6.2 mi');
  });

  test('converts 5 km to one decimal place', () => {
    expect(fmt(5)).toBe('3.1 mi');
  });

  test('returns — for null', () => {
    expect(fmt(null)).toBe('—');
  });

  test('mi value is always toFixed(1)', () => {
    const result = fmt(3);
    expect(result).toMatch(/^\d+\.\d mi$/);
  });
});

// ─── makeElevFmt ──────────────────────────────────────────────────────────────

describe('makeElevFmt("m")', () => {
  const fmt = makeElevFmt('m');

  test('formats metres', () => {
    expect(fmt(480)).toBe('480 m');
  });

  test('formats 0', () => {
    expect(fmt(0)).toBe('0 m');
  });

  test('returns — for null', () => {
    expect(fmt(null)).toBe('—');
  });

  test('returns — for undefined', () => {
    expect(fmt(undefined)).toBe('—');
  });
});

describe('makeElevFmt("ft")', () => {
  const fmt = makeElevFmt('ft');

  test('converts 100 m ≈ 328 ft', () => {
    expect(fmt(100)).toBe('328 ft');
  });

  test('converts 0 m = 0 ft', () => {
    expect(fmt(0)).toBe('0 ft');
  });

  test('rounds to nearest foot', () => {
    const result = fmt(1);
    expect(result).toMatch(/^\d+ ft$/);
    expect(result).toBe('3 ft');
  });

  test('returns — for null', () => {
    expect(fmt(null)).toBe('—');
  });
});

// ─── makeWeightFmt ────────────────────────────────────────────────────────────

describe('makeWeightFmt("kg")', () => {
  const fmt = makeWeightFmt('kg');

  test('formats kg', () => {
    expect(fmt(70)).toBe('70 kg');
  });

  test('formats decimal kg', () => {
    expect(fmt(70.5)).toBe('70.5 kg');
  });

  test('returns — for null', () => {
    expect(fmt(null)).toBe('—');
  });

  test('returns — for undefined', () => {
    expect(fmt(undefined)).toBe('—');
  });
});

describe('makeWeightFmt("lb")', () => {
  const fmt = makeWeightFmt('lb');

  test('converts 70 kg ≈ 154.3 lb', () => {
    expect(fmt(70)).toBe('154.3 lb');
  });

  test('converts 100 kg ≈ 220.5 lb', () => {
    expect(fmt(100)).toBe('220.5 lb');
  });

  test('returns — for null', () => {
    expect(fmt(null)).toBe('—');
  });

  test('lb value is always toFixed(1)', () => {
    const result = fmt(80);
    expect(result).toMatch(/^\d+\.\d lb$/);
  });
});

// ─── Default formatter fallback ───────────────────────────────────────────────

describe('default formatters', () => {
  test('makeDistFmt km produces correct output', () => {
    expect(makeDistFmt('km')(5.5)).toBe('5.5 km');
  });

  test('makeElevFmt m produces correct output', () => {
    expect(makeElevFmt('m')(250)).toBe('250 m');
  });

  test('makeWeightFmt kg produces correct output', () => {
    expect(makeWeightFmt('kg')(65)).toBe('65 kg');
  });
});
