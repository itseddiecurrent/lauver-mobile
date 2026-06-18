import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import {
  getWeekStats,
  getWeeklyChart,
  getRecentActivities,
  getMonthStats,
} from '../lib/activities';
import { getMutualMatches } from '../lib/match';
import { getFeed }          from '../lib/community';
import { syncEvents }       from '../lib/syncEvents';

const DEFAULT = {
  weekStats:        { count: 0, totalDistanceKm: 0, totalDurationSeconds: 0 },
  weeklyChart:      [],
  recentActivities: [],
  monthStats:       { count: 0, totalDistanceKm: 0 },
  matchCount:       null,   // null = not yet loaded
  latestPost:       null,   // null = no posts or not yet loaded
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
      const [weekStats, weeklyChart, recentActivities, monthStats, mutualMatches, feed] =
        await Promise.all([
          getWeekStats(user.uid).catch(() => DEFAULT.weekStats),
          getWeeklyChart(user.uid).catch(() => DEFAULT.weeklyChart),
          getRecentActivities(user.uid, 3).catch(() => DEFAULT.recentActivities),
          getMonthStats(user.uid).catch(() => DEFAULT.monthStats),
          getMutualMatches(user.uid).catch(() => []),
          getFeed(user.uid, 1).catch(() => []),
        ]);

      setData({
        weekStats,
        weeklyChart,
        recentActivities,
        monthStats,
        matchCount: mutualMatches.length,
        latestPost: feed[0] ?? null,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Re-fetch whenever any platform finishes syncing activities
  useEffect(() => {
    syncEvents.on('activitiesChanged', load);
    return () => syncEvents.off('activitiesChanged', load);
  }, [load]);

  return { ...data, loading, error, refresh: load };
}
