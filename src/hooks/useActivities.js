import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { getAllTimeStats, getDistanceChartData, getActivitiesList } from '../lib/activities';

const SPORT_MAP = {
  'All':     null,
  'Run':     'running',
  'Ride':    'cycling',
  'Climb':   'climbing',
  'Swim':    'swimming',
};

const EMPTY_STATS = { count: 0, totalDistanceKm: 0, longestKm: null, bestPaceSecPerKm: null };

export function useActivities() {
  const { user } = useAuth();

  const [allTimeStats,  setAllTimeStats]  = useState(EMPTY_STATS);
  const [chartData,     setChartData]     = useState([]);
  const [activities,    setActivities]    = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [chartLoading,  setChartLoading]  = useState(false);
  const [activePeriod,  setActivePeriod]  = useState('Month');
  const [activeFilter,  setActiveFilter]  = useState('All');

  // Initial load: all-time stats + full list
  const loadInitial = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    const [stats, list] = await Promise.all([
      getAllTimeStats(user.id).catch(() => EMPTY_STATS),
      getActivitiesList(user.id, null).catch(() => []),
    ]);
    setAllTimeStats(stats);
    setActivities(list);
    setLoading(false);
  }, [user]);

  // Reload chart when period changes
  const loadChart = useCallback(async () => {
    if (!user) return;
    setChartLoading(true);
    const data = await getDistanceChartData(user.id, activePeriod).catch(() => []);
    setChartData(data);
    setChartLoading(false);
  }, [user, activePeriod]);

  // Reload list when sport filter changes
  const loadFiltered = useCallback(async () => {
    if (!user) return;
    const sport = SPORT_MAP[activeFilter];
    const list  = await getActivitiesList(user.id, sport).catch(() => []);
    setActivities(list);
  }, [user, activeFilter]);

  useEffect(() => { loadInitial(); }, [loadInitial]);
  useEffect(() => { loadChart();   }, [loadChart]);
  useEffect(() => { loadFiltered();}, [loadFiltered]);

  return {
    allTimeStats, chartData, activities,
    loading, chartLoading,
    activePeriod, setActivePeriod,
    activeFilter, setActiveFilter,
    refresh: loadInitial,
  };
}
