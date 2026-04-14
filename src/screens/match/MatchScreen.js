import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, Dimensions,
} from 'react-native';
import { useState } from 'react';

const { width } = Dimensions.get('window');
const ORANGE  = '#E8602C';
const DARK    = '#1C1A18';
const BG      = '#F0EDE8';
const CARD_BG = '#EAE6DF';

// ─── Mock data ──────────────────────────────────────────────────────────────────

const ATHLETES = [
  {
    id: '1', icon: '🏃', initial: 'M', color: ORANGE,
    name: 'Marco Oliveira', location: '📍 0.6 km away · 29',
    sports: ['🏃 Running', '🥾 Hiking', '🧗 Climbing'],
    pace: '4:50/km', avail: 'Weekends · Evenings', skill: 'Advanced',
  },
  {
    id: '2', icon: '🚴', initial: 'P', color: '#5a9e6f',
    name: 'Priya Mehta', location: '📍 1.8 km away · 31',
    sports: ['🚴 Cycling', '🏊 Swimming', '🤸 Yoga'],
    pace: '28 km/h', avail: 'Mornings · Weekdays', skill: 'Intermediate',
  },
  {
    id: '3', icon: '🏋️', initial: 'C', color: '#7b5ea7',
    name: 'Chris Park', location: '📍 2.4 km away · 28',
    sports: ['🏋️ Lifting', '🏃 Running'],
    pace: '5:20/km', avail: 'Early Mornings', skill: 'Advanced',
  },
];

const CHECKLIST = [
  { label: 'Account created',               done: true  },
  { label: 'Email verified',                done: true  },
  { label: 'Profile photo uploaded',        done: false },
  { label: 'Sports & skill level set',      done: false },
  { label: 'Location & availability set',   done: false },
];

const SPORT_FILTERS = ['🏃 Running', '🚴 Cycling', '🧗 Climbing', '🏊 Swimming', '🥾 Hiking', '🤸 Yoga'];
const SKILL_FILTERS = ['Beginner', 'Intermediate', 'Advanced'];
const AVAIL_FILTERS = ['Weekends', 'Weekdays', 'Mornings', 'Evenings'];

