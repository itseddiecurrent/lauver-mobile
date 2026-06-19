import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './useAuth';
import {
  getMatchCandidates,
  recordSwipe,
  getTodayLikesCount,
  getMyMatches,
  unmatch,
  updateMatchPrefs,
  updateLocation,
} from '../lib/match';

const FILTERS_KEY    = '@lauver_match_filters';
const DAILY_LIMIT    = 15;
const DEFAULT_FILTERS = { gender: 'all', maxKm: 25, sports: [] };

export function useMatch() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  // ── candidates & matches ──────────────────────────────────────────────────
  const [candidates,     setCandidates]     = useState([]);
  const [matches,        setMatches]        = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [swiping,        setSwiping]        = useState(false);

  // ── filter state ──────────────────────────────────────────────────────────
  const [filters,        setFilters]        = useState(DEFAULT_FILTERS);
  const [filtersReady,   setFiltersReady]   = useState(false);

  // ── location ──────────────────────────────────────────────────────────────
  const [locationPerm,   setLocationPerm]   = useState('undetermined'); // 'granted'|'denied'|'undetermined'

  // ── daily like limit ──────────────────────────────────────────────────────
  const [likesRemaining, setLikesRemaining] = useState(DAILY_LIMIT);
  const [dailyLimitHit,  setDailyLimitHit]  = useState(false);

  // ── match toast ───────────────────────────────────────────────────────────
  const [lastMatchResult, setLastMatchResult] = useState(null);
  // { matchId, matchedWith: { id, name, photo } }

  // ── onboarding (pref_gender not set yet) ─────────────────────────────────
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  const loadingRef = useRef(false);

  // ── load persisted filters from AsyncStorage ──────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(FILTERS_KEY)
      .then(raw => {
        if (raw) setFilters({ ...DEFAULT_FILTERS, ...JSON.parse(raw) });
      })
      .catch(() => {})
      .finally(() => setFiltersReady(true));
  }, []);

  // ── request location & write to profile ───────────────────────────────────
  const requestLocation = useCallback(async () => {
    if (!uid) return;
    try {
      const Location = require('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationPerm(status);
      if (status !== 'granted') return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await updateLocation(uid, {
        latitude:  pos.coords.latitude,
        longitude: pos.coords.longitude,
      }).catch(() => {});
    } catch {
      // expo-location not available (e.g. test env or bare RN without native module)
      setLocationPerm('denied');
    }
  }, [uid]);

  // ── load candidates + matches + today's like count ────────────────────────
  const load = useCallback(async (f = filters) => {
    if (!uid || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const [cands, myMatches, todayLikes] = await Promise.all([
        getMatchCandidates(uid, f).catch(() => []),
        getMyMatches(uid).catch(() => []),
        getTodayLikesCount(uid).catch(() => 0),
      ]);
      setCandidates(cands);
      setMatches(myMatches);
      const remaining = Math.max(0, DAILY_LIMIT - todayLikes);
      setLikesRemaining(remaining);
      setDailyLimitHit(remaining === 0);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [uid, filters]);

  // initial load: location first, then candidates
  useEffect(() => {
    if (!uid || !filtersReady) return;
    (async () => {
      await requestLocation();
      await load(filters);
    })();
  }, [uid, filtersReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── check if user needs onboarding (pref_gender not set) ─────────────────
  useEffect(() => {
    if (!uid) return;
    const { supabase } = require('../lib/supabase');
    supabase
      .from('profiles')
      .select('pref_gender, visible_in_match')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data }) => {
        if (!data?.pref_gender || data.pref_gender === 'all' && data.visible_in_match === false) {
          setNeedsOnboarding(true);
        }
      })
      .catch(() => {});
  }, [uid]);

  // ── applyFilters ──────────────────────────────────────────────────────────
  const applyFilters = useCallback(async (newFilters) => {
    const merged = { ...DEFAULT_FILTERS, ...newFilters };
    setFilters(merged);
    await AsyncStorage.setItem(FILTERS_KEY, JSON.stringify(merged)).catch(() => {});
    await load(merged);
  }, [load]);

  // ── swipeRight ────────────────────────────────────────────────────────────
  const swipeRight = useCallback(async (target) => {
    if (!uid || swiping) return;
    if (dailyLimitHit || likesRemaining <= 0) {
      setDailyLimitHit(true);
      return;
    }

    setSwiping(true);
    // optimistic remove
    setCandidates(prev => prev.filter(c => c.id !== target.id));

    try {
      const result = await recordSwipe(uid, target.id, 'right');

      if (result.error === 'daily_limit') {
        setLikesRemaining(0);
        setDailyLimitHit(true);
        return;
      }

      setLikesRemaining(prev => Math.max(0, prev - 1));

      if (result.matched && result.matchId) {
        setLastMatchResult({
          matchId:     result.matchId,
          matchedWith: {
            id:    target.id,
            name:  target.display_name ?? target.first_name ?? 'Someone',
            photo: target.photos?.[0] ?? null,
          },
        });
        // refresh matches list
        getMyMatches(uid).then(setMatches).catch(() => {});
      }
    } catch {
      // restore candidate on network error
      setCandidates(prev => [target, ...prev]);
    } finally {
      setSwiping(false);
    }
  }, [uid, swiping, dailyLimitHit, likesRemaining]);

  // ── swipeLeft ─────────────────────────────────────────────────────────────
  const swipeLeft = useCallback(async (target) => {
    if (!uid || swiping) return;
    setSwiping(true);
    setCandidates(prev => prev.filter(c => c.id !== target.id));
    try {
      await recordSwipe(uid, target.id, 'left');
    } catch {
      setCandidates(prev => [target, ...prev]);
    } finally {
      setSwiping(false);
    }
  }, [uid, swiping]);

  // ── unmatch ───────────────────────────────────────────────────────────────
  const doUnmatch = useCallback(async (matchId) => {
    if (!uid) return;
    await unmatch(uid, matchId);
    setMatches(prev => prev.filter(m => m.match_id !== matchId));
  }, [uid]);

  // ── match prefs ───────────────────────────────────────────────────────────
  const saveMatchPrefs = useCallback(async (prefs) => {
    if (!uid) return;
    await updateMatchPrefs(uid, prefs);
    if (prefs.prefGender !== undefined && needsOnboarding) {
      setNeedsOnboarding(false);
    }
  }, [uid, needsOnboarding]);

  // ── dismiss match toast ───────────────────────────────────────────────────
  const dismissMatchResult = useCallback(() => setLastMatchResult(null), []);

  return {
    // data
    candidates,
    matches,
    filters,
    // ui state
    loading,
    swiping,
    likesRemaining,
    dailyLimitHit,
    locationPerm,
    needsOnboarding,
    lastMatchResult,
    // actions
    swipeRight,
    swipeLeft,
    doUnmatch,
    applyFilters,
    saveMatchPrefs,
    requestLocation,
    dismissMatchResult,
    refresh: () => load(filters),
  };
}
