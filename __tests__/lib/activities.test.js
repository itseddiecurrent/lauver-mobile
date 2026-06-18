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
import { __setTableData, __setRpcData, __resetAll, supabase } from '../../src/lib/supabase';

jest.mock('../../src/lib/supabase');

const UID = 'user-123';

beforeEach(() => __resetAll());

// ─── getWeekStats ─────────────────────────────────────────────────────────────

describe('getWeekStats', () => {
  test('returns zero stats when RPC returns nulls', async () => {
    __setRpcData('get_week_stats_for_user', { count: 0, totalDistanceKm: 0, totalDurationSeconds: 0 });
    const stats = await getWeekStats(UID);
    expect(stats).toEqual({ count: 0, totalDistanceKm: 0, totalDurationSeconds: 0 });
  });

  test('sums distance and duration from RPC response', async () => {
    __setRpcData('get_week_stats_for_user', { count: 2, totalDistanceKm: 8.5, totalDurationSeconds: 3000 });
    const stats = await getWeekStats(UID);
    expect(stats.count).toBe(2);
    expect(stats.totalDistanceKm).toBe(8.5);
    expect(stats.totalDurationSeconds).toBe(3000);
  });

  test('handles null distance gracefully (defaults to 0)', async () => {
    __setRpcData('get_week_stats_for_user', { count: 1, totalDistanceKm: null, totalDurationSeconds: 900 });
    const stats = await getWeekStats(UID);
    expect(stats.totalDistanceKm).toBe(0);
  });

  test('throws on supabase error', async () => {
    __setRpcData('get_week_stats_for_user', () => ({ data: null, error: { message: 'DB error' } }));
    await expect(getWeekStats(UID)).rejects.toMatchObject({ message: 'DB error' });
  });
});

// ─── getWeeklyChart ───────────────────────────────────────────────────────────

describe('getWeeklyChart', () => {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function makeBuckets(overrides = {}) {
    return DAYS.map((day, i) => ({ day, mins: overrides[day] ?? 0, today: i === 2 }));
  }

  test('returns exactly 7 buckets', async () => {
    __setRpcData('get_weekly_chart_for_user', makeBuckets());
    const chart = await getWeeklyChart(UID);
    expect(chart).toHaveLength(7);
  });

  test('bucket days are Mon–Sun', async () => {
    __setRpcData('get_weekly_chart_for_user', makeBuckets());
    const days = (await getWeeklyChart(UID)).map(b => b.day);
    expect(days).toEqual(DAYS);
  });

  test('passes through today flag from RPC', async () => {
    __setRpcData('get_weekly_chart_for_user', makeBuckets());
    const todayCount = (await getWeeklyChart(UID)).filter(b => b.today).length;
    expect(todayCount).toBe(1);
  });

  test('rounds fractional mins to integer', async () => {
    __setRpcData('get_weekly_chart_for_user', [{ day: 'Mon', mins: 12.6, today: false }]);
    const chart = await getWeeklyChart(UID);
    expect(chart[0].mins).toBe(13);
  });
});

// ─── getRecentActivities ──────────────────────────────────────────────────────

describe('getRecentActivities', () => {
  test('returns the data array from RPC', async () => {
    const activities = [
      { id: '1', title: 'Morning Run', sport: 'running', started_at: new Date().toISOString(), duration_seconds: 1800, distance_km: 5 },
    ];
    __setRpcData('get_recent_activities_for_user', activities);
    const result = await getRecentActivities(UID, 3);
    expect(result).toEqual(activities);
  });

  test('calls rpc with correct function name', async () => {
    __setRpcData('get_recent_activities_for_user', []);
    await getRecentActivities(UID, 5);
    expect(supabase.rpc).toHaveBeenCalledWith('get_recent_activities_for_user', { uid: UID, lim: 5 });
  });

  test('returns empty array when RPC returns null', async () => {
    __setRpcData('get_recent_activities_for_user', null);
    const result = await getRecentActivities(UID, 3);
    expect(result).toEqual([]);
  });
});

// ─── getAllTimeStats ──────────────────────────────────────────────────────────

