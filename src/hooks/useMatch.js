import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import {
  getMatchReadiness,
  getMatchCandidates,
  recordSwipe,
  getMutualMatches,
} from '../lib/match';

export function useMatch() {
  const { user } = useAuth();

  const [readiness,  setReadiness]  = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [matches,    setMatches]    = useState([]);
  const [loading,    setLoading]    = useState(true);

  // Active filter state (passed to getMatchCandidates)
  const [sportFilters, setSportFilters] = useState([]);
  const [skillFilters, setSkillFilters] = useState([]);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);

    const [readinessData, matchesData] = await Promise.all([
      getMatchReadiness(user).catch(() => []),
      getMutualMatches(user.id).catch(() => []),
    ]);

    setReadiness(readinessData);
    setMatches(matchesData);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Fetch candidates whenever filters change and matching is unlocked
  const loadCandidates = useCallback(async (sports = [], skills = []) => {
    if (!user) return;
    const data = await getMatchCandidates(user.id, { sports, skills }).catch(() => []);
    setCandidates(data);
  }, [user]);

  const isReady = readiness.length > 0 && readiness.every(c => c.done);

  // Load candidates once unlocked
  useEffect(() => {
    if (isReady) loadCandidates(sportFilters, skillFilters);
  }, [isReady, loadCandidates, sportFilters, skillFilters]);

  const handleSwipe = useCallback(async (targetId, action) => {
    if (!user) return;
    // Remove from local list immediately
    setCandidates(prev => prev.filter(c => c.id !== targetId));
    await recordSwipe(user.id, targetId, action).catch(() => {});
    // If liked/starred, refresh mutual matches in case it's mutual
    if (action !== 'pass') {
      getMutualMatches(user.id).then(setMatches).catch(() => {});
    }
  }, [user]);

  return {
    readiness,
    isReady,
    candidates,
    matches,
    loading,
    sportFilters, setSportFilters,
    skillFilters, setSkillFilters,
    handleSwipe,
    refresh: load,
  };
}
