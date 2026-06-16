import {
  getFeed,
  createPost,
  toggleReaction,
  getSuggestedGroups,
  joinGroup,
  getUpcomingEvents,
  createCommunity,
  getComments,
  createComment,
  deleteComment,
  toggleRsvp,
} from '../../src/lib/community';
import { __setTableData, __resetAll, supabase } from '../../src/lib/supabase';

jest.mock('../../src/lib/supabase');

const UID   = 'user-1';
const UID2  = 'user-2';
const POST  = 'post-1';
const GROUP = 'group-1';
const EVENT = 'event-1';

beforeEach(() => __resetAll());

// ─── getFeed ──────────────────────────────────────────────────────────────────

describe('getFeed', () => {
  test('returns empty array when no posts', async () => {
    __setTableData('posts', []);
    expect(await getFeed(UID)).toEqual([]);
  });

  test('enriches posts with reactionCounts and commentCount', async () => {
    __setTableData('posts', [{
      id: POST, body: 'Hello!', created_at: new Date().toISOString(),
      author: { id: UID, display_name: 'Alice', avatar_url: null },
      activity: null,
      post_reactions: [
        { emoji: '🔥', user_id: UID },
        { emoji: '🔥', user_id: UID2 },
        { emoji: '💪', user_id: UID2 },
      ],
      post_comments: [{ id: 'c1' }, { id: 'c2' }],
    }]);
    const [post] = await getFeed(UID);
    expect(post.commentCount).toBe(2);
    expect(post.reactionCounts['🔥']).toBe(2);
    expect(post.reactionCounts['💪']).toBe(1);
  });

  test('userReactions only includes current user reactions', async () => {
    __setTableData('posts', [{
      id: POST, body: 'Test', created_at: new Date().toISOString(),
      author: null, activity: null,
      post_reactions: [
        { emoji: '🔥', user_id: UID },
        { emoji: '💪', user_id: UID2 },
      ],
      post_comments: [],
    }]);
    const [post] = await getFeed(UID);
    expect(post.userReactions).toEqual(['🔥']);
    expect(post.userReactions).not.toContain('💪');
  });

  test('empty post_reactions gives empty reactionCounts', async () => {
    __setTableData('posts', [{
      id: POST, body: 'x', created_at: new Date().toISOString(),
      author: null, activity: null,
      post_reactions: [],
      post_comments: [],
    }]);
    const [post] = await getFeed(UID);
    expect(post.reactionCounts).toEqual({});
    expect(post.userReactions).toEqual([]);
  });
});

// ─── createPost ───────────────────────────────────────────────────────────────

describe('createPost', () => {
  test('inserts into posts table', async () => {
    __setTableData('posts', [{ id: POST, body: 'hi', user_id: UID }]);
    await createPost(UID, 'hi');
    expect(supabase.from).toHaveBeenCalledWith('posts');
  });

  test('does not include photo_url when null', async () => {
    __setTableData('posts', [{ id: POST }]);
    let capturedPayload;
    supabase.from.mockImplementationOnce((table) => {
      const original = require('../../src/lib/__mocks__/supabase').__setTableData;
      const b = {
        select:  jest.fn().mockReturnThis(),
        single:  jest.fn().mockResolvedValue({ data: { id: POST }, error: null }),
        insert:  jest.fn((payload) => { capturedPayload = payload; return b; }),
      };
      return b;
    });
    await createPost(UID, 'no photo').catch(() => {});
    if (capturedPayload) {
      expect(capturedPayload).not.toHaveProperty('photo_url');
    }
  });
});

// ─── toggleReaction ───────────────────────────────────────────────────────────

describe('toggleReaction', () => {
  test('returns true when no existing reaction (adds)', async () => {
    __setTableData('post_reactions', []); // maybeSingle returns null
    const result = await toggleReaction(UID, POST, '🔥');
    expect(result).toBe(true);
  });

  test('returns false when existing reaction found (removes)', async () => {
    __setTableData('post_reactions', [{ id: 'r1' }]); // maybeSingle returns existing
    const result = await toggleReaction(UID, POST, '🔥');
    expect(result).toBe(false);
  });
});

// ─── getSuggestedGroups ───────────────────────────────────────────────────────

