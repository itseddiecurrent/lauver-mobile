import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, ActivityIndicator, Image, Modal, Dimensions,
} from 'react-native';
import { useState, useMemo } from 'react';
import { useMatch } from '../../hooks/useMatch';
import { useTheme } from '../../context/ThemeContext';

const { width: SW } = Dimensions.get('window');

const SPORTS_LIST = [
  'Running', 'Cycling', 'Climbing', 'Swimming',
  'Hiking', 'Yoga', 'Skiing', 'Gym', 'Triathlon', 'HIIT',
];
const DIST_OPTIONS = [
  { label: '10 km', value: 10 },
  { label: '25 km', value: 25 },
  { label: '50 km', value: 50 },
  { label: 'Any',   value: 0  },
];

function avatarColor(name = '') {
  const colors = ['#E8602C', '#5a9e6f', '#7b5ea7', '#3a7ec8', '#c07a3a'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return colors[h % colors.length];
}

function Cap(str = '') { return str.charAt(0).toUpperCase() + str.slice(1); }

// ─── Onboarding Gate ─────────────────────────────────────────────────────────

function OnboardingGate({ onSave, saving, styles, c }) {
  const [gender,     setGender]     = useState('');
  const [prefGender, setPrefGender] = useState('all');

  function commit() {
    if (!gender) return;
    onSave({ gender, prefGender, visibleInMatch: true });
  }

  return (
    <ScrollView contentContainerStyle={styles.gateScroll}>
      <View style={styles.gateCard}>
        <Text style={styles.gateTitle}>Set up Athlete Matching</Text>
        <Text style={styles.gateSub}>
          Tell us a bit about yourself so we can show you the right training partners.
          Your profile won't be visible until you save these preferences.
        </Text>

        <Text style={styles.gateLabel}>My gender</Text>
        <View style={styles.chipGroup}>
          {['Male', 'Female', 'Other'].map(opt => (
            <TouchableOpacity
              key={opt}
              style={[styles.chip, gender === opt.toLowerCase() && styles.chipActive]}
              onPress={() => setGender(opt.toLowerCase())}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, gender === opt.toLowerCase() && styles.chipTextActive]}>
                {opt}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.gateLabel, { marginTop: 16 }]}>Show me</Text>
        <View style={styles.chipGroup}>
          {['All', 'Male', 'Female', 'Other'].map(opt => (
            <TouchableOpacity
              key={opt}
              style={[styles.chip, prefGender === opt.toLowerCase() && styles.chipActive]}
              onPress={() => setPrefGender(opt.toLowerCase())}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, prefGender === opt.toLowerCase() && styles.chipTextActive]}>
                {opt}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.completeBtn, (!gender || saving) && styles.btnDisabled]}
          onPress={commit}
          disabled={!gender || saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.completeBtnText}>Start Matching →</Text>
          }
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ─── Candidate Card ───────────────────────────────────────────────────────────

