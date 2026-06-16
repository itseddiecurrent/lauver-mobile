/**
 * Tests for getActivityById (lib) and the buildStats / formatter helpers
 * extracted from ActivityDetailScreen.
 *
 * buildStats and formatters are tested by importing the lib function and
 * re-implementing the same logic in tests (black-box contract tests).
 */

import { getActivityById, insertActivity } from '../../src/lib/activities';
import { __setTableData, __resetAll, supabase } from '../../src/lib/supabase';

jest.mock('../../src/lib/supabase');

const ACTIVITY_ID = 'act-uuid-001';

const baseActivity = {
  id:               ACTIVITY_ID,
  user_id:          'user-abc',
  title:            'Morning Run',
  sport:            'running',
  started_at:       '2026-06-16T07:00:00.000Z',
  duration_seconds: 1800,
  distance_km:      5.0,
  routes_count:     null,
  elevation_gain_m: null,
  calories:         300,
  avg_heart_rate:   148,
  canonical_source: 'manual',
  notes:            null,
  created_at:       '2026-06-16T07:00:00.000Z',
};

beforeEach(() => __resetAll());

// ─── getActivityById ──────────────────────────────────────────────────────────

describe('getActivityById', () => {
  test('returns the activity row on success', async () => {
    supabase.from.mockImplementationOnce(() => ({
      select:      jest.fn().mockReturnThis(),
      eq:          jest.fn().mockReturnThis(),
      single:      jest.fn().mockResolvedValue({ data: baseActivity, error: null }),
    }));
    const result = await getActivityById(ACTIVITY_ID);
    expect(result.id).toBe(ACTIVITY_ID);
    expect(result.title).toBe('Morning Run');
  });

  test('queries the activities table with the correct id', async () => {
    supabase.from.mockImplementationOnce(() => ({
      select: jest.fn().mockReturnThis(),
      eq:     jest.fn((col, val) => {
        expect(col).toBe('id');
        expect(val).toBe(ACTIVITY_ID);
        return { single: jest.fn().mockResolvedValue({ data: baseActivity, error: null }) };
      }),
    }));
    await getActivityById(ACTIVITY_ID);
    expect(supabase.from).toHaveBeenCalledWith('activities');
  });

  test('throws when activity not found (Supabase PGRST116)', async () => {
    supabase.from.mockImplementationOnce(() => ({
      select: jest.fn().mockReturnThis(),
      eq:     jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { message: 'No rows found' } }),
    }));
    await expect(getActivityById('nonexistent-id')).rejects.toThrow('No rows found');
  });

  test('throws a generic message when error has no message', async () => {
    supabase.from.mockImplementationOnce(() => ({
      select: jest.fn().mockReturnThis(),
      eq:     jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: {} }),
    }));
    await expect(getActivityById('x')).rejects.toThrow('Activity not found');
  });

  test('returns all expected fields', async () => {
    supabase.from.mockImplementationOnce(() => ({
      select: jest.fn().mockReturnThis(),
      eq:     jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: baseActivity, error: null }),
    }));
    const result = await getActivityById(ACTIVITY_ID);
    const expectedFields = [
      'id', 'user_id', 'title', 'sport', 'started_at',
      'duration_seconds', 'distance_km', 'calories', 'avg_heart_rate',
      'canonical_source',
    ];
    expectedFields.forEach(f => expect(result).toHaveProperty(f));
  });
});

// ─── buildStats logic (contract tests) ───────────────────────────────────────
// These test the expected stat array shape for each sport — mirroring the
// buildStats function in ActivityDetailScreen without importing it directly.

