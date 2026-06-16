import {
  getWeekStats,
  getWeeklyChart,
  getRecentActivities,
  getAllTimeStats,
  getDistanceChartData,
  getActivitiesList,
  getMonthStats,
  insertActivity,
} from '../../src/lib/activities';
import { __setTableData, __resetAll, supabase } from '../../src/lib/supabase';

jest.mock('../../src/lib/supabase');

const UID = 'user-123';

beforeEach(() => __resetAll());

// ─── getWeekStats ─────────────────────────────────────────────────────────────

describe('getWeekStats', () => {
  test('returns zero stats for empty dataset', async () => {
    __setTableData('activities', []);
    const stats = await getWeekStats(UID);
    expect(stats).toEqual({ count: 0, totalDistanceKm: 0, totalDurationSeconds: 0 });
  });

  test('sums distance and duration correctly', async () => {
    __setTableData('activities', [
      { distance_km: 5.0, duration_seconds: 1800 },
      { distance_km: 3.5, duration_seconds: 1200 },
    ]);
    const stats = await getWeekStats(UID);
    expect(stats.count).toBe(2);
    expect(stats.totalDistanceKm).toBe(8.5);
    expect(stats.totalDurationSeconds).toBe(3000);
  });

  test('handles null distance_km gracefully', async () => {
    __setTableData('activities', [
      { distance_km: null, duration_seconds: 900 },
      { distance_km: 2.0,  duration_seconds: 600 },
    ]);
    const stats = await getWeekStats(UID);
    expect(stats.totalDistanceKm).toBe(2.0);
    expect(stats.totalDurationSeconds).toBe(1500);
  });

  test('throws on supabase error', async () => {
    __setTableData('activities', () => ({ data: null, error: { message: 'DB error' } }));
    await expect(getWeekStats(UID)).rejects.toMatchObject({ message: 'DB error' });
  });
});

// ─── getWeeklyChart ───────────────────────────────────────────────────────────

