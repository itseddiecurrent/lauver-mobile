import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, TextInput,
} from 'react-native';
import { useState } from 'react';

const ORANGE  = '#E8602C';
const DARK    = '#1C1A18';
const BG      = '#F0EDE8';
const CARD_BG = '#EAE6DF';

// ─── Mock data ──────────────────────────────────────────────────────────────────

const POSTS = [
  {
    id: '1', initial: 'M', avatarColor: '#E8602C',
    name: 'Marco Oliveira', time: '2 hours ago · 🏃 Running',
    body: "Just hit a new 10K PR — 43:21! The Riverside Trail is absolutely perfect this time of year. Anyone else running this weekend? Would love to find a pacer for Sunday's long run 🔥",
    activity: { icon: '🏃', name: 'Morning Run — Riverside Trail', stat: '10.0 km · 43:21 · Avg pace 4:20/km' },
    reactions: ['🔥 24', '👏 8', '💪 12'],
    comments: 5,
  },
  {
    id: '2', initial: 'S', avatarColor: '#5a9e6f',
    name: 'Sofia Chen', time: '5 hours ago · 🧗 Climbing',
    body: "Finally sent that V6 I've been projecting for 3 weeks!! Technique over strength every time. Huge thanks to the Cave crew for the beta 🤜",
    activity: null,
    reactions: ['🏆 41', '💪 19'],
    comments: 14,
  },
  {
    id: '3', initial: 'A', avatarColor: '#7b5ea7',
    name: 'Alex Ramos', time: 'Yesterday · 🚴 Cycling',
    body: "Organizing a group ride this Saturday — North Shore loop, ~60km with 800m elevation. Intermediate pace, all welcome. Drop a comment if you're in 🚴",
    activity: { icon: '🗺️', name: 'North Shore Loop — Route Preview', stat: '60 km · 800m elevation · Intermediate' },
    reactions: ['🤙 16', '💬 7'],
    comments: 7,
  },
];

const GROUPS = [
  { icon: '🏃', name: 'City Runners Club',    members: '2,841 members' },
  { icon: '🧗', name: 'Climbing Community',   members: '1,203 members' },
  { icon: '🚴', name: 'Weekend Cyclists',     members: '988 members' },
  { icon: '🥾', name: 'Trail Hikers Network', members: '3,112 members' },
];

const NEARBY = [
  { initial: 'L', color: ORANGE,    name: 'Lena Park',   sub: 'Runner · 0.8 km away' },
  { initial: 'T', color: '#3d9970', name: 'Tom Nguyen',  sub: 'Cyclist · 1.2 km away' },
  { initial: 'R', color: '#7b5ea7', name: 'Rina Sato',   sub: 'Climber · 2.1 km away' },
];

const EVENTS = [
  { name: 'City 10K Race',    sub: 'Sat Apr 5 · 500 going' },
  { name: 'Sunday Group Ride',sub: 'Sun Apr 6 · 18 going' },
  { name: 'Bouldering Comp',  sub: 'Sat Apr 12 · 72 going' },
];

// ─── Sub-components ─────────────────────────────────────────────────────────────

function PostCard({ post }) {
  const [reacted, setReacted] = useState(false);
  return (
    <View style={styles.postCard}>
      {/* Author row */}
      <View style={styles.postHeader}>
        <View style={[styles.avatar, { backgroundColor: post.avatarColor }]}>
          <Text style={styles.avatarText}>{post.initial}</Text>
        </View>
        <View style={styles.postMeta}>
          <Text style={styles.postName}>{post.name}</Text>
          <Text style={styles.postTime}>{post.time}</Text>
        </View>
        <TouchableOpacity><Text style={styles.postMore}>•••</Text></TouchableOpacity>
      </View>

      {/* Body */}
      <Text style={styles.postBody}>{post.body}</Text>

      {/* Attached activity */}
      {post.activity && (
        <View style={styles.activityAttach}>
          <Text style={styles.attachIcon}>{post.activity.icon}</Text>
          <View style={styles.attachInfo}>
            <Text style={styles.attachName}>{post.activity.name}</Text>
            <Text style={styles.attachStat}>{post.activity.stat}</Text>
          </View>
        </View>
      )}

      {/* Reactions */}
      <View style={styles.reactionsRow}>
        {post.reactions.map(r => (
          <View key={r} style={styles.reactionPill}>
            <Text style={styles.reactionText}>{r}</Text>
          </View>
        ))}
      </View>

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, reacted && styles.actionBtnActive]}
          onPress={() => setReacted(!reacted)}
        >
          <Text style={[styles.actionText, reacted && styles.actionTextActive]}>🔥 React</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn}>
          <Text style={styles.actionText}>💬 {post.comments}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn}>
          <Text style={styles.actionText}>↗ Share</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Main screen ────────────────────────────────────────────────────────────────

