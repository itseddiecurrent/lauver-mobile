import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, ActivityIndicator, TextInput,
} from 'react-native';
import { useState } from 'react';
import { useCommunity } from '../../hooks/useCommunity';
import { useAuth } from '../../hooks/useAuth';

const ORANGE  = '#E8602C';
const DARK    = '#1C1A18';
const BG      = '#F0EDE8';
const CARD_BG = '#EAE6DF';

const SPORT_ICONS = {
  running: '🏃', cycling: '🚴', swimming: '🏊',
  climbing: '🧗', hiking: '🥾', skiing: '⛷️',
  gym: '🏋️', yoga: '🧘',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso) {
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (secs < 60)   return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400)return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// Deterministic avatar color from name
const AVATAR_COLORS = ['#E8602C', '#3d9970', '#7b5ea7', '#2980b9', '#c0392b', '#16a085'];
function avatarColor(str) {
  if (!str) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function fmtEventDate(iso) {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Avatar({ name, size = 40 }) {
  const bg = avatarColor(name);
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
    </View>
  );
}

function PostCard({ post, onReact }) {
  const authorName = post.author?.display_name ?? 'Unknown';
  const sport = post.activity?.sport;
  const sportLabel = sport ? ` · ${SPORT_ICONS[sport] ?? '🏅'} ${sport.charAt(0).toUpperCase() + sport.slice(1)}` : '';

  return (
    <View style={styles.postCard}>
      {/* Author */}
      <View style={styles.postHeader}>
        <Avatar name={authorName} />
        <View style={styles.postMeta}>
          <Text style={styles.postName}>{authorName}</Text>
          <Text style={styles.postTime}>{timeAgo(post.created_at)}{sportLabel}</Text>
        </View>
      </View>

      {/* Body */}
      <Text style={styles.postBody}>{post.body}</Text>

      {/* Attached activity */}
      {post.activity && (
        <View style={styles.activityAttach}>
          <Text style={styles.attachIcon}>{SPORT_ICONS[post.activity.sport] ?? '🏅'}</Text>
          <View style={styles.attachInfo}>
            <Text style={styles.attachName}>{post.activity.title}</Text>
            {post.activity.distance_km != null && (
              <Text style={styles.attachStat}>{post.activity.distance_km} km</Text>
            )}
          </View>
        </View>
      )}

      {/* Reactions */}
      {Object.keys(post.reactionCounts).length > 0 && (
        <View style={styles.reactionsRow}>
          {Object.entries(post.reactionCounts).map(([emoji, count]) => (
            <TouchableOpacity
              key={emoji}
              style={[styles.reactionPill, post.userReactions.includes(emoji) && styles.reactionPillActive]}
              onPress={() => onReact(post.id, emoji)}
              activeOpacity={0.7}
            >
              <Text style={styles.reactionText}>{emoji} {count}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onReact(post.id, '🔥')} activeOpacity={0.7}>
          <Text style={[styles.actionText, post.userReactions.includes('🔥') && styles.actionTextActive]}>
            🔥 React
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} activeOpacity={0.7}>
          <Text style={styles.actionText}>💬 {post.commentCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} activeOpacity={0.7}>
          <Text style={styles.actionText}>↗ Share</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function GroupRow({ group, onJoin, isLast }) {
  return (
    <View style={[styles.groupRow, !isLast && styles.groupBorder]}>
      <View style={styles.groupIcon}>
        <Text style={{ fontSize: 20 }}>{group.icon}</Text>
      </View>
      <View style={styles.groupInfo}>
        <Text style={styles.groupName}>{group.name}</Text>
        <Text style={styles.groupMembers}>
          {group.member_count?.toLocaleString() ?? 0} members
        </Text>
      </View>
      <TouchableOpacity style={styles.joinBtn} onPress={() => onJoin(group.id)} activeOpacity={0.8}>
        <Text style={styles.joinBtnText}>Join</Text>
      </TouchableOpacity>
    </View>
  );
}

function EventRow({ event, onRsvp, isLast }) {
  return (
    <View style={[styles.eventRow, !isLast && styles.eventBorder]}>
      <View style={styles.eventDot} />
      <View style={styles.eventInfo}>
        <Text style={styles.eventName}>{event.name}</Text>
        <Text style={styles.eventSub}>
          {fmtEventDate(event.starts_at)} · {event.attendee_count} going
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.rsvpBtn, event.hasRsvp && styles.rsvpBtnActive]}
        onPress={() => onRsvp(event.id)}
        activeOpacity={0.7}
      >
        <Text style={[styles.rsvpText, event.hasRsvp && styles.rsvpTextActive]}>
          {event.hasRsvp ? '✓ Going' : 'RSVP'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CommunityScreen() {
  const { user } = useAuth();
  const { posts, groups, events, loading, handleReaction, handleJoinGroup, handleRsvp, handlePost } = useCommunity();
  const [composeText, setComposeText] = useState('');
  const [posting, setPosting] = useState(false);

  const submitPost = async () => {
    if (!composeText.trim()) return;
    setPosting(true);
    await handlePost(composeText);
    setComposeText('');
    setPosting(false);
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>COMMUNITY</Text>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={ORANGE} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

          {/* Compose */}
          <View style={styles.composeCard}>
            <View style={styles.composeRow}>
              <Avatar name={user?.email} size={40} />
              <TextInput
                style={styles.composeInput}
                placeholder="What's your latest achievement?"
                placeholderTextColor="#AAA"
                value={composeText}
                onChangeText={setComposeText}
                multiline
              />
            </View>
            <View style={styles.composeFooter}>
              {['📷 Photo', '📍 Route', '🏃 Activity', '🎯 Goal'].map(a => (
                <TouchableOpacity key={a} style={styles.composeBtn} activeOpacity={0.7}>
                  <Text style={styles.composeBtnText}>{a}</Text>
                </TouchableOpacity>
              ))}
              {composeText.trim().length > 0 && (
                <TouchableOpacity
                  style={styles.postBtn}
                  onPress={submitPost}
                  disabled={posting}
                  activeOpacity={0.85}
                >
                  <Text style={styles.postBtnText}>{posting ? '…' : 'Post'}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Feed */}
          {posts.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>🤝</Text>
              <Text style={styles.emptyTitle}>Your feed is empty</Text>
              <Text style={styles.emptyBody}>
                Log an activity or join a group to see posts from athletes near you.
              </Text>
            </View>
          ) : (
            posts.map(p => (
              <PostCard key={p.id} post={p} onReact={handleReaction} />
            ))
          )}

          {/* Suggested Groups */}
          <Text style={styles.sectionTitle}>SUGGESTED GROUPS</Text>
          {groups.length === 0 ? (
            <View style={styles.emptyCardSmall}>
              <Text style={styles.emptyBody}>No groups to suggest yet. Check back soon.</Text>
            </View>
          ) : (
            <View style={styles.listCard}>
              {groups.map((g, i) => (
                <GroupRow key={g.id} group={g} onJoin={handleJoinGroup} isLast={i === groups.length - 1} />
              ))}
            </View>
          )}

          {/* Nearby Athletes */}
          <Text style={styles.sectionTitle}>NEARBY ATHLETES</Text>
          <View style={styles.emptyCardSmall}>
            <Text style={styles.emptyBody}>
              Enable location to discover athletes training near you.
            </Text>
            <TouchableOpacity style={styles.enableBtn} activeOpacity={0.85}>
              <Text style={styles.enableBtnText}>Enable Location</Text>
            </TouchableOpacity>
          </View>

          {/* Upcoming Events */}
          <Text style={styles.sectionTitle}>UPCOMING EVENTS</Text>
          {events.length === 0 ? (
            <View style={[styles.emptyCardSmall, { marginBottom: 32 }]}>
              <Text style={styles.emptyBody}>No events yet. Check back soon.</Text>
            </View>
          ) : (
            <View style={[styles.listCard, { marginBottom: 32 }]}>
              {events.map((e, i) => (
                <EventRow key={e.id} event={e} onRsvp={handleRsvp} isLast={i === events.length - 1} />
              ))}
            </View>
          )}

        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: BG },
  scroll:      { paddingBottom: 32 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header:      { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  headerTitle: { fontSize: 20, fontWeight: '900', color: DARK, letterSpacing: 1 },

  sectionTitle: {
    fontSize: 13, fontWeight: '900', color: DARK,
    letterSpacing: 1, marginHorizontal: 16, marginTop: 24, marginBottom: 10,
  },

  avatar:     { justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontWeight: '900' },

  composeCard:   { backgroundColor: CARD_BG, borderRadius: 16, marginHorizontal: 16, padding: 14, marginBottom: 12 },
  composeRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  composeInput:  { flex: 1, backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: DARK, minHeight: 40 },
  composeFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  composeBtn:    { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  composeBtnText:{ fontSize: 12, fontWeight: '600', color: '#555' },
  postBtn:       { backgroundColor: ORANGE, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, marginLeft: 'auto' },
  postBtnText:   { color: '#fff', fontWeight: '700', fontSize: 13 },

  postCard:   { backgroundColor: CARD_BG, borderRadius: 16, marginHorizontal: 16, marginBottom: 10, padding: 14 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  postMeta:   { flex: 1 },
  postName:   { fontSize: 14, fontWeight: '700', color: DARK },
  postTime:   { fontSize: 11, color: '#888', marginTop: 1 },
  postBody:   { fontSize: 14, color: '#333', lineHeight: 20, marginBottom: 12 },

  activityAttach: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 12, padding: 10, marginBottom: 12,
  },
  attachIcon: { fontSize: 22 },
  attachInfo: { flex: 1 },
  attachName: { fontSize: 13, fontWeight: '700', color: DARK },
  attachStat: { fontSize: 11, color: '#888', marginTop: 2 },

  reactionsRow: { flexDirection: 'row', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  reactionPill:       { backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  reactionPillActive: { backgroundColor: ORANGE + '20', borderWidth: 1, borderColor: ORANGE },
  reactionText:       { fontSize: 12, fontWeight: '600', color: '#444' },

  actionsRow:      { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#D9D0C7', paddingTop: 10, gap: 4 },
  actionBtn:       { flex: 1, alignItems: 'center', paddingVertical: 4 },
  actionText:      { fontSize: 12, fontWeight: '600', color: '#666' },
  actionTextActive:{ color: ORANGE },

  listCard: { backgroundColor: CARD_BG, borderRadius: 16, marginHorizontal: 16, paddingHorizontal: 14 },

  groupRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  groupBorder: { borderBottomWidth: 1, borderBottomColor: '#D9D0C7' },
  groupIcon:   { width: 42, height: 42, backgroundColor: '#fff', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  groupInfo:   { flex: 1 },
  groupName:   { fontSize: 14, fontWeight: '700', color: DARK },
  groupMembers:{ fontSize: 11, color: '#888', marginTop: 2 },
  joinBtn:     { backgroundColor: DARK, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6 },
  joinBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  eventRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  eventBorder: { borderBottomWidth: 1, borderBottomColor: '#D9D0C7' },
  eventDot:    { width: 10, height: 10, borderRadius: 5, backgroundColor: ORANGE },
  eventInfo:   { flex: 1 },
  eventName:   { fontSize: 13, fontWeight: '700', color: DARK },
  eventSub:    { fontSize: 11, color: '#888', marginTop: 2 },
  rsvpBtn:         { backgroundColor: ORANGE + '20', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5 },
  rsvpBtnActive:   { backgroundColor: ORANGE },
  rsvpText:        { fontSize: 11, fontWeight: '800', color: ORANGE, letterSpacing: 0.5 },
  rsvpTextActive:  { color: '#fff' },

  emptyCard: {
    backgroundColor: CARD_BG, borderRadius: 16,
    marginHorizontal: 16, padding: 32, alignItems: 'center',
  },
  emptyCardSmall: {
    backgroundColor: CARD_BG, borderRadius: 16,
    marginHorizontal: 16, padding: 20, alignItems: 'center', gap: 12,
  },
  emptyIcon:  { fontSize: 32, marginBottom: 10, opacity: 0.4 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: DARK, marginBottom: 6 },
  emptyBody:  { fontSize: 13, color: '#AAA', textAlign: 'center', lineHeight: 18 },

  enableBtn:     { backgroundColor: DARK, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 8 },
  enableBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