describe('getAllTimeStats', () => {
  test('returns zero stats when RPC returns empty', async () => {
    __setRpcData('get_all_time_stats_for_user', { count: 0, totalDistanceKm: 0, longestKm: null, bestPaceSecPerKm: null });
    const stats = await getAllTimeStats(UID);
    expect(stats).toEqual({ count: 0, totalDistanceKm: 0, longestKm: null, bestPaceSecPerKm: null });
  });

  test('passes through longestKm from RPC', async () => {
    __setRpcData('get_all_time_stats_for_user', { count: 2, totalDistanceKm: 15, longestKm: 10, bestPaceSecPerKm: 360 });
    const stats = await getAllTimeStats(UID);
    expect(stats.longestKm).toBe(10);
  });

  test('passes through bestPaceSecPerKm from RPC', async () => {
    __setRpcData('get_all_time_stats_for_user', { count: 3, totalDistanceKm: 25, longestKm: 20, bestPaceSecPerKm: 300 });
    const stats = await getAllTimeStats(UID);
    expect(stats.bestPaceSecPerKm).toBeCloseTo(300, 0);
  });

  test('totalDistanceKm is rounded to 1 decimal', async () => {
    __setRpcData('get_all_time_stats_for_user', { count: 2, totalDistanceKm: 25.123, longestKm: null, bestPaceSecPerKm: null });
    const stats = await getAllTimeStats(UID);
    expect(stats.totalDistanceKm).toBe(25.1);
  });

  test('bestPaceSecPerKm is null when RPC returns null', async () => {
    __setRpcData('get_all_time_stats_for_user', { count: 1, totalDistanceKm: 20, longestKm: 20, bestPaceSecPerKm: null });
    const stats = await getAllTimeStats(UID);
    expect(stats.bestPaceSecPerKm).toBeNull();
  });
});

// ─── getDistanceChartData ─────────────────────────────────────────────────────

describe('getDistanceChartData', () => {
  test('Month period returns 4 weekly buckets', async () => {
    __setRpcData('get_activities_for_chart', []);
    const chart = await getDistanceChartData(UID, 'Month');
    expect(chart).toHaveLength(4);
    chart.forEach(b => { expect(b).toHaveProperty('label'); expect(b).toHaveProperty('km'); });
  });

  test('3 Months period returns 12 weekly buckets', async () => {
    __setRpcData('get_activities_for_chart', []);
    const chart = await getDistanceChartData(UID, '3 Months');
    expect(chart).toHaveLength(12);
  });

  test('Year period returns 12 monthly buckets', async () => {
    __setRpcData('get_activities_for_chart', []);
    const chart = await getDistanceChartData(UID, 'Year');
    expect(chart).toHaveLength(12);
    const validMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    chart.forEach(b => expect(validMonths).toContain(b.label));
  });

  test('aggregates distance from raw rows into current-week bucket', async () => {
    const now = new Date();
    __setRpcData('get_activities_for_chart', [{ started_at: now.toISOString(), distance_km: 7.5 }]);
    const chart = await getDistanceChartData(UID, 'Month');
    const total = chart.reduce((s, b) => s + b.km, 0);
    expect(total).toBeCloseTo(7.5, 1);
  });
});

// ─── getActivitiesList ────────────────────────────────────────────────────────

describe('getActivitiesList', () => {
  test('returns full list from RPC', async () => {
    const data = [{ id: '1', sport: 'running' }, { id: '2', sport: 'cycling' }];
    __setRpcData('get_activities_list_for_user', data);
    const result = await getActivitiesList(UID, null);
    expect(result).toEqual(data);
  });

  test('calls rpc with sport_filter=null when sport is null', async () => {
    __setRpcData('get_activities_list_for_user', []);
    await getActivitiesList(UID, null);
    expect(supabase.rpc).toHaveBeenCalledWith('get_activities_list_for_user', { uid: UID, sport_filter: null });
  });

  test('calls rpc with sport_filter when sport is provided', async () => {
    __setRpcData('get_activities_list_for_user', []);
    await getActivitiesList(UID, 'running');
    expect(supabase.rpc).toHaveBeenCalledWith('get_activities_list_for_user', { uid: UID, sport_filter: 'running' });
  });
});

// ─── getMonthStats ────────────────────────────────────────────────────────────

describe('getMonthStats', () => {
  test('returns count and totalDistanceKm from RPC', async () => {
    __setRpcData('get_month_stats_for_user', { count: 3, totalDistanceKm: 15 });
    const stats = await getMonthStats(UID);
    expect(stats.count).toBe(3);
    expect(stats.totalDistanceKm).toBe(15);
  });

  test('returns zeros when RPC returns empty', async () => {
    __setRpcData('get_month_stats_for_user', { count: 0, totalDistanceKm: 0 });
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
