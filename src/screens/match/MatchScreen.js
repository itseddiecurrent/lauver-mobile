import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, ActivityIndicator,
} from 'react-native';
import { useState } from 'react';
import { useMatch } from '../../hooks/useMatch';

const ORANGE  = '#E8602C';
const DARK    = '#1C1A18';
const BG      = '#F0EDE8';
const CARD_BG = '#EAE6DF';

const SPORT_FILTERS = ['🏃 Running', '🚴 Cycling', '🧗 Climbing', '🏊 Swimming', '🥾 Hiking', '🤸 Yoga'];
const SKILL_FILTERS = ['Beginner', 'Intermediate', 'Advanced'];
const AVAIL_FILTERS = ['Weekends', 'Weekdays', 'Mornings', 'Evenings'];

const SPORT_ICONS = {
  running: '🏃', cycling: '🚴', swimming: '🏊',
  climbing: '🧗', hiking: '🥾', skiing: '⛷️',
  gym: '🏋️', yoga: '🤸',
};

function avatarColor(name = '') {
  const colors = ['#E8602C', '#5a9e6f', '#7b5ea7', '#3a7ec8', '#c07a3a'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return colors[h % colors.length];
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function FilterChipGroup({ options, active, onToggle }) {
  return (
    <View style={styles.chipGroup}>
      {options.map(o => (
        <TouchableOpacity
          key={o}
          style={[styles.chip, active.includes(o) && styles.chipActive]}
          onPress={() => onToggle(o)}
          activeOpacity={0.7}
        >
          <Text style={[styles.chipText, active.includes(o) && styles.chipTextActive]}>{o}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function AthleteCard({ athlete, onPass, onLike, onStar }) {
  const name    = athlete.display_name || 'Athlete';
  const initial = name.charAt(0).toUpperCase();
  const color   = avatarColor(name);
  const sports  = (athlete.sports || []).map(s => `${SPORT_ICONS[s] ?? '🏅'} ${s.charAt(0).toUpperCase() + s.slice(1)}`);

  return (
    <View style={styles.athleteCard}>
      <View style={[styles.cardHero, { backgroundColor: color + '22' }]}>
        <View style={[styles.cardAvatar, { backgroundColor: color }]}>
          <Text style={styles.cardAvatarText}>{initial}</Text>
        </View>
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.cardName}>{name}</Text>
        {athlete.location_name ? (
          <Text style={styles.cardLocation}>📍 {athlete.location_name}</Text>
        ) : null}

        {sports.length > 0 && (
          <View style={styles.sportTags}>
            {sports.map(s => (
              <View key={s} style={styles.sportTag}>
                <Text style={styles.sportTagText}>{s}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.cardDetails}>
          <View style={styles.cardDetail}>
            <Text style={styles.cardDetailLabel}>SKILL</Text>
            <Text style={styles.cardDetailVal}>{athlete.skill_level || '—'}</Text>
          </View>
          <View style={styles.cardDetailDivider} />
          <View style={styles.cardDetail}>
            <Text style={styles.cardDetailLabel}>AVAILABLE</Text>
            <Text style={styles.cardDetailVal} numberOfLines={1}>
              {(athlete.availability || []).join(' · ') || '—'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.swipeRow}>
        <TouchableOpacity style={[styles.swipeBtn, styles.swipeBtnPass]} onPress={onPass} activeOpacity={0.8}>
          <Text style={styles.swipeBtnTextPass}>✕</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.swipeBtn, styles.swipeBtnStar]} onPress={onStar} activeOpacity={0.8}>
          <Text style={styles.swipeBtnTextStar}>★</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.swipeBtn, styles.swipeBtnLike]} onPress={onLike} activeOpacity={0.8}>
          <Text style={styles.swipeBtnTextLike}>♥</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Main screen ────────────────────────────────────────────────────────────────

export default function MatchScreen({ navigation }) {
  const {
    readiness, isReady,
    candidates, matches,
    loading,
    sportFilters, setSportFilters,
    skillFilters, setSkillFilters,
    handleSwipe,
  } = useMatch();

  const [cardIndex,    setCardIndex]    = useState(0);
  const [filtersOpen,  setFiltersOpen]  = useState(false);
  const [avails,       setAvails]       = useState([]);

  const toggleItem = (list, setList, item) =>
    setList(list.includes(item) ? list.filter(i => i !== item) : [...list, item]);

  // ── Loading state ──
  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>FIND YOUR PACK</Text>
        </View>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={ORANGE} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Gate state ──
  if (!isReady) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>FIND YOUR PACK</Text>
        </View>
        <ScrollView contentContainerStyle={styles.gateScroll}>
          <View style={styles.gateCard}>
            <Text style={styles.gateIcon}>🔒</Text>
            <Text style={styles.gateTitle}>Unlock Athlete Matching</Text>
            <Text style={styles.gateSub}>
              Complete your profile to start finding training partners who match your sports, pace, and schedule.
            </Text>

            <View style={styles.checklist}>
              {readiness.map(c => (
                <View key={c.key} style={styles.checkRow}>
                  <View style={[styles.checkDot, c.done && styles.checkDotDone]}>
                    {c.done && <Text style={styles.checkMark}>✓</Text>}
                  </View>
                  <Text style={[styles.checkLabel, c.done && styles.checkLabelDone]}>{c.label}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity style={styles.completeBtn} activeOpacity={0.85} onPress={() => navigation.navigate('Profile')}>
              <Text style={styles.completeBtnText}>Complete My Profile</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Unlocked state ──
  const currentAthlete = candidates[cardIndex % Math.max(candidates.length, 1)];

  const handlePass = () => { if (currentAthlete) handleSwipe(currentAthlete.id, 'pass'); setCardIndex(i => i + 1); };
  const handleLike = () => { if (currentAthlete) handleSwipe(currentAthlete.id, 'like'); setCardIndex(i => i + 1); };
  const handleStar = () => { if (currentAthlete) handleSwipe(currentAthlete.id, 'star'); setCardIndex(i => i + 1); };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>FIND YOUR PACK</Text>
        <TouchableOpacity
          style={[styles.filterToggle, filtersOpen && styles.filterToggleActive]}
          onPress={() => setFiltersOpen(!filtersOpen)}
        >
          <Text style={[styles.filterToggleText, filtersOpen && styles.filterToggleTextActive]}>
            Filters
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.unlockedScroll}>

        <Text style={styles.matchSub}>
          {candidates.length > 0
            ? `${candidates.length} athlete${candidates.length !== 1 ? 's' : ''} near you match your sports`
            : 'No more candidates — check back later'}
        </Text>

        {/* ── Athlete card ── */}
        {currentAthlete ? (
          <AthleteCard
            athlete={currentAthlete}
            onPass={handlePass}
            onLike={handleLike}
            onStar={handleStar}
          />
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>🏅</Text>
            <Text style={styles.emptyTitle}>You've seen everyone!</Text>
            <Text style={styles.emptyBody}>New athletes join every day — check back soon.</Text>
          </View>
        )}

        {/* ── Filters panel ── */}
        {filtersOpen && (
          <View style={styles.filtersPanel}>
            <Text style={styles.filterSectionLabel}>SPORTS</Text>
            <FilterChipGroup
              options={SPORT_FILTERS}
              active={sportFilters}
              onToggle={o => toggleItem(sportFilters, setSportFilters, o)}
            />

            <Text style={styles.filterSectionLabel}>SKILL LEVEL</Text>
            <FilterChipGroup
              options={SKILL_FILTERS}
              active={skillFilters}
              onToggle={o => toggleItem(skillFilters, setSkillFilters, o)}
            />

            <Text style={styles.filterSectionLabel}>AVAILABILITY</Text>
            <FilterChipGroup
              options={AVAIL_FILTERS}
              active={avails}
              onToggle={o => toggleItem(avails, setAvails, o)}
            />
          </View>
        )}

        {/* ── Mutual matches ── */}
        <View style={styles.mutualCard}>
          <Text style={styles.mutualTitle}>Your Matches</Text>
          {matches.length === 0 ? (
            <Text style={styles.mutualSub}>Like or star athletes to find mutual matches.</Text>
          ) : (
            <View style={styles.mutualAvatars}>
              {matches.slice(0, 5).map(m => {
                const n = m.display_name || '?';
                return (
                  <View key={m.id} style={[styles.mutualAvatar, { backgroundColor: avatarColor(n) }]}>
                    <Text style={styles.mutualAvatarText}>{n.charAt(0).toUpperCase()}</Text>
                  </View>
                );
              })}
              {matches.length > 5 && (
                <View style={[styles.mutualAvatar, { backgroundColor: '#D9D0C7' }]}>
                  <Text style={[styles.mutualAvatarText, { color: '#888' }]}>+{matches.length - 5}</Text>
                </View>
              )}
            </View>
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: BG },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  headerTitle: { fontSize: 20, fontWeight: '900', color: DARK, letterSpacing: 1 },

  // Gate
  gateScroll: { padding: 16, paddingBottom: 40 },
  gateCard: {
    backgroundColor: CARD_BG, borderRadius: 20, padding: 24, alignItems: 'center',
  },
  gateIcon:  { fontSize: 48, marginBottom: 12 },
  gateTitle: { fontSize: 22, fontWeight: '900', color: DARK, marginBottom: 8, textAlign: 'center' },
  gateSub:   { fontSize: 14, color: '#666', lineHeight: 20, textAlign: 'center', marginBottom: 20 },
  checklist: { alignSelf: 'stretch', gap: 10, marginBottom: 24 },
  checkRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkDot:  {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: '#CCC',
    justifyContent: 'center', alignItems: 'center',
  },
  checkDotDone:  { backgroundColor: '#3A7D44', borderColor: '#3A7D44' },
  checkMark:     { color: '#fff', fontSize: 12, fontWeight: '900' },
  checkLabel:    { fontSize: 14, color: '#888' },
  checkLabelDone:{ color: DARK, fontWeight: '600' },
  completeBtn: {
    backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 14,
    alignSelf: 'stretch', alignItems: 'center',
  },
  completeBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  // Unlocked
  filterToggle: {
    borderWidth: 1.5, borderColor: '#CCC', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  filterToggleActive:     { backgroundColor: DARK, borderColor: DARK },
  filterToggleText:       { fontSize: 13, fontWeight: '600', color: '#555' },
  filterToggleTextActive: { color: '#fff' },
  unlockedScroll: { paddingBottom: 40 },
  matchSub: {
    fontSize: 13, color: '#888', textAlign: 'center',
    marginBottom: 12, marginHorizontal: 16,
  },

  // Athlete card
  athleteCard: {
    backgroundColor: CARD_BG, borderRadius: 20,
    marginHorizontal: 16, marginBottom: 12, overflow: 'hidden',
  },
  cardHero:       { height: 160, justifyContent: 'center', alignItems: 'center' },
  cardAvatar:     { width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center' },
  cardAvatarText: { color: '#fff', fontSize: 28, fontWeight: '900' },
  cardBody:       { padding: 16 },
  cardName:       { fontSize: 20, fontWeight: '900', color: DARK },
  cardLocation:   { fontSize: 13, color: '#888', marginTop: 2, marginBottom: 12 },
  sportTags:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  sportTag:       { backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  sportTagText:   { fontSize: 12, fontWeight: '600', color: '#444' },
  cardDetails:    { flexDirection: 'row', alignItems: 'center' },
  cardDetail:     { flex: 1, alignItems: 'center' },
  cardDetailLabel:{ fontSize: 9, fontWeight: '700', color: '#888', letterSpacing: 0.6 },
  cardDetailVal:  { fontSize: 12, fontWeight: '800', color: DARK, marginTop: 3 },
  cardDetailDivider: { width: 1, height: 32, backgroundColor: '#D9D0C7' },

  // Swipe buttons
  swipeRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 20,
    paddingVertical: 16, borderTopWidth: 1, borderTopColor: '#D9D0C7',
  },
  swipeBtn:        { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
  swipeBtnPass:    { backgroundColor: '#fff', borderWidth: 2, borderColor: '#FF6B6B' },
  swipeBtnStar:    { backgroundColor: '#fff', borderWidth: 2, borderColor: '#FFD700' },
  swipeBtnLike:    { backgroundColor: ORANGE },
  swipeBtnTextPass:{ fontSize: 22, color: '#FF6B6B' },
  swipeBtnTextStar:{ fontSize: 22, color: '#FFD700' },
  swipeBtnTextLike:{ fontSize: 22, color: '#fff' },

  // Empty state
  emptyCard: {
    backgroundColor: CARD_BG, borderRadius: 16,
    marginHorizontal: 16, padding: 32, alignItems: 'center', marginBottom: 12,
  },
  emptyIcon:  { fontSize: 36, marginBottom: 12, opacity: 0.4 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: DARK, marginBottom: 6 },
  emptyBody:  { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 20 },

  // Filters panel
  filtersPanel: {
    backgroundColor: CARD_BG, borderRadius: 16,
    marginHorizontal: 16, padding: 16, marginBottom: 12,
  },
  filterSectionLabel: {
    fontSize: 11, fontWeight: '800', color: '#888',
    letterSpacing: 1, marginBottom: 8, marginTop: 4,
  },
  chipGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#D9D0C7' },
  chipActive:    { backgroundColor: DARK },
  chipText:      { fontSize: 12, fontWeight: '600', color: '#666' },
  chipTextActive:{ color: '#fff' },

  // Mutual matches
  mutualCard: {
    backgroundColor: CARD_BG, borderRadius: 16,
    marginHorizontal: 16, padding: 16, marginBottom: 12,
  },
  mutualTitle:      { fontSize: 14, fontWeight: '800', color: DARK, marginBottom: 4 },
  mutualSub:        { fontSize: 12, color: '#888', marginBottom: 4 },
  mutualAvatars:    { flexDirection: 'row', gap: 8, marginTop: 8 },
  mutualAvatar:     { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  mutualAvatarText: { color: '#fff', fontWeight: '900', fontSize: 16 },
});