function CandidateCard({ athlete, onPass, onLike, swiping, likesRemaining, dailyLimitHit, styles, c }) {
  const name    = athlete.display_name || athlete.first_name || 'Athlete';
  const photo   = athlete.photos?.[0] ?? null;
  const sports  = (athlete.sports || []).map(Cap);
  const distKm  = athlete.distance_km != null ? `${Math.round(athlete.distance_km)} km away` : null;

  return (
    <View style={styles.athleteCard}>
      {photo ? (
        <Image source={{ uri: photo }} style={styles.cardPhoto} />
      ) : (
        <View style={[styles.cardPhoto, styles.cardPhotoPlaceholder, { backgroundColor: avatarColor(name) + '33' }]}>
          <View style={[styles.cardInitialCircle, { backgroundColor: avatarColor(name) }]}>
            <Text style={styles.cardInitialText}>{name.charAt(0).toUpperCase()}</Text>
          </View>
        </View>
      )}

      <View style={styles.cardOverlay}>
        {!!athlete.skill && (
          <View style={styles.skillBadge}>
            <Text style={styles.skillBadgeText}>{athlete.skill}</Text>
          </View>
        )}
      </View>

      <View style={styles.cardBody}>
        <View style={styles.cardNameRow}>
          <Text style={styles.cardName}>{name}</Text>
          {distKm && <Text style={styles.cardDist}>{distKm}</Text>}
        </View>

        {!!athlete.city && <Text style={styles.cardCity}>{athlete.city}</Text>}

        {sports.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, paddingRight: 4 }}
            style={{ marginVertical: 8 }}
          >
            {sports.map(s => (
              <View key={s} style={styles.sportChip}>
                <Text style={styles.sportChipText}>{s}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        {!!athlete.bio && (
          <Text style={styles.cardBio} numberOfLines={3}>{athlete.bio}</Text>
        )}
      </View>

      <View style={styles.swipeRow}>
        {dailyLimitHit ? (
          <View style={styles.limitBanner}>
            <Text style={styles.limitBannerText}>Daily limit reached — come back tomorrow</Text>
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.swipeBtn, styles.swipeBtnPass]}
              onPress={onPass}
              disabled={swiping}
              activeOpacity={0.8}
            >
              <Text style={styles.swipeBtnTextPass}>✕</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.swipeBtn, styles.swipeBtnLike]}
              onPress={onLike}
              disabled={swiping || dailyLimitHit}
              activeOpacity={0.8}
            >
              <Text style={styles.swipeBtnTextLike}>♥</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {!dailyLimitHit && (
        <Text style={styles.likesLeft}>{likesRemaining} likes left today</Text>
      )}
    </View>
  );
}

// ─── Filter Sheet ─────────────────────────────────────────────────────────────

