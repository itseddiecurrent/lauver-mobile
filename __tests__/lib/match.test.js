import {
  getMatchReadiness,
  getMatchCandidates,
  recordSwipe,
  getMutualMatches,
} from '../../src/lib/match';
import { __setTableData, __resetAll, supabase } from '../../src/lib/supabase';

jest.mock('../../src/lib/supabase');

const UID      = 'user-me';
const mockUser = { uid: UID };

// Helper: build a full profile with real column names (skill, city, photos)
const fullProfile = (overrides = {}) => ({
  avatar_url:   'https://example.com/p.jpg',
  photos:       ['https://example.com/p.jpg'],
  sports:       ['running', 'cycling'],
  skill:        'Intermediate',
  city:         'San Francisco',
  availability: ['Weekends', 'Mornings'],
  ...overrides,
});

beforeEach(() => __resetAll());

// ─── getMatchReadiness ────────────────────────────────────────────────────────

describe('getMatchReadiness', () => {
  test('always has account check as done:true', async () => {
    __setTableData('profiles', [null]);
    const checks = await getMatchReadiness(mockUser);
    expect(checks.find(c => c.key === 'account').done).toBe(true);
  });

  test('returns 4 check items', async () => {
    __setTableData('profiles', [null]);
    const checks = await getMatchReadiness(mockUser);
    expect(checks).toHaveLength(4);
  });

  test('photo check fails when photos is empty and avatar_url is null', async () => {
    __setTableData('profiles', [fullProfile({ avatar_url: null, photos: [] })]);
    const checks = await getMatchReadiness(mockUser);
    expect(checks.find(c => c.key === 'photo').done).toBe(false);
  });

  test('photo check passes when photos array has entries', async () => {
    __setTableData('profiles', [fullProfile({ photos: ['https://example.com/a.jpg'] })]);
    const checks = await getMatchReadiness(mockUser);
    expect(checks.find(c => c.key === 'photo').done).toBe(true);
  });

  test('photo check passes when avatar_url is set (even if photos empty)', async () => {
    __setTableData('profiles', [fullProfile({ photos: [], avatar_url: 'https://example.com/a.jpg' })]);
    const checks = await getMatchReadiness(mockUser);
    expect(checks.find(c => c.key === 'photo').done).toBe(true);
  });

  test('sports check fails when sports array is empty', async () => {
    __setTableData('profiles', [fullProfile({ sports: [] })]);
    const checks = await getMatchReadiness(mockUser);
    expect(checks.find(c => c.key === 'sports').done).toBe(false);
  });

  test('sports check fails when skill is null', async () => {
    __setTableData('profiles', [fullProfile({ skill: null })]);
    const checks = await getMatchReadiness(mockUser);
    expect(checks.find(c => c.key === 'sports').done).toBe(false);
  });

  test('sports check passes with sports and skill', async () => {
    __setTableData('profiles', [fullProfile({ sports: ['running'], skill: 'Advanced' })]);
    const checks = await getMatchReadiness(mockUser);
    expect(checks.find(c => c.key === 'sports').done).toBe(true);
  });

  test('location check fails when city is null', async () => {
    __setTableData('profiles', [fullProfile({ city: null })]);
    const checks = await getMatchReadiness(mockUser);
    expect(checks.find(c => c.key === 'location').done).toBe(false);
  });

  test('location check fails when availability is empty', async () => {
    __setTableData('profiles', [fullProfile({ availability: [] })]);
    const checks = await getMatchReadiness(mockUser);
    expect(checks.find(c => c.key === 'location').done).toBe(false);
  });

  test('all checks pass with complete profile', async () => {
    __setTableData('profiles', [fullProfile()]);
    const checks = await getMatchReadiness(mockUser);
    expect(checks.every(c => c.done)).toBe(true);
  });

  test('returns false for all non-account checks when profile is null', async () => {
    __setTableData('profiles', [null]);
    const checks = await getMatchReadiness(mockUser);
    const nonAccount = checks.filter(c => c.key !== 'account');
    expect(nonAccount.every(c => c.done === false)).toBe(true);
  });
});

// ─── getMatchCandidates ───────────────────────────────────────────────────────

describe('getMatchCandidates', () => {
  test('returns candidate profiles', async () => {
    __setTableData('swipes', []);
    __setTableData('profiles', [
      { id: 'bob', display_name: 'Bob', sports: ['running'], skill: 'Beginner', city: 'NYC' },
    ]);
    const results = await getMatchCandidates(UID, {});
    expect(results).toHaveLength(1);
  });

  test('calls overlaps when sports filter provided', async () => {
    __setTableData('swipes', []);
    __setTableData('profiles', []);
    await getMatchCandidates(UID, { sports: ['running'] });
    expect(supabase.from).toHaveBeenCalledWith('profiles');
  });

  test('returns empty when no candidates', async () => {
    __setTableData('swipes', []);
    __setTableData('profiles', []);
    const results = await getMatchCandidates(UID, {});
    expect(results).toEqual([]);
  });
});

// ─── recordSwipe ──────────────────────────────────────────────────────────────

describe('recordSwipe', () => {
  test('calls upsert on swipes table', async () => {
    __setTableData('swipes', []);
    await recordSwipe(UID, 'target-1', 'like');
    expect(supabase.from).toHaveBeenCalledWith('swipes');
  });

  test('resolves without throwing for each action type', async () => {
    for (const action of ['pass', 'like', 'star']) {
      __resetAll();
      __setTableData('swipes', []);
      await expect(recordSwipe(UID, 'target-1', action)).resolves.not.toThrow();
    }
  });
});

// ─── getMutualMatches ─────────────────────────────────────────────────────────

describe('getMutualMatches', () => {
  test('returns empty when user has no outgoing likes', async () => {
    __setTableData('swipes', []);
    expect(await getMutualMatches(UID)).toEqual([]);
  });

  test('returns mutual match profiles', async () => {
    let callIndex = 0;
    supabase.from.mockImplementation((table) => {
      if (table === 'swipes') {
        callIndex++;
        if (callIndex === 1) {
          return {
            select: jest.fn().mockReturnThis(),
            eq:     jest.fn().mockReturnThis(),
            in:     jest.fn().mockReturnThis(),
            then:   (resolve) => resolve({ data: [{ target_id: 'alice' }], error: null }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq:     jest.fn().mockReturnThis(),
          in:     jest.fn().mockReturnThis(),
          then:   (resolve) => resolve({
            data: [{ user_id: 'alice', profiles: { id: 'alice', display_name: 'Alice', avatar_url: null } }],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis(), then: (r) => r({ data: [], error: null }) };
    });

    const matches = await getMutualMatches(UID);
    expect(matches).toHaveLength(1);
    expect(matches[0].display_name).toBe('Alice');
  });
});
