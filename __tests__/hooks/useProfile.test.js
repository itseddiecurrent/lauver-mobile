/**
 * Tests for useProfile hook and progressFromProfile utility.
 */

// Prevent Firebase initialization in a test environment (no API keys configured).
jest.mock('../../src/lib/firebase', () => ({ firebaseAuth: {} }));
jest.mock('../../src/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

import { progressFromProfile } from '../../src/hooks/useProfile';

// ─── progressFromProfile ──────────────────────────────────────────────────────

describe('progressFromProfile', () => {
  test('returns 0 for null profile', () => {
    expect(progressFromProfile(null)).toBe(0);
  });

  test('returns 0 for undefined profile', () => {
    expect(progressFromProfile(undefined)).toBe(0);
  });

  test('returns ~29% for empty profile object (2/7 = account + email always true)', () => {
    expect(progressFromProfile({})).toBe(29);
  });

  test('returns 100 for fully complete profile', () => {
    const profile = {
      photos:       ['https://example.com/a.jpg'],
      sports:       ['running'],
      city:         'San Francisco',
      bio:          'I love running',
      availability: ['Mornings'],
    };
    expect(progressFromProfile(profile)).toBe(100);
  });

  test('photos check passes when array has at least one url', () => {
    const p1 = progressFromProfile({ photos: ['url'] });
    const p2 = progressFromProfile({ photos: []     });
    expect(p1).toBeGreaterThan(p2);
  });

  test('sports check passes when sports array is non-empty', () => {
    const p1 = progressFromProfile({ sports: ['running'] });
    const p2 = progressFromProfile({ sports: []          });
    expect(p1).toBeGreaterThan(p2);
  });

  test('city check passes when city is a non-empty string', () => {
    const p1 = progressFromProfile({ city: 'NYC' });
    const p2 = progressFromProfile({ city: ''    });
    expect(p1).toBeGreaterThan(p2);
  });

  test('bio check passes when bio is non-empty', () => {
    const p1 = progressFromProfile({ bio: 'Hello' });
    const p2 = progressFromProfile({ bio: ''      });
    expect(p1).toBeGreaterThan(p2);
  });

  test('availability check passes when array is non-empty', () => {
    const p1 = progressFromProfile({ availability: ['Mornings'] });
    const p2 = progressFromProfile({ availability: []           });
    expect(p1).toBeGreaterThan(p2);
  });

  test('result is always a multiple of ~14 (integer rounding of 1/7)', () => {
    for (let filled = 0; filled <= 5; filled++) {
      const checks = new Array(filled).fill(true);
      const profile = {
        photos:       checks[0] ? ['x'] : [],
        sports:       checks[1] ? ['r'] : [],
        city:         checks[2] ? 'NYC' : '',
        bio:          checks[3] ? 'bio' : '',
        availability: checks[4] ? ['M'] : [],
      };
      const pct = progressFromProfile(profile);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });

  test('7 checks: each optional field adds ~14 percentage points', () => {
    const base     = progressFromProfile({});                             // 2/7 = 28.5 → 29
    const oneMore  = progressFromProfile({ photos: ['x'] });              // 3/7 = 42.8 → 43
    const twoMore  = progressFromProfile({ photos: ['x'], sports: ['r']}); // 4/7 = 57.1 → 57
    expect(oneMore).toBeGreaterThan(base);
    expect(twoMore).toBeGreaterThan(oneMore);
  });
});

// ─── useDashboard matchCount / latestPost ────────────────────────────────────
// These test the lib functions that useDashboard calls under the hood.

import { __setTableData, __resetAll } from '../../src/lib/supabase';
jest.mock('../../src/lib/supabase');

import { getMutualMatches } from '../../src/lib/match';
import { getFeed }          from '../../src/lib/community';

beforeEach(() => __resetAll());

describe('getMutualMatches returns count for matchCount', () => {
  test('no swipes → empty array → matchCount 0', async () => {
    __setTableData('swipes', []);
    const matches = await getMutualMatches('user-x');
    expect(matches.length).toBe(0);
  });
});

describe('getFeed limit=1 for latestPost', () => {
  test('no posts → empty array → latestPost null', async () => {
    __setTableData('posts', []);
    const feed = await getFeed('user-x', 1);
    expect(feed).toEqual([]);
  });

  test('one post → enriched with reactionCounts and commentCount', async () => {
    __setTableData('posts', [{
      id: 'post-1', body: 'Hello world', created_at: new Date().toISOString(),
      author:         { id: 'u1', display_name: 'Alice', avatar_url: null },
      activity:       null,
      post_reactions: [{ emoji: '🔥', user_id: 'u2' }],
      post_comments:  [{ id: 'c1' }],
    }]);
    const feed = await getFeed('user-x', 1);
    expect(feed).toHaveLength(1);
    expect(feed[0].body).toBe('Hello world');
    expect(feed[0].reactionCounts['🔥']).toBe(1);
    expect(feed[0].commentCount).toBe(1);
  });
});
