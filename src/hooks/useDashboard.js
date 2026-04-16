import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import {
  getWeekStats,
  getWeeklyChart,
  getRecentActivities,
  getMonthStats,
} from '../lib/activities';

const DEFAULT = {
  weekStats:          { count: 0, totalDistanceKm: 0, totalDurationSeconds: 0 },
  weeklyChart:        [],
  recentActivities:   [],
  monthStats:         { count: 0, totalDistanceKm: 0 },
};

export function useDashboard() {
  const { user } = useAuth();
  const [data,    setData]    = useState(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [weekStats, weeklyChart, recentActivities, monthStats] = await Promise.all([
        getWeekStats(user.id).catch(() => DEFAULT.weekStats),
        getWeeklyChart(user.id).catch(() => DEFAULT.weeklyChart),
        getRecentActivities(user.id, 3).catch(() => DEFAULT.recentActivities),
        getMonthStats(user.id).catch(() => DEFAULT.monthStats),
      ]);
      setData({ weekStats, weeklyChart, recentActivities, monthStats });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  return { ...data, loading, error, refresh: load };
}