const YOUR_MATCHES = [
  { initial: 'M', color: ORANGE },
  { initial: 'S', color: '#5a9e6f' },
];

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
  return (
    <View style={styles.athleteCard}>
      {/* Big icon area */}
      <View style={[styles.cardHero, { backgroundColor: athlete.color + '22' }]}>
        <View style={[styles.cardAvatar, { backgroundColor: athlete.color }]}>
          <Text style={styles.cardAvatarText}>{athlete.initial}</Text>
        </View>
        <Text style={styles.cardIcon}>{athlete.icon}</Text>
      </View>

      {/* Info */}
      <View style={styles.cardBody}>
        <Text style={styles.cardName}>{athlete.name}</Text>
        <Text style={styles.cardLocation}>{athlete.location}</Text>

        <View style={styles.sportTags}>
          {athlete.sports.map(s => (
            <View key={s} style={styles.sportTag}>
              <Text style={styles.sportTagText}>{s}</Text>
            </View>
          ))}
        </View>

        <View style={styles.cardDetails}>
          <View style={styles.cardDetail}>
            <Text style={styles.cardDetailLabel}>SKILL</Text>
            <Text style={styles.cardDetailVal}>{athlete.skill}</Text>
          </View>
          <View style={styles.cardDetailDivider} />
          <View style={styles.cardDetail}>
            <Text style={styles.cardDetailLabel}>PACE</Text>
            <Text style={styles.cardDetailVal}>{athlete.pace}</Text>
          </View>
          <View style={styles.cardDetailDivider} />
          <View style={styles.cardDetail}>
            <Text style={styles.cardDetailLabel}>AVAILABLE</Text>
            <Text style={styles.cardDetailVal}>{athlete.avail}</Text>
          </View>
        </View>
      </View>

      {/* Action buttons */}
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

export default function MatchScreen() {
  const [unlocked, setUnlocked]   = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const [sports, setSports]   = useState(['🏃 Running', '🚴 Cycling']);
  const [skills, setSkills]   = useState(['Intermediate', 'Advanced']);
  const [avails, setAvails]   = useState(['Weekends', 'Evenings']);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const toggleItem = (list, setList, item) =>
    setList(list.includes(item) ? list.filter(i => i !== item) : [...list, item]);

  const currentAthlete = ATHLETES[cardIndex % ATHLETES.length];

  const handlePass = () => setCardIndex(i => i + 1);
  const handleLike = () => setCardIndex(i => i + 1);
  const handleStar = () => setCardIndex(i => i + 1);

  // ── Gate state ──
  if (!unlocked) {
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
              {CHECKLIST.map(c => (
                <View key={c.label} style={styles.checkRow}>
                  <View style={[styles.checkDot, c.done && styles.checkDotDone]}>
                    {c.done && <Text style={styles.checkMark}>✓</Text>}
                  </View>
                  <Text style={[styles.checkLabel, c.done && styles.checkLabelDone]}>{c.label}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity style={styles.completeBtn} activeOpacity={0.85}>
              <Text style={styles.completeBtnText}>Complete My Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setUnlocked(true)} style={{ marginTop: 12 }}>
              <Text style={styles.previewLink}>or <Text style={styles.previewLinkBold}>preview matching (demo)</Text></Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Unlocked state ──
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

        {/* Sub-header */}
        <Text style={styles.matchSub}>8 athletes near you match your sports</Text>

        {/* ── Athlete card ── */}
        <AthleteCard
          athlete={currentAthlete}
          onPass={handlePass}
          onLike={handleLike}
          onStar={handleStar}
        />

        {/* ── Filters panel (collapsible) ── */}
        {filtersOpen && (
          <View style={styles.filtersPanel}>
            <Text style={styles.filterSectionLabel}>SPORTS</Text>
            <FilterChipGroup options={SPORT_FILTERS} active={sports} onToggle={o => toggleItem(sports, setSports, o)} />

            <Text style={styles.filterSectionLabel}>SKILL LEVEL</Text>
            <FilterChipGroup options={SKILL_FILTERS} active={skills} onToggle={o => toggleItem(skills, setSkills, o)} />

            <Text style={styles.filterSectionLabel}>AVAILABILITY</Text>
            <FilterChipGroup options={AVAIL_FILTERS} active={avails} onToggle={o => toggleItem(avails, setAvails, o)} />
          </View>
        )}

        {/* ── Your Matches ── */}
        <View style={styles.mutualCard}>
          <Text style={styles.mutualTitle}>Your Matches</Text>
          <Text style={styles.mutualSub}>Complete your profile to see mutual matches.</Text>
          <View style={styles.mutualAvatars}>
            {YOUR_MATCHES.map(m => (
              <View key={m.initial} style={[styles.mutualAvatar, { backgroundColor: m.color }]}>
                <Text style={styles.mutualAvatarText}>{m.initial}</Text>
              </View>
            ))}
            <View style={[styles.mutualAvatar, { backgroundColor: '#D9D0C7' }]}>
              <Text style={[styles.mutualAvatarText, { color: '#888' }]}>+5</Text>
            </View>
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
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
  previewLink:     { fontSize: 13, color: '#888' },
  previewLinkBold: { color: ORANGE, fontWeight: '700' },

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
  cardIcon:       { fontSize: 28, position: 'absolute', bottom: 16, right: 24 },
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
  mutualSub:        { fontSize: 12, color: '#888', marginBottom: 12 },
  mutualAvatars:    { flexDirection: 'row', gap: 8 },
  mutualAvatar:     { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  mutualAvatarText: { color: '#fff', fontWeight: '900', fontSize: 16 },
});
