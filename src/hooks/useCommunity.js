import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import {
  getFeed, createPost, toggleReaction,
  getSuggestedGroups, joinGroup,
  getUpcomingEvents, toggleRsvp,
  createCommunity,
} from '../lib/community';

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
      getFeed(user.id).catch(() => []),
      getSuggestedGroups(user.id).catch(() => []),
      getUpcomingEvents(user.id).catch(() => []),
    ]);
    setPosts(postsData);
    setGroups(groupsData);
    setEvents(eventsData);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Optimistic reaction toggle
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
    await toggleReaction(user.id, postId, emoji).catch(() => {});
  }, [user]);

  // Optimistic group join (remove from suggestions immediately)
  const handleJoinGroup = useCallback(async (groupId) => {
    if (!user) return;
    setGroups(prev => prev.filter(g => g.id !== groupId));
    await joinGroup(user.id, groupId).catch(() => {});
  }, [user]);

  // Optimistic RSVP toggle
  const handleRsvp = useCallback(async (eventId) => {
    if (!user) return;
    setEvents(prev => prev.map(e =>
      e.id !== eventId ? e : {
        ...e,
        hasRsvp:        !e.hasRsvp,
        attendee_count: e.attendee_count + (e.hasRsvp ? -1 : 1),
      }
    ));
    await toggleRsvp(user.id, eventId).catch(() => {});
  }, [user]);

  // Submit a new post then reload feed
  const handlePost = useCallback(async (body) => {
    if (!user || !body.trim()) return;
    await createPost(user.id, body).catch(() => {});
    const fresh = await getFeed(user.id).catch(() => []);
    setPosts(fresh);
  }, [user]);

  const handleCreateCommunity = async (fields) => {
    if (!user) return;
    await createCommunity({ ...fields, creator_id: user.id });
  };

  return {
    posts, groups, events, loading,
    refresh: load,
    handleReaction, handleJoinGroup, handleRsvp, handlePost, handleCreateCommunity,
  };
}