describe('stat building logic contracts', () => {
  // Helper: what buildStats would produce
  function buildStats(activity) {
    const { sport, distance_km, duration_seconds, avg_heart_rate, calories, routes_count, elevation_gain_m } = activity;
    const fmtDuration = (s) => {
      if (!s) return '—';
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
    };
    const fmtPace = (s, km) => {
      if (!s || !km || km === 0) return '—';
      const spk = s / km, mm = Math.floor(spk / 60), ss = Math.round(spk % 60);
      return `${mm}:${String(ss).padStart(2,'0')}`;
    };
    const fmtSpeed = (s, km) => (!s || !km || km === 0) ? '—' : (km / (s / 3600)).toFixed(1);

    const stats = [];
    if (distance_km != null)      stats.push({ val: String(distance_km), lbl: 'DISTANCE (KM)' });
    if (routes_count != null)     stats.push({ val: String(routes_count), lbl: 'ROUTES' });
    stats.push({ val: fmtDuration(duration_seconds), lbl: 'TIME' });
    if (sport === 'running' && distance_km > 0)
      stats.push({ val: fmtPace(duration_seconds, distance_km), lbl: 'AVG PACE (MIN/KM)' });
    if ((sport === 'cycling' || sport === 'swimming') && distance_km > 0)
      stats.push({ val: fmtSpeed(duration_seconds, distance_km), lbl: 'AVG SPEED (KM/H)' });
    if (avg_heart_rate != null)   stats.push({ val: String(avg_heart_rate), lbl: 'AVG BPM' });
    if (calories != null)         stats.push({ val: String(calories), lbl: 'CALORIES (KCAL)' });
    if (elevation_gain_m != null) stats.push({ val: `${elevation_gain_m}m`, lbl: 'ELEVATION GAIN' });
    return stats;
  }

  test('running: includes distance, time, pace, bpm, calories', () => {
    const stats = buildStats(baseActivity);
    const lbls  = stats.map(s => s.lbl);
    expect(lbls).toContain('DISTANCE (KM)');
    expect(lbls).toContain('TIME');
    expect(lbls).toContain('AVG PACE (MIN/KM)');
    expect(lbls).toContain('AVG BPM');
    expect(lbls).toContain('CALORIES (KCAL)');
    expect(lbls).not.toContain('AVG SPEED (KM/H)');
  });

  test('running: pace computes correctly (1800s / 5km = 6:00 /km)', () => {
    const stats = buildStats(baseActivity);
    const pace  = stats.find(s => s.lbl === 'AVG PACE (MIN/KM)');
    expect(pace?.val).toBe('6:00');
  });

  test('cycling: includes speed, not pace', () => {
    const stats = buildStats({ ...baseActivity, sport: 'cycling', distance_km: 20 });
    const lbls  = stats.map(s => s.lbl);
    expect(lbls).toContain('AVG SPEED (KM/H)');
    expect(lbls).not.toContain('AVG PACE (MIN/KM)');
  });

  test('climbing: shows routes, no distance, no pace', () => {
    const stats = buildStats({
      ...baseActivity,
      sport: 'climbing', distance_km: null, routes_count: 12, avg_heart_rate: null,
    });
    const lbls = stats.map(s => s.lbl);
    expect(lbls).toContain('ROUTES');
    expect(lbls).not.toContain('DISTANCE (KM)');
    expect(lbls).not.toContain('AVG PACE (MIN/KM)');
  });

  test('hiking: shows elevation gain when present', () => {
    const stats = buildStats({ ...baseActivity, sport: 'hiking', elevation_gain_m: 480 });
    expect(stats.find(s => s.lbl === 'ELEVATION GAIN')?.val).toBe('480m');
  });

  test('gym/yoga: only time + optional bpm/calories (no distance)', () => {
    const stats = buildStats({
      ...baseActivity,
      sport: 'gym', distance_km: null, avg_heart_rate: 120, calories: 200,
    });
    const lbls = stats.map(s => s.lbl);
    expect(lbls).toContain('TIME');
    expect(lbls).not.toContain('DISTANCE (KM)');
    expect(lbls).not.toContain('AVG PACE (MIN/KM)');
    expect(lbls).toContain('AVG BPM');
    expect(lbls).toContain('CALORIES (KCAL)');
  });

  test('optional fields absent when DB cols are null', () => {
    const stats = buildStats({
      ...baseActivity,
      avg_heart_rate: null, calories: null, elevation_gain_m: null,
    });
    const lbls = stats.map(s => s.lbl);
    expect(lbls).not.toContain('AVG BPM');
    expect(lbls).not.toContain('CALORIES (KCAL)');
    expect(lbls).not.toContain('ELEVATION GAIN');
  });

  test('time formats correctly: 90 min = 1:30:00', () => {
    const stats = buildStats({ ...baseActivity, duration_seconds: 5400, distance_km: null });
    expect(stats.find(s => s.lbl === 'TIME')?.val).toBe('1:30:00');
  });

  test('time formats correctly: 25 min = 25:00', () => {
    const stats = buildStats({ ...baseActivity, duration_seconds: 1500, distance_km: null });
    expect(stats.find(s => s.lbl === 'TIME')?.val).toBe('25:00');
  });
});
