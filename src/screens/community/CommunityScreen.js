import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, ActivityIndicator, TextInput,
  Modal, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useState, useMemo } from 'react';
import { useCommunity } from '../../hooks/useCommunity';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../context/ThemeContext';

const PRESET_TAGS = ['Hiking', 'Cycling', 'Running', 'Swimming', 'Climbing', 'Skiing', 'Gym', 'Yoga', 'Outdoors', 'Team Sports'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso) {
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (secs < 60)    return 'just now';
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

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
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: size * 0.38 }}>{initials(name)}</Text>
    </View>
  );
}

function ChipGroup({ options, selected, onToggle, single = false, c }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
      {options.map(o => {
        const active = single ? selected === o : selected.includes(o);
        return (
          <TouchableOpacity
            key={o}
            style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: active ? c.TEXT : c.DIVIDER }}
            onPress={() => onToggle(o)}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: active ? c.BG : c.TEXT_SUB }}>{o}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function PostCard({ post, onReact, styles, c }) {
  const authorName = post.author?.display_name ?? 'Unknown';
  const sport      = post.activity?.sport;
  const sportLabel = sport ? ` · ${sport.charAt(0).toUpperCase() + sport.slice(1)}` : '';

  return (
    <View style={styles.postCard}>
      <View style={styles.postHeader}>
        <Avatar name={authorName} />
        <View style={styles.postMeta}>
          <Text style={styles.postName}>{authorName}</Text>
          <Text style={styles.postTime}>{timeAgo(post.created_at)}{sportLabel}</Text>
        </View>
      </View>
      <Text style={styles.postBody}>{post.body}</Text>
      {post.activity && (
        <View style={[styles.activityAttach, { backgroundColor: c.ELEVATED }]}>
          <Text style={styles.attachIcon}>{post.activity.sport?.charAt(0).toUpperCase()}</Text>
          <View style={styles.attachInfo}>
            <Text style={styles.attachName}>{post.activity.title}</Text>
            {post.activity.distance_km != null && <Text style={styles.attachStat}>{post.activity.distance_km} km</Text>}
          </View>
        </View>
      )}
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
      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onReact(post.id, 'react')} activeOpacity={0.7}>
          <Text style={[styles.actionText, post.userReactions.includes('react') && styles.actionTextActive]}>React</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} activeOpacity={0.7}>
          <Text style={styles.actionText}>{post.commentCount} comments</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} activeOpacity={0.7}>
          <Text style={styles.actionText}>↗ Share</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function GroupRow({ group, onJoin, isLast, styles, c }) {
  return (
    <View style={[styles.groupRow, !isLast && styles.groupBorder]}>
      <View style={[styles.groupIcon, { backgroundColor: c.ELEVATED }]}>
        <Text style={{ fontSize: 20 }}>{group.icon}</Text>
      </View>
      <View style={styles.groupInfo}>
        <Text style={styles.groupName}>{group.name}</Text>
        <Text style={styles.groupMembers}>{group.member_count?.toLocaleString() ?? 0} members</Text>
      </View>
      <TouchableOpacity style={styles.joinBtn} onPress={() => onJoin(group.id)} activeOpacity={0.8}>
        <Text style={styles.joinBtnText}>Join</Text>
      </TouchableOpacity>
    </View>
  );
}