function FilterSheet({ visible, filters, onApply, onClose, styles, c }) {
  const [gender, setGender]   = useState(filters.gender ?? 'all');
  const [maxKm,  setMaxKm]    = useState(filters.maxKm  ?? 25);
  const [sports, setSports]   = useState(filters.sports ?? []);

  function toggleSport(s) {
    setSports(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>Filter Athletes</Text>

        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }}>
          <Text style={styles.sheetLabel}>SHOW ME</Text>
          <View style={styles.chipGroup}>
            {['All', 'Male', 'Female', 'Other'].map(opt => (
              <TouchableOpacity
                key={opt}
                style={[styles.chip, gender === opt.toLowerCase() && styles.chipActive]}
                onPress={() => setGender(opt.toLowerCase())}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, gender === opt.toLowerCase() && styles.chipTextActive]}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.sheetLabel, { marginTop: 16 }]}>MAX DISTANCE</Text>
          <View style={styles.chipGroup}>
            {DIST_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.chip, maxKm === opt.value && styles.chipActive]}
                onPress={() => setMaxKm(opt.value)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, maxKm === opt.value && styles.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.sheetLabel, { marginTop: 16 }]}>SPORTS</Text>
          <View style={styles.chipGroup}>
            {SPORTS_LIST.map(s => (
              <TouchableOpacity
                key={s}
                style={[styles.chip, sports.includes(s.toLowerCase()) && styles.chipActive]}
                onPress={() => toggleSport(s.toLowerCase())}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, sports.includes(s.toLowerCase()) && styles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <TouchableOpacity
          style={styles.sheetApplyBtn}
          onPress={() => { onApply({ gender, maxKm, sports }); onClose(); }}
          activeOpacity={0.85}
        >
          <Text style={styles.sheetApplyText}>Apply Filters</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ─── Match Toast ──────────────────────────────────────────────────────────────

function MatchToast({ result, onSayHi, onKeepSwiping, styles, c }) {
  const name  = result?.matchedWith?.name  ?? 'Someone';
  const photo = result?.matchedWith?.photo ?? null;

  return (
    <Modal visible animationType="fade" transparent statusBarTranslucent>
      <View style={styles.toastBg}>
        <View style={styles.toastCard}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.toastPhoto} />
          ) : (
            <View style={[styles.toastPhoto, { backgroundColor: avatarColor(name), justifyContent: 'center', alignItems: 'center' }]}>
              <Text style={{ color: '#fff', fontSize: 36, fontWeight: '900' }}>{name.charAt(0).toUpperCase()}</Text>
            </View>
          )}

          <Text style={styles.toastTitle}>It's a Match!</Text>
          <Text style={styles.toastSub}>You and {name} both liked each other.</Text>

          <TouchableOpacity style={styles.toastHiBtn} onPress={onSayHi} activeOpacity={0.85}>
            <Text style={styles.toastHiBtnText}>Say Hi →</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.toastSkipBtn} onPress={onKeepSwiping} activeOpacity={0.7}>
            <Text style={styles.toastSkipText}>Keep Swiping</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MatchScreen({ navigation }) {
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const {
    candidates, matches, filters,
    loading, swiping, likesRemaining, dailyLimitHit,
    needsOnboarding, lastMatchResult,
    swipeRight, swipeLeft, applyFilters, saveMatchPrefs,
    dismissMatchResult,
  } = useMatch();

  const [filtersOpen,  setFiltersOpen]  = useState(false);
  const [onboardSaving, setOnboardSaving] = useState(false);

  // ── handlers ────────────────────────────────────────────────────────────────
  const current = candidates[0] ?? null;

  async function handleOnboardSave(prefs) {
    setOnboardSaving(true);
    try { await saveMatchPrefs(prefs); } finally { setOnboardSaving(false); }
  }

  function handleSayHi() {
    if (!lastMatchResult) return;
    dismissMatchResult();
    navigation.navigate('Chat', {
      matchId:     lastMatchResult.matchId,
      matchedWith: lastMatchResult.matchedWith,
    });
  }

  // ── loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>FIND YOUR PACK</Text>
        </View>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={c.ORANGE} />
        </View>
      </SafeAreaView>
    );
  }

  // ── onboarding ───────────────────────────────────────────────────────────────
  if (needsOnboarding) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>FIND YOUR PACK</Text>
        </View>
        <OnboardingGate onSave={handleOnboardSave} saving={onboardSaving} styles={styles} c={c} />
      </SafeAreaView>
    );
  }

  // ── main view ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root}>
      {/* header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>FIND YOUR PACK</Text>
        <View style={styles.headerRight}>
          {!dailyLimitHit && (
            <View style={styles.likesBadge}>
              <Text style={styles.likesBadgeText}>{likesRemaining}</Text>
            </View>
          )}
          <TouchableOpacity
            style={[styles.filterBtn, filtersOpen && styles.filterBtnActive]}
            onPress={() => setFiltersOpen(true)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterBtnText, filtersOpen && styles.filterBtnTextActive]}>
              Filters
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* candidate */}
        {current ? (
          <CandidateCard
            athlete={current}
            onPass={() => swipeLeft(current)}
            onLike={() => swipeRight(current)}
            swiping={swiping}
            likesRemaining={likesRemaining}
            dailyLimitHit={dailyLimitHit}
            styles={styles}
            c={c}
          />
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>You've seen everyone nearby!</Text>
            <Text style={styles.emptyBody}>New athletes join every day — check back soon, or widen your filters.</Text>
          </View>
        )}

        {/* matches list */}
        {matches.length > 0 && (
          <View style={styles.matchesSection}>
            <Text style={styles.matchesSectionTitle}>Your Matches</Text>
            {matches.map(m => {
              const name  = m.other_display_name ?? 'Athlete';
              const photo = m.other_photo ?? null;
              const unread = m.unread_count ?? 0;
              return (
                <TouchableOpacity
                  key={m.match_id}
                  style={styles.matchRow}
                  onPress={() => navigation.navigate('Chat', {
                    matchId:     m.match_id,
                    matchedWith: { id: m.other_id, name, photo },
                  })}
                  activeOpacity={0.75}
                >
                  {photo ? (
                    <Image source={{ uri: photo }} style={styles.matchAvatar} />
                  ) : (
                    <View style={[styles.matchAvatar, { backgroundColor: avatarColor(name), justifyContent: 'center', alignItems: 'center' }]}>
                      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 18 }}>{name.charAt(0).toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={styles.matchInfo}>
                    <Text style={styles.matchName}>{name}</Text>
                    {m.last_message ? (
                      <Text style={styles.matchPreview} numberOfLines={1}>{m.last_message}</Text>
                    ) : (
                      <Text style={[styles.matchPreview, { fontStyle: 'italic' }]}>Say hi!</Text>
                    )}
                  </View>
                  {unread > 0 && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadBadgeText}>{unread}</Text>
                    </View>
                  )}
                  <Text style={styles.matchChevron}>›</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {matches.length === 0 && !current && (
          <View style={[styles.emptyCard, { marginTop: 12 }]}>
            <Text style={styles.emptyTitle}>No matches yet</Text>
            <Text style={styles.emptyBody}>When you and another athlete both like each other, you'll see them here.</Text>
          </View>
        )}

      </ScrollView>

      {/* filter sheet */}
      <FilterSheet
        visible={filtersOpen}
        filters={filters}
        onApply={applyFilters}
        onClose={() => setFiltersOpen(false)}
        styles={styles}
        c={c}
      />

      {/* match toast */}
      {lastMatchResult && (
        <MatchToast
          result={lastMatchResult}
          onSayHi={handleSayHi}
          onKeepSwiping={dismissMatchResult}
          styles={styles}
          c={c}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles factory ───────────────────────────────────────────────────────────

function makeStyles(c) {
  return StyleSheet.create({
    root:        { flex: 1, backgroundColor: c.BG },
    loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header:      {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    },
    headerTitle: { fontSize: 20, fontWeight: '900', color: c.TEXT, letterSpacing: 1 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },

    likesBadge:     { backgroundColor: c.ORANGE, borderRadius: 12, minWidth: 24, height: 24, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6 },
    likesBadgeText: { color: '#fff', fontSize: 12, fontWeight: '900' },

    filterBtn:          { borderWidth: 1.5, borderColor: c.DIVIDER, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
    filterBtnActive:    { backgroundColor: c.TEXT, borderColor: c.TEXT },
    filterBtnText:      { fontSize: 13, fontWeight: '600', color: c.TEXT_SUB },
    filterBtnTextActive:{ color: c.BG },

    scroll: { paddingBottom: 40 },

    // ── Onboarding gate ──
    gateScroll: { padding: 16, paddingBottom: 40 },
    gateCard:   { backgroundColor: c.CARD_BG, borderRadius: 20, padding: 24, alignItems: 'center' },
    gateTitle:  { fontSize: 22, fontWeight: '900', color: c.TEXT, marginBottom: 10, textAlign: 'center' },
    gateSub:    { fontSize: 14, color: c.TEXT_SUB, lineHeight: 20, textAlign: 'center', marginBottom: 24 },
    gateLabel:  { fontSize: 11, fontWeight: '800', color: c.DARK_ORANGE, letterSpacing: 1, alignSelf: 'flex-start', marginBottom: 10 },
    completeBtn:    { backgroundColor: c.ORANGE, borderRadius: 14, paddingVertical: 14, alignSelf: 'stretch', alignItems: 'center', marginTop: 24 },
    completeBtnText:{ color: '#fff', fontSize: 15, fontWeight: '800' },
    btnDisabled:    { opacity: 0.5 },

    // ── Candidate card ──
    athleteCard: { backgroundColor: c.CARD_BG, borderRadius: 20, marginHorizontal: 16, marginBottom: 12, overflow: 'hidden' },
    cardPhoto:            { width: '100%', height: SW * 0.72 },
    cardPhotoPlaceholder: { justifyContent: 'center', alignItems: 'center' },
    cardInitialCircle:    { width: 90, height: 90, borderRadius: 45, justifyContent: 'center', alignItems: 'center' },
    cardInitialText:      { color: '#fff', fontSize: 36, fontWeight: '900' },
    cardOverlay: { position: 'absolute', top: 12, right: 12 },
    skillBadge:     { backgroundColor: c.ORANGE, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
    skillBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
    cardBody:    { padding: 16 },
    cardNameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 2 },
    cardName:    { fontSize: 22, fontWeight: '900', color: c.TEXT },
    cardDist:    { fontSize: 13, color: c.TEXT_MUTED, fontWeight: '500' },
    cardCity:    { fontSize: 13, color: c.TEXT_MUTED, marginBottom: 2 },
    cardBio:     { fontSize: 13, color: c.TEXT_SUB, lineHeight: 19, marginTop: 4 },
    sportChip:     { backgroundColor: c.ELEVATED, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
    sportChipText: { fontSize: 12, fontWeight: '600', color: c.TEXT_SUB },

    swipeRow:       { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 24, paddingVertical: 16, borderTopWidth: 1, borderTopColor: c.DIVIDER },
    swipeBtn:       { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center' },
    swipeBtnPass:   { borderWidth: 2, borderColor: '#FF6B6B', backgroundColor: 'transparent' },
    swipeBtnLike:   { backgroundColor: c.ORANGE },
    swipeBtnTextPass:{ fontSize: 24, color: '#FF6B6B' },
    swipeBtnTextLike:{ fontSize: 24, color: '#fff' },

    limitBanner:     { flex: 1, alignItems: 'center', paddingVertical: 8 },
    limitBannerText: { fontSize: 13, color: c.TEXT_MUTED, fontStyle: 'italic' },

    likesLeft: { fontSize: 11, color: c.TEXT_FAINT, textAlign: 'center', paddingBottom: 10 },

    // ── Empty ──
    emptyCard:  { backgroundColor: c.CARD_BG, borderRadius: 16, marginHorizontal: 16, padding: 32, alignItems: 'center' },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: c.TEXT, marginBottom: 8 },
    emptyBody:  { fontSize: 13, color: c.TEXT_MUTED, textAlign: 'center', lineHeight: 20 },

    // ── Matches list ──
    matchesSection:     { marginHorizontal: 16, marginTop: 8 },
    matchesSectionTitle:{ fontSize: 13, fontWeight: '900', color: c.DARK_ORANGE, letterSpacing: 1, marginBottom: 10 },
    matchRow:    { flexDirection: 'row', alignItems: 'center', backgroundColor: c.CARD_BG, borderRadius: 14, padding: 12, marginBottom: 8, gap: 12 },
    matchAvatar: { width: 48, height: 48, borderRadius: 24, flexShrink: 0 },
    matchInfo:   { flex: 1 },
    matchName:   { fontSize: 15, fontWeight: '700', color: c.TEXT, marginBottom: 2 },
    matchPreview:{ fontSize: 12, color: c.TEXT_MUTED },
    matchChevron:{ fontSize: 20, color: c.TEXT_MUTED },
    unreadBadge:     { backgroundColor: c.ORANGE, borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5 },
    unreadBadgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },

    // ── Chips (shared) ──
    chipGroup:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: c.DIVIDER },
    chipActive:     { backgroundColor: c.TEXT },
    chipText:       { fontSize: 13, fontWeight: '600', color: c.TEXT_SUB },
    chipTextActive: { color: c.BG },

    // ── Filter sheet ──
    sheetBackdrop: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: c.ELEVATED, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 20, maxHeight: '80%',
    },
    sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.DIVIDER, alignSelf: 'center', marginBottom: 16 },
    sheetTitle:  { fontSize: 18, fontWeight: '900', color: c.TEXT, marginBottom: 16 },
    sheetLabel:  { fontSize: 11, fontWeight: '800', color: c.DARK_ORANGE, letterSpacing: 1, marginBottom: 10 },
    sheetApplyBtn:  { backgroundColor: c.ORANGE, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
    sheetApplyText: { color: '#fff', fontSize: 15, fontWeight: '800' },

    // ── Match Toast ──
    toastBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 32 },
    toastCard:  { backgroundColor: c.ELEVATED, borderRadius: 24, padding: 28, alignItems: 'center', width: '100%' },
    toastPhoto: { width: 110, height: 110, borderRadius: 55, marginBottom: 20, borderWidth: 3, borderColor: c.ORANGE },
    toastTitle: { fontSize: 28, fontWeight: '900', color: c.TEXT, marginBottom: 6 },
    toastSub:   { fontSize: 14, color: c.TEXT_SUB, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
    toastHiBtn:     { backgroundColor: c.ORANGE, borderRadius: 14, paddingVertical: 14, alignSelf: 'stretch', alignItems: 'center', marginBottom: 12 },
    toastHiBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },
    toastSkipBtn:   { paddingVertical: 10, alignSelf: 'stretch', alignItems: 'center' },
    toastSkipText:  { fontSize: 14, color: c.TEXT_MUTED, fontWeight: '600' },
  });
}
