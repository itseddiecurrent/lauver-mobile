import { importActivity } from '../../../src/lib/sync/importActivity';
import { __setTableData, __resetAll, supabase } from '../../../src/lib/supabase';

jest.mock('../../../src/lib/supabase');

const UID = 'user-abc';
const baseActivity = {
  sport:            'running',
  title:            'Morning Run',
  started_at:       '2026-06-10T07:00:00.000Z',
  duration_seconds: 1800,
  distance_km:      5.0,
};

beforeEach(() => __resetAll());

// ─── Layer 1: exact match ─────────────────────────────────────────────────────

describe('Layer 1: exact platform+id match', () => {
  test('returns skipped when exact match in activity_sources', async () => {
    __setTableData('activity_sources', [{ activity_id: 'existing-id' }]);
    const result = await importActivity(UID, 'strava', 'ext-001', baseActivity);
    expect(result.status).toBe('skipped');
    expect(result.activityId).toBe('existing-id');
  });

  test('does not query activities table when exact match found', async () => {
    __setTableData('activity_sources', [{ activity_id: 'existing-id' }]);
    await importActivity(UID, 'strava', 'ext-001', baseActivity);
    const tables = supabase.from.mock.calls.map(c => c[0]);
    expect(tables).not.toContain('activities');
  });
});

// ─── Layer 2: temporal fingerprint ───────────────────────────────────────────

describe('Layer 2: temporal fingerprint', () => {
  test('links when sport+time+duration match (within 10% tolerance)', async () => {
    let activitySourcesCallCount = 0;
    let activityCallCount = 0;
    supabase.from.mockImplementation((table) => {
      if (table === 'activity_sources') {
        activitySourcesCallCount++;
        if (activitySourcesCallCount === 1) {
          // First call: exact match check → no match
          return {
            select:      jest.fn().mockReturnThis(),
            eq:          jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            then:        (r) => r({ data: null, error: null }),
          };
        }
        // Second call: insert after linking
        return {
          insert: jest.fn().mockReturnThis(),
          then:   (r) => r({ data: null, error: null }),
        };
      }
      if (table === 'activities') {
        activityCallCount++;
        if (activityCallCount === 1) {
          // Temporal query → match found (same duration)
          return {
            select:      jest.fn().mockReturnThis(),
            eq:          jest.fn().mockReturnThis(),
            gte:         jest.fn().mockReturnThis(),
            lte:         jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'match-id', duration_seconds: 1800, canonical_source: 'manual' },
              error: null,
            }),
            then: (r) => r({ data: null, error: null }),
          };
        }
        // Update call (canonical source upgrade)
        return {
          update: jest.fn().mockReturnThis(),
          eq:     jest.fn().mockReturnThis(),
          then:   (r) => r({ data: null, error: null }),
        };
      }
      return { insert: jest.fn().mockReturnThis(), then: (r) => r({ data: null, error: null }) };
    });

    const result = await importActivity(UID, 'apple', 'apple-1', baseActivity);
    expect(result.status).toBe('linked');
    expect(result.activityId).toBe('match-id');
  });

  test('creates new activity when duration ratio exceeds 10% tolerance', async () => {
    let activitySourcesCallCount = 0;
    let activityCallCount = 0;
    supabase.from.mockImplementation((table) => {
      if (table === 'activity_sources') {
        activitySourcesCallCount++;
        if (activitySourcesCallCount === 1) {
          return {
            select:      jest.fn().mockReturnThis(),
            eq:          jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            then:        (r) => r({ data: null, error: null }),
          };
        }
        return { insert: jest.fn().mockReturnThis(), then: (r) => r({ data: null, error: null }) };
      }
      if (table === 'activities') {
        activityCallCount++;
        if (activityCallCount === 1) {
          return {
            select:      jest.fn().mockReturnThis(),
            eq:          jest.fn().mockReturnThis(),
            gte:         jest.fn().mockReturnThis(),
            lte:         jest.fn().mockReturnThis(),
            // Duration mismatch: 3600s vs incoming 1800s → ratio 0.5 → out of tolerance
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'other-id', duration_seconds: 3600, canonical_source: 'manual' },
              error: null,
            }),
            then: (r) => r({ data: null, error: null }),
          };
        }
        // INSERT new activity
        return {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }),
          then:   (r) => r({ data: null, error: null }),
        };
      }
      return { insert: jest.fn().mockReturnThis(), then: (r) => r({ data: null, error: null }) };
    });

    const result = await importActivity(UID, 'strava', 'str-001', baseActivity);
    expect(result.status).toBe('created');
  });
});

// ─── New activity creation ────────────────────────────────────────────────────

describe('New activity creation', () => {
  test('returns created when no match found', async () => {
    let activityCallCount = 0;
    supabase.from.mockImplementation((table) => {
      if (table === 'activity_sources') {
        return {
          select:      jest.fn().mockReturnThis(),
          eq:          jest.fn().mockReturnThis(),
          insert:      jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          then:        (r) => r({ data: null, error: null }),
        };
      }
      if (table === 'activities') {
        activityCallCount++;
        if (activityCallCount === 1) {
          return {
            select:      jest.fn().mockReturnThis(),
            eq:          jest.fn().mockReturnThis(),
            gte:         jest.fn().mockReturnThis(),
            lte:         jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }), // no temporal match
            then:        (r) => r({ data: null, error: null }),
          };
        }
        return {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: { id: 'new-act-id' }, error: null }),
          then:   (r) => r({ data: null, error: null }),
        };
      }
      return {
        insert: jest.fn().mockReturnThis(),
        then:   (r) => r({ data: null, error: null }),
      };
    });

    const result = await importActivity(UID, 'garmin', 'g-001', baseActivity);
    expect(result.status).toBe('created');
    expect(result.activityId).toBe('new-act-id');
  });

  test('throws when activity INSERT fails', async () => {
    let activityCallCount = 0;
    supabase.from.mockImplementation((table) => {
      if (table === 'activity_sources') {
        return {
          select:      jest.fn().mockReturnThis(),
          eq:          jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          then:        (r) => r({ data: null, error: null }),
        };
      }
      if (table === 'activities') {
        activityCallCount++;
        if (activityCallCount === 1) {
          return {
            select:      jest.fn().mockReturnThis(),
            eq:          jest.fn().mockReturnThis(),
            gte:         jest.fn().mockReturnThis(),
            lte:         jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            then:        (r) => r({ data: null, error: null }),
          };
        }
        return {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: { message: 'insert failed' } }),
          then:   (r) => r({ data: null, error: null }),
        };
      }
      return { insert: jest.fn().mockReturnThis(), then: (r) => r({ data: null, error: null }) };
    });

    await expect(importActivity(UID, 'garmin', 'g-002', baseActivity))
      .rejects.toThrow('insert failed');
  });
});
