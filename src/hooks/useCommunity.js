import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import {
  getFeed, createPost, toggleReaction,
  getSuggestedGroups, joinGroup,
  getUpcomingEvents, toggleRsvp,
  createCommunity,
  createComment, deleteComment,
} from '../lib/community';
import { supabase } from '../lib/supabase';

export function useCommunity() {
  const { user } = useAuth();

  const [posts,   setPosts]   = useState([]);
  const [groups,  setGroups]  = useState([]);
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    const [postsData, groupsData, eventsData] = await Promise.all([
      getFeed(user.uid).catch(() => []),
      getSuggestedGroups(user.uid).catch(() => []),
      getUpcomingEvents(user.uid).catch(() => []),
    ]);
    setPosts(postsData);
    setGroups(groupsData);
    setEvents(eventsData);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // ── Realtime: reload feed when any new post is inserted ──────────────────────
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('community-posts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, () => {
        getFeed(user.uid).then(setPosts).catch(() => {});
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // ── Reactions (optimistic) ────────────────────────────────────────────────────
  const handleReaction = useCallback(async (postId, emoji) => {
    if (!user) return;
    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p;
      const had = p.userReactions.includes(emoji);
      return {
        ...p,
        userReactions:  had ? p.userReactions.filter(e => e !== emoji) : [...p.userReactions, emoji],
        reactionCounts: { ...p.reactionCounts, [emoji]: Math.max(0, (p.reactionCounts[emoji] || 0) + (had ? -1 : 1)) },
      };
    }));
    await toggleReaction(user.uid, postId, emoji).catch(() => {});
  }, [user]);

  // ── Groups ────────────────────────────────────────────────────────────────────
  const handleJoinGroup = useCallback(async (groupId) => {
    if (!user) return;
    setGroups(prev => prev.filter(g => g.id !== groupId));
    await joinGroup(user.uid, groupId).catch(() => {});
  }, [user]);

  // ── Events ────────────────────────────────────────────────────────────────────
  const handleRsvp = useCallback(async (eventId) => {
    if (!user) return;
    setEvents(prev => prev.map(e =>
      e.id !== eventId ? e : {
        ...e,
        hasRsvp:        !e.hasRsvp,
        attendee_count: e.attendee_count + (e.hasRsvp ? -1 : 1),
      }
    ));
    await toggleRsvp(user.uid, eventId).catch(() => {});
  }, [user]);

  // ── Posts ─────────────────────────────────────────────────────────────────────
  const handlePost = useCallback(async (body, activityId = null, photoUrl = null) => {
    if (!user || !body.trim()) return;
    await createPost(user.uid, body, activityId, photoUrl).catch(() => {});
    const fresh = await getFeed(user.uid).catch(() => []);
    setPosts(fresh);
  }, [user]);

  // ── Comments (optimistic count update in posts list) ─────────────────────────
  const handleAddComment = useCallback(async (postId, body) => {
    if (!user || !body.trim()) return null;
    const comment = await createComment(user.uid, postId, body);
    setPosts(prev => prev.map(p =>
      p.id !== postId ? p : { ...p, commentCount: p.commentCount + 1 }
    ));
    return comment;
  }, [user]);

  const handleDeleteComment = useCallback(async (postId, commentId) => {
    if (!user) return;
    await deleteComment(user.uid, commentId).catch(() => {});
    setPosts(prev => prev.map(p =>
      p.id !== postId ? p : { ...p, commentCount: Math.max(0, p.commentCount - 1) }
    ));
  }, [user]);

  // ── Communities ───────────────────────────────────────────────────────────────
  const handleCreateCommunity = async (fields) => {
    if (!user) return;
    await createCommunity({ ...fields, creator_id: user.uid });
  };

  return {
    posts, groups, events, loading,
    refresh: load,
    handleReaction, handleJoinGroup, handleRsvp,
    handlePost, handleAddComment, handleDeleteComment,
    handleCreateCommunity,
  };
}