function EventRow({ event, onRsvp, isLast, styles }) {
  return (
    <View style={[styles.eventRow, !isLast && styles.eventBorder]}>
      <View style={styles.eventDot} />
      <View style={styles.eventInfo}>
        <Text style={styles.eventName}>{event.name}</Text>
        <Text style={styles.eventSub}>{fmtEventDate(event.starts_at)} · {event.attendee_count} going</Text>
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

// ─── Create Community Modal ───────────────────────────────────────────────────

function CreateCommunityModal({ visible, onClose, onSubmit, defaultContact }) {
  const { colors: c } = useTheme();
  const ms = useMemo(() => makeModalStyles(c), [c]);

  const [name,       setName]       = useState('');
  const [contact,    setContact]    = useState(defaultContact ?? '');
  const [founders,   setFounders]   = useState('');
  const [location,   setLocation]   = useState('');
  const [cause,      setCause]      = useState('');
  const [type,       setType]       = useState('in-person');
  const [privacy,    setPrivacy]    = useState('public');
  const [joinPolicy, setJoinPolicy] = useState('open');
  const [tags,       setTags]       = useState([]);
  const [customTag,  setCustomTag]  = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggleTag = t => setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  const addCustomTag = () => {
    const t = customTag.trim();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setCustomTag('');
  };
  const reset = () => {
    setName(''); setContact(defaultContact ?? ''); setFounders('');
    setLocation(''); setCause(''); setType('in-person');
    setPrivacy('public'); setJoinPolicy('open'); setTags([]); setCustomTag('');
  };

  const handleSubmit = async () => {
    if (!name.trim()) { Alert.alert('Required', 'Please enter a community name.'); return; }
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), contact: contact.trim() || null, founders: founders.trim() || null, location: location.trim() || null, cause: cause.trim() || null, community_type: type, privacy, join_policy: joinPolicy, tags });
      reset();
      onClose();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const FL = ({ children }) => <Text style={ms.fieldLabel}>{children}</Text>;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={ms.root}>
        <View style={ms.header}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <Text style={ms.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={ms.title}>New Community</Text>
          <TouchableOpacity onPress={handleSubmit} disabled={submitting} activeOpacity={0.8}>
            {submitting ? <ActivityIndicator color={c.ORANGE} /> : <Text style={ms.create}>Create</Text>}
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={ms.scroll} showsVerticalScrollIndicator={false}>
            <FL>Community Name *</FL>
            <TextInput style={ms.input} value={name} onChangeText={setName} placeholder="e.g. Sunday Trail Runners" placeholderTextColor={c.TEXT_MUTED} />
            <FL>Community Contact</FL>
            <TextInput style={ms.input} value={contact} onChangeText={setContact} placeholder="Name or email" placeholderTextColor={c.TEXT_MUTED} />
            <FL>Founders</FL>
            <TextInput style={ms.input} value={founders} onChangeText={setFounders} placeholder="e.g. Alex, Jamie, Sam" placeholderTextColor={c.TEXT_MUTED} />
            <FL>Location</FL>
            <TextInput style={ms.input} value={location} onChangeText={setLocation} placeholder="City, region, or 'Online'" placeholderTextColor={c.TEXT_MUTED} />
            <FL>Cause / Description</FL>
            <TextInput style={[ms.input, ms.textarea]} value={cause} onChangeText={setCause} placeholder="What is this community about?" placeholderTextColor={c.TEXT_MUTED} multiline numberOfLines={3} textAlignVertical="top" />
            <FL>Community Type</FL>
            <ChipGroup options={['in-person', 'online', 'hybrid']} selected={type} onToggle={setType} single c={c} />
            <FL>Privacy</FL>
            <ChipGroup options={['public', 'private']} selected={privacy} onToggle={setPrivacy} single c={c} />
            <FL>Membership</FL>
            <ChipGroup options={['open', 'approval', 'invite']} selected={joinPolicy} onToggle={setJoinPolicy} single c={c} />
            <Text style={ms.hint}>
              {joinPolicy === 'open' && 'Anyone can join immediately.'}
              {joinPolicy === 'approval' && 'Requests need your approval.'}
              {joinPolicy === 'invite' && 'Members must be invited by you.'}
            </Text>
            <FL>Tags</FL>
            <ChipGroup options={PRESET_TAGS} selected={tags} onToggle={toggleTag} c={c} />
            <View style={ms.customTagRow}>
              <TextInput style={[ms.input, { flex: 1 }]} value={customTag} onChangeText={setCustomTag} placeholder="Add custom tag…" placeholderTextColor={c.TEXT_MUTED} onSubmitEditing={addCustomTag} returnKeyType="done" />
              <TouchableOpacity style={ms.addTagBtn} onPress={addCustomTag} activeOpacity={0.8}>
                <Text style={ms.addTagBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
            {tags.length > 0 && (
              <View style={ms.selectedTags}>
                {tags.map(t => (
                  <TouchableOpacity key={t} style={ms.selectedTag} onPress={() => toggleTag(t)} activeOpacity={0.7}>
                    <Text style={ms.selectedTagText}>{t} ✕</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CommunityScreen() {
  const { user } = useAuth();
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { posts, groups, events, loading, handleReaction, handleJoinGroup, handleRsvp, handlePost, handleCreateCommunity } = useCommunity();
  const [composeText,    setComposeText]    = useState('');
  const [posting,        setPosting]        = useState(false);
  const [showCreateComm, setShowCreateComm] = useState(false);

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
        <TouchableOpacity style={styles.createBtn} onPress={() => setShowCreateComm(true)} activeOpacity={0.85}>
          <Text style={styles.createBtnText}>+ Create</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={c.ORANGE} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

          <View style={styles.composeCard}>
            <View style={styles.composeRow}>
              <Avatar name={user?.email} size={40} />
              <TextInput
                style={[styles.composeInput, { backgroundColor: c.ELEVATED, color: c.TEXT }]}
                placeholder="What's your latest achievement?"
                placeholderTextColor={c.TEXT_MUTED}
                value={composeText}
                onChangeText={setComposeText}
                multiline
              />
            </View>
            <View style={styles.composeFooter}>
              {['Photo', 'Route', 'Activity', 'Goal'].map(a => (
                <TouchableOpacity key={a} style={[styles.composeBtn, { backgroundColor: c.ELEVATED }]} activeOpacity={0.7}>
                  <Text style={styles.composeBtnText}>{a}</Text>
                </TouchableOpacity>
              ))}
              {composeText.trim().length > 0 && (
                <TouchableOpacity style={styles.postBtn} onPress={submitPost} disabled={posting} activeOpacity={0.85}>
                  <Text style={styles.postBtnText}>{posting ? '…' : 'Post'}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {posts.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>🤝</Text>
              <Text style={styles.emptyTitle}>Your feed is empty</Text>
              <Text style={styles.emptyBody}>Log an activity or join a group to see posts from athletes near you.</Text>
            </View>
          ) : (
            posts.map(p => <PostCard key={p.id} post={p} onReact={handleReaction} styles={styles} c={c} />)
          )}

          <Text style={styles.sectionTitle}>SUGGESTED GROUPS</Text>
          {groups.length === 0 ? (
            <View style={styles.emptyCardSmall}>
              <Text style={styles.emptyBody}>No groups to suggest yet. Check back soon.</Text>
            </View>
          ) : (
            <View style={styles.listCard}>
              {groups.map((g, i) => <GroupRow key={g.id} group={g} onJoin={handleJoinGroup} isLast={i === groups.length - 1} styles={styles} c={c} />)}
            </View>
          )}

          <Text style={styles.sectionTitle}>NEARBY ATHLETES</Text>
          <View style={styles.emptyCardSmall}>
            <Text style={styles.emptyBody}>Enable location to discover athletes training near you.</Text>
            <TouchableOpacity style={styles.enableBtn} activeOpacity={0.85}>
              <Text style={styles.enableBtnText}>Enable Location</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionTitle}>UPCOMING EVENTS</Text>
          {events.length === 0 ? (
            <View style={[styles.emptyCardSmall, { marginBottom: 32 }]}>
              <Text style={styles.emptyBody}>No events yet. Check back soon.</Text>
            </View>
          ) : (
            <View style={[styles.listCard, { marginBottom: 32 }]}>
              {events.map((e, i) => <EventRow key={e.id} event={e} onRsvp={handleRsvp} isLast={i === events.length - 1} styles={styles} />)}
            </View>
          )}

        </ScrollView>
      )}

      <CreateCommunityModal
        visible={showCreateComm}
        onClose={() => setShowCreateComm(false)}
        onSubmit={handleCreateCommunity}
        defaultContact={user?.email ?? ''}
      />
    </SafeAreaView>
  );
}

// ─── Styles factories ─────────────────────────────────────────────────────────

function makeStyles(c) {
  return StyleSheet.create({
    root:        { flex: 1, backgroundColor: c.BG },
    scroll:      { paddingBottom: 32 },
    loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
    headerTitle: { fontSize: 20, fontWeight: '900', color: c.TEXT, letterSpacing: 1 },
    createBtn:   { backgroundColor: c.ORANGE, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
    createBtnText:{ color: '#fff', fontWeight: '700', fontSize: 13 },

    sectionTitle: { fontSize: 13, fontWeight: '900', color: c.DARK_ORANGE, letterSpacing: 1, marginHorizontal: 16, marginTop: 24, marginBottom: 10 },

    composeCard:   { backgroundColor: c.CARD_BG, borderRadius: 16, marginHorizontal: 16, padding: 14, marginBottom: 12 },
    composeRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
    composeInput:  { flex: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, minHeight: 40 },
    composeFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
    composeBtn:    { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
    composeBtnText:{ fontSize: 12, fontWeight: '600', color: c.TEXT_SUB },
    postBtn:       { backgroundColor: c.ORANGE, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, marginLeft: 'auto' },
    postBtnText:   { color: '#fff', fontWeight: '700', fontSize: 13 },

    postCard:   { backgroundColor: c.CARD_BG, borderRadius: 16, marginHorizontal: 16, marginBottom: 10, padding: 14 },
    postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    postMeta:   { flex: 1 },
    postName:   { fontSize: 14, fontWeight: '700', color: c.TEXT },
    postTime:   { fontSize: 11, color: c.TEXT_MUTED, marginTop: 1 },
    postBody:   { fontSize: 14, color: c.TEXT_SUB, lineHeight: 20, marginBottom: 12 },

    activityAttach: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, padding: 10, marginBottom: 12 },
    attachIcon: { fontSize: 22 },
    attachInfo: { flex: 1 },
    attachName: { fontSize: 13, fontWeight: '700', color: c.TEXT },
    attachStat: { fontSize: 11, color: c.TEXT_MUTED, marginTop: 2 },

    reactionsRow:       { flexDirection: 'row', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
    reactionPill:       { backgroundColor: c.ELEVATED, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
    reactionPillActive: { backgroundColor: c.ORANGE + '25', borderWidth: 1, borderColor: c.ORANGE },
    reactionText:       { fontSize: 12, fontWeight: '600', color: c.TEXT_SUB },

    actionsRow:      { flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.DIVIDER, paddingTop: 10, gap: 4 },
    actionBtn:       { flex: 1, alignItems: 'center', paddingVertical: 4 },
    actionText:      { fontSize: 12, fontWeight: '600', color: c.TEXT_MUTED },
    actionTextActive:{ color: c.ORANGE },

    listCard:    { backgroundColor: c.CARD_BG, borderRadius: 16, marginHorizontal: 16, paddingHorizontal: 14 },
    groupRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    groupBorder: { borderBottomWidth: 1, borderBottomColor: c.DIVIDER },
    groupIcon:   { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    groupInfo:   { flex: 1 },
    groupName:   { fontSize: 14, fontWeight: '700', color: c.TEXT },
    groupMembers:{ fontSize: 11, color: c.TEXT_MUTED, marginTop: 2 },
    joinBtn:     { backgroundColor: c.TEXT, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6 },
    joinBtnText: { color: c.BG, fontSize: 12, fontWeight: '700' },

    eventRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    eventBorder: { borderBottomWidth: 1, borderBottomColor: c.DIVIDER },
    eventDot:    { width: 10, height: 10, borderRadius: 5, backgroundColor: c.ORANGE },
    eventInfo:   { flex: 1 },
    eventName:   { fontSize: 13, fontWeight: '700', color: c.TEXT },
    eventSub:    { fontSize: 11, color: c.TEXT_MUTED, marginTop: 2 },
    rsvpBtn:         { backgroundColor: c.ORANGE + '20', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5 },
    rsvpBtnActive:   { backgroundColor: c.ORANGE },
    rsvpText:        { fontSize: 11, fontWeight: '800', color: c.ORANGE, letterSpacing: 0.5 },
    rsvpTextActive:  { color: '#fff' },

    emptyCard:      { backgroundColor: c.CARD_BG, borderRadius: 16, marginHorizontal: 16, padding: 32, alignItems: 'center' },
    emptyCardSmall: { backgroundColor: c.CARD_BG, borderRadius: 16, marginHorizontal: 16, padding: 20, alignItems: 'center', gap: 12 },
    emptyIcon:  { fontSize: 32, marginBottom: 10, opacity: 0.4 },
    emptyTitle: { fontSize: 15, fontWeight: '700', color: c.TEXT, marginBottom: 6 },
    emptyBody:  { fontSize: 13, color: c.TEXT_MUTED, textAlign: 'center', lineHeight: 18 },

    enableBtn:     { backgroundColor: c.TEXT, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 8 },
    enableBtnText: { color: c.BG, fontWeight: '700', fontSize: 13 },
  });
}

function makeModalStyles(c) {
  return StyleSheet.create({
    root:   { flex: 1, backgroundColor: c.BG },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.DIVIDER },
    title:  { fontSize: 16, fontWeight: '900', color: c.TEXT },
    cancel: { fontSize: 15, color: c.TEXT_MUTED, fontWeight: '600' },
    create: { fontSize: 15, color: c.ORANGE, fontWeight: '800' },
    scroll: { padding: 16, paddingBottom: 48 },
    input:  { backgroundColor: c.INPUT_BG, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: c.TEXT },
    textarea: { minHeight: 80, paddingTop: 10, textAlignVertical: 'top' },
    hint: { fontSize: 11, color: c.TEXT_MUTED, marginBottom: 4, marginTop: 2 },
    fieldLabel: { fontSize: 11, fontWeight: '700', color: c.TEXT_SUB, letterSpacing: 0.4, marginBottom: 6, marginTop: 14 },
    customTagRow:  { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 },
    addTagBtn:     { backgroundColor: c.TEXT, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
    addTagBtnText: { color: c.BG, fontWeight: '700', fontSize: 13 },
    selectedTags:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    selectedTag:   { backgroundColor: c.ORANGE + '20', borderWidth: 1, borderColor: c.ORANGE, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
    selectedTagText:{ fontSize: 12, fontWeight: '600', color: c.ORANGE },
  });
}