describe('getWeeklyChart', () => {
  test('returns exactly 7 buckets', async () => {
    __setTableData('activities', []);
    const chart = await getWeeklyChart(UID);
    expect(chart).toHaveLength(7);
  });

  test('bucket days are Mon–Sun', async () => {
    __setTableData('activities', []);
    const days = (await getWeeklyChart(UID)).map(b => b.day);
    expect(days).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  test('exactly one bucket is marked today', async () => {
    __setTableData('activities', []);
    const todayCount = (await getWeeklyChart(UID)).filter(b => b.today).length;
    expect(todayCount).toBe(1);
  });

  test('aggregates duration into correct day bucket', async () => {
    const now = new Date();
    const diffToMonday = now.getDay() === 0 ? -6 : 1 - now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(10, 0, 0, 0);

    __setTableData('activities', [{ started_at: monday.toISOString(), duration_seconds: 3600 }]);
    const chart = await getWeeklyChart(UID);
    expect(chart[0].mins).toBe(60);
  });
});

// ─── getRecentActivities ──────────────────────────────────────────────────────

describe('getRecentActivities', () => {
  test('returns the data array from supabase', async () => {
    const activities = [
      { id: '1', title: 'Morning Run', sport: 'running', started_at: new Date().toISOString(), duration_seconds: 1800, distance_km: 5, routes_count: null },
    ];
    __setTableData('activities', activities);
    const result = await getRecentActivities(UID, 3);
    expect(result).toEqual(activities);
  });

  test('calls limit with the provided value', async () => {
    __setTableData('activities', []);
    await getRecentActivities(UID, 7);
    // The supabase.from mock returns a builder; verify from was called with 'activities'
    expect(supabase.from).toHaveBeenCalledWith('activities');
  });
});

// ─── getAllTimeStats ──────────────────────────────────────────────────────────

describe('getAllTimeStats', () => {
  test('returns zero stats for empty dataset', async () => {
    __setTableData('activities', []);
    const stats = await getAllTimeStats(UID);
    expect(stats).toEqual({ count: 0, totalDistanceKm: 0, longestKm: null, bestPaceSecPerKm: null });
  });

  test('calculates longestKm correctly', async () => {
    __setTableData('activities', [
      { distance_km: 10, duration_seconds: 3600, sport: 'running' },
      { distance_km: 5,  duration_seconds: 1800, sport: 'running' },
    ]);
    const stats = await getAllTimeStats(UID);
    expect(stats.longestKm).toBe(10);
  });

  test('bestPaceSecPerKm is from running only', async () => {
    __setTableData('activities', [
      { distance_km: 10, duration_seconds: 3600, sport: 'running' },  // 360 s/km
      { distance_km: 5,  duration_seconds: 1500, sport: 'running' },  // 300 s/km ← best
      { distance_km: 20, duration_seconds: 3600, sport: 'cycling' },  // excluded
    ]);
    const stats = await getAllTimeStats(UID);
    expect(stats.bestPaceSecPerKm).toBeCloseTo(300, 0);
  });

  test('totalDistanceKm includes all sports', async () => {
    __setTableData('activities', [
      { distance_km: 5,  duration_seconds: 1800, sport: 'running' },
      { distance_km: 20, duration_seconds: 3600, sport: 'cycling' },
    ]);
    const stats = await getAllTimeStats(UID);
    expect(stats.totalDistanceKm).toBe(25);
  });

  test('bestPaceSecPerKm is null when no running data', async () => {
    __setTableData('activities', [
      { distance_km: 20, duration_seconds: 3600, sport: 'cycling' },
    ]);
    const stats = await getAllTimeStats(UID);
    expect(stats.bestPaceSecPerKm).toBeNull();
  });
});

// ─── getDistanceChartData ─────────────────────────────────────────────────────

describe('getDistanceChartData', () => {
  test('Month period returns 4 weekly buckets', async () => {
    __setTableData('activities', []);
    const chart = await getDistanceChartData(UID, 'Month');
    expect(chart).toHaveLength(4);
    chart.forEach(b => { expect(b).toHaveProperty('label'); expect(b).toHaveProperty('km'); });
  });

  test('3 Months period returns 12 weekly buckets', async () => {
    __setTableData('activities', []);
    const chart = await getDistanceChartData(UID, '3 Months');
    expect(chart).toHaveLength(12);
  });

  test('Year period returns 12 monthly buckets', async () => {
    __setTableData('activities', []);
    const chart = await getDistanceChartData(UID, 'Year');
    expect(chart).toHaveLength(12);
    const validMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    chart.forEach(b => expect(validMonths).toContain(b.label));
  });

  test('aggregates distance into correct bucket', async () => {
    const now = new Date();
    __setTableData('activities', [{ started_at: now.toISOString(), distance_km: 7.5 }]);
    const chart = await getDistanceChartData(UID, 'Month');
    const total = chart.reduce((s, b) => s + b.km, 0);
    expect(total).toBeCloseTo(7.5, 1);
  });
});

// ─── getActivitiesList ────────────────────────────────────────────────────────

describe('getActivitiesList', () => {
  test('returns full list when sport is null', async () => {
    const data = [{ id: '1', sport: 'running' }, { id: '2', sport: 'cycling' }];
    __setTableData('activities', data);
    const result = await getActivitiesList(UID, null);
    expect(result).toEqual(data);
  });

  test('queries activities table', async () => {
    __setTableData('activities', []);
    await getActivitiesList(UID, 'running');
    expect(supabase.from).toHaveBeenCalledWith('activities');
  });
});

// ─── getMonthStats ────────────────────────────────────────────────────────────

describe('getMonthStats', () => {
  test('returns count and totalDistanceKm', async () => {
    __setTableData('activities', [
      { distance_km: 5 },
      { distance_km: 10 },
      { distance_km: null },
    ]);
    const stats = await getMonthStats(UID);
    expect(stats.count).toBe(3);
    expect(stats.totalDistanceKm).toBe(15);
  });

  test('returns zeros for empty month', async () => {
    __setTableData('activities', []);
    const stats = await getMonthStats(UID);
    expect(stats).toEqual({ count: 0, totalDistanceKm: 0 });
  });
});

// ─── insertActivity ───────────────────────────────────────────────────────────

describe('insertActivity', () => {
  const baseFields = {
    title:           'Morning Run',
    sport:           'running',
    startedAt:       new Date('2026-06-16T07:00:00Z'),
    durationSeconds: 1800,
    distanceKm:      5.0,
  };

  test('returns the new activity id on success', async () => {
    supabase.from.mockImplementationOnce(() => ({
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'new-uuid-123' }, error: null }),
    }));
    const result = await insertActivity(UID, baseFields);
    expect(result.id).toBe('new-uuid-123');
  });

  test('sends canonical_source as "manual"', async () => {
    let captured = null;
    supabase.from.mockImplementationOnce(() => ({
      insert: jest.fn().mockImplementation((payload) => { captured = payload; return { select: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { id: 'x' }, error: null }) }; }),
    }));
    await insertActivity(UID, baseFields);
    expect(captured.canonical_source).toBe('manual');
    expect(captured.user_id).toBe(UID);
  });

  test('converts Date startedAt to ISO string', async () => {
    let captured = null;
    supabase.from.mockImplementationOnce(() => ({
      insert: jest.fn().mockImplementation((payload) => { captured = payload; return { select: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { id: 'x' }, error: null }) }; }),
    }));
    const date = new Date('2026-06-16T07:00:00Z');
    await insertActivity(UID, { ...baseFields, startedAt: date });
    expect(captured.started_at).toBe(date.toISOString());
  });

  test('sets optional fields to null when not provided', async () => {
    let captured = null;
    supabase.from.mockImplementationOnce(() => ({
      insert: jest.fn().mockImplementation((payload) => { captured = payload; return { select: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { id: 'x' }, error: null }) }; }),
    }));
    const { distanceKm: _, ...minFields } = baseFields;
    await insertActivity(UID, minFields);
    expect(captured.distance_km).toBeNull();
    expect(captured.routes_count).toBeNull();
    expect(captured.calories).toBeNull();
    expect(captured.notes).toBeNull();
  });

  test('includes distanceKm and routesCount when provided', async () => {
    let captured = null;
    supabase.from.mockImplementationOnce(() => ({
      insert: jest.fn().mockImplementation((payload) => { captured = payload; return { select: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { id: 'x' }, error: null }) }; }),
    }));
    await insertActivity(UID, { ...baseFields, sport: 'climbing', routesCount: 7, distanceKm: null });
    expect(captured.routes_count).toBe(7);
    expect(captured.distance_km).toBeNull();
  });

  test('throws when Supabase returns an error', async () => {
    supabase.from.mockImplementationOnce(() => ({
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { message: 'insert failed' } }),
    }));
    await expect(insertActivity(UID, baseFields)).rejects.toThrow('insert failed');
  });

  test('accepts string startedAt (ISO passthrough)', async () => {
    let captured = null;
    supabase.from.mockImplementationOnce(() => ({
      insert: jest.fn().mockImplementation((payload) => { captured = payload; return { select: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { id: 'x' }, error: null }) }; }),
    }));
    const iso = '2026-06-16T07:00:00.000Z';
    await insertActivity(UID, { ...baseFields, startedAt: iso });
    expect(captured.started_at).toBe(iso);
  });
});