export default function CommunityScreen() {
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>COMMUNITY</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── Compose box ── */}
        <View style={styles.composeCard}>
          <View style={styles.composeRow}>
            <View style={[styles.avatar, { backgroundColor: DARK }]}>
              <Text style={styles.avatarText}>J</Text>
            </View>
            <View style={styles.composeInput}>
              <Text style={styles.composePh}>What's your latest achievement?</Text>
            </View>
          </View>
          <View style={styles.composeActions}>
            {['📷 Photo', '📍 Route', '🏃 Activity', '🎯 Goal'].map(a => (
              <TouchableOpacity key={a} style={styles.composeBtn} activeOpacity={0.7}>
                <Text style={styles.composeBtnText}>{a}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Feed ── */}
        {POSTS.map(p => <PostCard key={p.id} post={p} />)}

        {/* ── Suggested Groups ── */}
        <Text style={styles.sectionTitle}>SUGGESTED GROUPS</Text>
        <View style={styles.groupsList}>
          {GROUPS.map(g => (
            <View key={g.name} style={styles.groupRow}>
              <View style={styles.groupIcon}><Text style={{ fontSize: 20 }}>{g.icon}</Text></View>
              <View style={styles.groupInfo}>
                <Text style={styles.groupName}>{g.name}</Text>
                <Text style={styles.groupMembers}>{g.members}</Text>
              </View>
              <TouchableOpacity style={styles.joinBtn} activeOpacity={0.8}>
                <Text style={styles.joinBtnText}>Join</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* ── Nearby Athletes ── */}
        <Text style={styles.sectionTitle}>NEARBY ATHLETES</Text>
        <View style={styles.nearbyCard}>
          {NEARBY.map((n, i) => (
            <View key={n.name} style={[styles.nearbyRow, i < NEARBY.length - 1 && styles.nearbyBorder]}>
              <View style={[styles.smallAvatar, { backgroundColor: n.color }]}>
                <Text style={styles.smallAvatarText}>{n.initial}</Text>
              </View>
              <View style={styles.nearbyInfo}>
                <Text style={styles.nearbyName}>{n.name}</Text>
                <Text style={styles.nearbySub}>{n.sub}</Text>
              </View>
              <TouchableOpacity style={styles.connectBtn}>
                <Text style={styles.connectBtnText}>Connect</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* ── Upcoming Events ── */}
        <Text style={styles.sectionTitle}>UPCOMING EVENTS</Text>
        <View style={styles.eventsList}>
          {EVENTS.map((e, i) => (
            <View key={e.name} style={[styles.eventRow, i < EVENTS.length - 1 && styles.eventBorder]}>
              <View style={styles.eventDot} />
              <View style={styles.eventInfo}>
                <Text style={styles.eventName}>{e.name}</Text>
                <Text style={styles.eventSub}>{e.sub}</Text>
              </View>
              <TouchableOpacity style={styles.rsvpBtn}>
                <Text style={styles.rsvpText}>RSVP</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  scroll: { paddingBottom: 32 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  headerTitle: { fontSize: 20, fontWeight: '900', color: DARK, letterSpacing: 1 },
  sectionTitle: {
    fontSize: 13, fontWeight: '900', color: DARK,
    letterSpacing: 1, marginHorizontal: 16, marginTop: 24, marginBottom: 10,
  },

  // Avatar
  avatar:     { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontWeight: '900', fontSize: 16 },

  // Compose
  composeCard: { backgroundColor: CARD_BG, borderRadius: 16, marginHorizontal: 16, padding: 14, marginBottom: 12 },
  composeRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  composeInput:{ flex: 1, backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 },
  composePh:   { color: '#AAA', fontSize: 14 },
  composeActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  composeBtn:  { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  composeBtnText: { fontSize: 12, fontWeight: '600', color: '#555' },

  // Post card
  postCard:   { backgroundColor: CARD_BG, borderRadius: 16, marginHorizontal: 16, marginBottom: 10, padding: 14 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  postMeta:   { flex: 1 },
  postName:   { fontSize: 14, fontWeight: '700', color: DARK },
  postTime:   { fontSize: 11, color: '#888', marginTop: 1 },
  postMore:   { fontSize: 16, color: '#AAA', letterSpacing: 1 },
  postBody:   { fontSize: 14, color: '#333', lineHeight: 20, marginBottom: 12 },

  // Activity attachment
  activityAttach: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 12, padding: 10, marginBottom: 12,
  },
  attachIcon: { fontSize: 22 },
  attachInfo: { flex: 1 },
  attachName: { fontSize: 13, fontWeight: '700', color: DARK },
  attachStat: { fontSize: 11, color: '#888', marginTop: 2 },

  // Reactions
  reactionsRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  reactionPill: { backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  reactionText: { fontSize: 12, fontWeight: '600', color: '#444' },

  // Post actions
  actionsRow:       { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#D9D0C7', paddingTop: 10, gap: 4 },
  actionBtn:        { flex: 1, alignItems: 'center', paddingVertical: 4, borderRadius: 8 },
  actionBtnActive:  { backgroundColor: ORANGE + '20' },
  actionText:       { fontSize: 12, fontWeight: '600', color: '#666' },
  actionTextActive: { color: ORANGE },

  // Groups
  groupsList: { backgroundColor: CARD_BG, borderRadius: 16, marginHorizontal: 16, paddingHorizontal: 14 },
  groupRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#D9D0C7' },
  groupIcon:  { width: 42, height: 42, backgroundColor: '#fff', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  groupInfo:  { flex: 1 },
  groupName:  { fontSize: 14, fontWeight: '700', color: DARK },
  groupMembers:{ fontSize: 11, color: '#888', marginTop: 2 },
  joinBtn:    { backgroundColor: DARK, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6 },
  joinBtnText:{ color: '#fff', fontSize: 12, fontWeight: '700' },

  // Nearby
  nearbyCard:   { backgroundColor: CARD_BG, borderRadius: 16, marginHorizontal: 16, paddingHorizontal: 14 },
  nearbyRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  nearbyBorder: { borderBottomWidth: 1, borderBottomColor: '#D9D0C7' },
  smallAvatar:  { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  smallAvatarText:{ color: '#fff', fontWeight: '900', fontSize: 14 },
  nearbyInfo:   { flex: 1 },
  nearbyName:   { fontSize: 13, fontWeight: '700', color: DARK },
  nearbySub:    { fontSize: 11, color: '#888', marginTop: 1 },
  connectBtn:   { borderWidth: 1.5, borderColor: DARK, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5 },
  connectBtnText:{ fontSize: 12, fontWeight: '700', color: DARK },

  // Events
  eventsList: { backgroundColor: CARD_BG, borderRadius: 16, marginHorizontal: 16, paddingHorizontal: 14, marginBottom: 8 },
  eventRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  eventBorder:{ borderBottomWidth: 1, borderBottomColor: '#D9D0C7' },
  eventDot:   { width: 10, height: 10, borderRadius: 5, backgroundColor: ORANGE },
  eventInfo:  { flex: 1 },
  eventName:  { fontSize: 13, fontWeight: '700', color: DARK },
  eventSub:   { fontSize: 11, color: '#888', marginTop: 2 },
  rsvpBtn:    { backgroundColor: ORANGE + '20', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5 },
  rsvpText:   { fontSize: 11, fontWeight: '800', color: ORANGE, letterSpacing: 0.5 },
});
