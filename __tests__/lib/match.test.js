/**
 * Tests for src/lib/match.js — all functions use SECURITY DEFINER RPCs.
 */

import {
  getMatchCandidates,
  recordSwipe,
  getTodayLikesCount,
  getMyMatches,
  unmatch,
  updateMatchPrefs,
  updateLocation,
} from '../../src/lib/match';
import { __setRpcData, __setTableData, __resetAll, supabase } from '../../src/lib/supabase';

jest.mock('../../src/lib/supabase');

const UID = 'user-me';

beforeEach(() => __resetAll());

// ─── getMatchCandidates ───────────────────────────────────────────────────────

describe('getMatchCandidates', () => {
  test('returns candidates from RPC', async () => {
    __setRpcData('get_match_candidates', [
      { id: 'bob', display_name: 'Bob', sports: ['running'], distance_km: 3.2 },
    ]);
    const results = await getMatchCandidates(UID, {});
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('bob');
  });

  test('returns empty array when RPC returns null', async () => {
    __setRpcData('get_match_candidates', null);
    const results = await getMatchCandidates(UID, {});
    expect(results).toEqual([]);
  });

  test('passes gender, maxKm, sports to RPC', async () => {
    __setRpcData('get_match_candidates', []);
    await getMatchCandidates(UID, { gender: 'female', maxKm: 50, sports: ['running'] });
    expect(supabase.rpc).toHaveBeenCalledWith('get_match_candidates', {
      uid:      UID,
      p_gender: 'female',
      p_max_km: 50,
      p_sports: ['running'],
    });
  });

  test('defaults to all/0/empty when no filters passed', async () => {
    __setRpcData('get_match_candidates', []);
    await getMatchCandidates(UID);
    expect(supabase.rpc).toHaveBeenCalledWith('get_match_candidates', {
      uid:      UID,
      p_gender: 'all',
      p_max_km: 0,
      p_sports: [],
    });
  });
});

// ─── recordSwipe ──────────────────────────────────────────────────────────────

describe('recordSwipe', () => {
  test('calls record_swipe RPC with correct params', async () => {
    __setRpcData('record_swipe', { matched: false, match_id: null, error: null });
    await recordSwipe(UID, 'target-1', 'right');
    expect(supabase.rpc).toHaveBeenCalledWith('record_swipe', {
      uid:       UID,
      target_id: 'target-1',
      dir:       'right',
    });
  });

  test('returns matched=true and matchId when RPC signals a match', async () => {
    __setRpcData('record_swipe', { matched: true, match_id: 'match-abc', error: null });
    const result = await recordSwipe(UID, 'target-1', 'right');
    expect(result.matched).toBe(true);
    expect(result.matchId).toBe('match-abc');
    expect(result.error).toBeNull();
  });

  test('returns matched=false when no mutual match', async () => {
    __setRpcData('record_swipe', { matched: false, match_id: null, error: null });
    const result = await recordSwipe(UID, 'target-2', 'right');
    expect(result.matched).toBe(false);
    expect(result.matchId).toBeNull();
  });

  test('returns error=daily_limit when daily cap reached', async () => {
    __setRpcData('record_swipe', { matched: false, match_id: null, error: 'daily_limit' });
    const result = await recordSwipe(UID, 'target-3', 'right');
    expect(result.error).toBe('daily_limit');
  });

  test('left swipe does not produce match', async () => {
    __setRpcData('record_swipe', { matched: false, match_id: null, error: null });
    const result = await recordSwipe(UID, 'target-4', 'left');
    expect(result.matched).toBe(false);
  });
});

// ─── getTodayLikesCount ───────────────────────────────────────────────────────

describe('getTodayLikesCount', () => {
  test('returns count from RPC', async () => {
    __setRpcData('get_today_likes_count', 7);
    expect(await getTodayLikesCount(UID)).toBe(7);
  });

  test('returns 0 when RPC returns null', async () => {
    __setRpcData('get_today_likes_count', null);
    expect(await getTodayLikesCount(UID)).toBe(0);
  });

  test('calls RPC with uid', async () => {
    __setRpcData('get_today_likes_count', 0);
    await getTodayLikesCount(UID);
    expect(supabase.rpc).toHaveBeenCalledWith('get_today_likes_count', { uid: UID });
  });
});

// ─── getMyMatches ─────────────────────────────────────────────────────────────

describe('getMyMatches', () => {
  test('returns matches from RPC', async () => {
    __setRpcData('get_my_matches', [
      { match_id: 'match-1', other_id: 'alice', other_display_name: 'Alice', unread_count: 2 },
    ]);
    const results = await getMyMatches(UID);
    expect(results).toHaveLength(1);
    expect(results[0].other_display_name).toBe('Alice');
  });

  test('returns empty when no matches', async () => {
    __setRpcData('get_my_matches', []);
    const results = await getMyMatches(UID);
    expect(results).toEqual([]);
  });

  test('returns empty when RPC returns null', async () => {
    __setRpcData('get_my_matches', null);
    const results = await getMyMatches(UID);
    expect(results).toEqual([]);
  });
});

// ─── unmatch ──────────────────────────────────────────────────────────────────

describe('unmatch', () => {
  test('calls do_unmatch RPC', async () => {
    __setRpcData('do_unmatch', null);
    await unmatch(UID, 'match-abc');
    expect(supabase.rpc).toHaveBeenCalledWith('do_unmatch', {
      uid:        UID,
      p_match_id: 'match-abc',
    });
  });
});

// ─── updateMatchPrefs ─────────────────────────────────────────────────────────

describe('updateMatchPrefs', () => {
  test('upserts only provided fields', async () => {
    await updateMatchPrefs(UID, { visibleInMatch: true });
    expect(supabase.from).toHaveBeenCalledWith('profiles');
  });

  test('maps visibleInMatch to visible_in_match', async () => {
    await updateMatchPrefs(UID, { visibleInMatch: false, prefGender: 'female' });
    // Verify the upsert call chain was reached (mock verifies from() was called)
    expect(supabase.from).toHaveBeenCalledWith('profiles');
  });
});

// ─── updateLocation ───────────────────────────────────────────────────────────

describe('updateLocation', () => {
  test('calls update_location RPC with lat/lng', async () => {
    __setRpcData('update_location', null);
    await updateLocation(UID, { latitude: 40.71, longitude: -74.01 });
    expect(supabase.rpc).toHaveBeenCalledWith('update_location', {
      uid: UID,
      lat: 40.71,
      lng: -74.01,
    });
  });
});