describe('getSuggestedGroups', () => {
  test('returns groups list', async () => {
    __setTableData('group_members', []);
    __setTableData('groups', [
      { id: 'g1', name: 'Runners', sport: 'running', icon: '🏃', member_count: 50 },
    ]);
    const groups = await getSuggestedGroups(UID);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Runners');
  });

  test('returns empty when no groups', async () => {
    __setTableData('group_members', []);
    __setTableData('groups', []);
    expect(await getSuggestedGroups(UID)).toEqual([]);
  });
});

// ─── joinGroup ────────────────────────────────────────────────────────────────

describe('joinGroup', () => {
  test('inserts into group_members and calls rpc', async () => {
    await joinGroup(UID, GROUP);
    expect(supabase.from).toHaveBeenCalledWith('group_members');
    expect(supabase.rpc).toHaveBeenCalledWith('increment_group_member_count', { group_id: GROUP });
  });
});

// ─── getUpcomingEvents ────────────────────────────────────────────────────────

describe('getUpcomingEvents', () => {
  test('marks hasRsvp true when user has RSVP\'d', async () => {
    __setTableData('events', [
      { id: EVENT, name: 'Trail Run', sport: 'running', starts_at: '2099-01-01', attendee_count: 5 },
    ]);
    __setTableData('event_rsvps', [{ event_id: EVENT }]);
    const events = await getUpcomingEvents(UID);
    expect(events[0].hasRsvp).toBe(true);
  });

  test('marks hasRsvp false when no RSVP', async () => {
    __setTableData('events', [
      { id: EVENT, name: 'Trail Run', sport: 'running', starts_at: '2099-01-01', attendee_count: 5 },
    ]);
    __setTableData('event_rsvps', []);
    const events = await getUpcomingEvents(UID);
    expect(events[0].hasRsvp).toBe(false);
  });

  test('returns empty when no events', async () => {
    __setTableData('events', []);
    __setTableData('event_rsvps', []);
    expect(await getUpcomingEvents(UID)).toEqual([]);
  });
});

// ─── toggleRsvp ──────────────────────────────────────────────────────────────

describe('toggleRsvp', () => {
  test('returns true when adding RSVP (no existing)', async () => {
    __setTableData('event_rsvps', []);
    expect(await toggleRsvp(UID, EVENT)).toBe(true);
  });

  test('returns false when removing existing RSVP', async () => {
    __setTableData('event_rsvps', [{ id: 'r1' }]);
    expect(await toggleRsvp(UID, EVENT)).toBe(false);
  });
});

// ─── createCommunity ─────────────────────────────────────────────────────────

describe('createCommunity', () => {
  test('inserts into communities table', async () => {
    const fields = { name: 'Trailblazers', creator_id: UID, community_type: 'in-person' };
    __setTableData('communities', [{ id: 'comm-1', ...fields }]);
    const result = await createCommunity(fields);
    expect(result).toMatchObject({ name: 'Trailblazers' });
    expect(supabase.from).toHaveBeenCalledWith('communities');
  });
});

// ─── getComments ─────────────────────────────────────────────────────────────

describe('getComments', () => {
  test('returns comments for a post', async () => {
    const comments = [
      { id: 'c1', body: 'Great run!', created_at: '2026-06-10T08:00:00Z', author: { id: UID, display_name: 'Alice' } },
    ];
    __setTableData('post_comments', comments);
    expect(await getComments(POST)).toEqual(comments);
  });

  test('returns empty array when no comments', async () => {
    __setTableData('post_comments', []);
    expect(await getComments(POST)).toEqual([]);
  });
});

// ─── createComment ────────────────────────────────────────────────────────────

describe('createComment', () => {
  test('inserts to post_comments and returns created comment', async () => {
    const newComment = { id: 'c2', body: 'Nice!', created_at: new Date().toISOString(), author: { id: UID, display_name: 'Alice' } };
    __setTableData('post_comments', [newComment]);
    const result = await createComment(UID, POST, 'Nice!');
    expect(result).toMatchObject({ body: 'Nice!' });
    expect(supabase.from).toHaveBeenCalledWith('post_comments');
  });
});

// ─── deleteComment ────────────────────────────────────────────────────────────

describe('deleteComment', () => {
  test('calls delete on post_comments', async () => {
    __setTableData('post_comments', []);
    await deleteComment(UID, 'c1');
    expect(supabase.from).toHaveBeenCalledWith('post_comments');
  });
});
