import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, SafeAreaView, Dimensions,
} from 'react-native';

const { width } = Dimensions.get('window');

const ORANGE  = '#E8602C';
const DARK    = '#1C1A18';
const BG      = '#F0EDE8';
const CARD_BG = '#EAE6DF';

// Mock detail data keyed by id
const DETAIL = {
  '1': {
    icon: '🏃', sport: 'Running', title: 'Morning Run — Riverside Trail',
    date: 'Today, Apr 14 · 6:42 am', source: 'Garmin Forerunner 265',
    stats: [
      { val: '8.3',   lbl: 'DISTANCE (KM)' },
      { val: '42:17', lbl: 'TIME' },
      { val: '5:05',  lbl: 'AVG PACE (MIN/KM)' },
      { val: '148',   lbl: 'AVG BPM' },
      { val: '174',   lbl: 'MAX BPM' },
      { val: '312',   lbl: 'CALORIES (KCAL)' },
    ],
    splits: [
      { km: 1, pace: '5:12' }, { km: 2, pace: '5:08' }, { km: 3, pace: '5:01' },
      { km: 4, pace: '4:58' }, { km: 5, pace: '5:03' }, { km: 6, pace: '4:55' },
      { km: 7, pace: '5:09' }, { km: 8, pace: '5:00' },
    ],
  },
  '2': {
    icon: '🚴', sport: 'Cycling', title: 'Evening Ride — City Loop',
    date: 'Yesterday · 5:30 pm', source: 'Garmin Edge 540',
    stats: [
      { val: '24.6',    lbl: 'DISTANCE (KM)' },
      { val: '1:02:44', lbl: 'TIME' },
      { val: '23.7',    lbl: 'AVG SPEED (KM/H)' },
      { val: '139',     lbl: 'AVG BPM' },
      { val: '168',     lbl: 'MAX BPM' },
      { val: '480',     lbl: 'CALORIES (KCAL)' },
    ],
    splits: [],
  },
  '3': {
    icon: '🧗', sport: 'Climbing', title: 'Bouldering Session — The Cave',
    date: '2 days ago · 7:00 pm', source: 'Manual entry',
    stats: [
      { val: '14',     lbl: 'ROUTES COMPLETED' },
      { val: '1:20:00',lbl: 'TIME' },
      { val: 'V3–V5',  lbl: 'GRADE RANGE' },
    ],
    splits: [],
  },
  '4': {
    icon: '🏊', sport: 'Swimming', title: 'Lap Swim — Municipal Pool',
    date: '3 days ago · 7:15 am', source: 'Apple Health',
    stats: [
      { val: '2.4',    lbl: 'DISTANCE (KM)' },
      { val: '48:22',  lbl: 'TIME' },
      { val: '50m',    lbl: 'POOL LENGTH' },
    ],
    splits: [],
  },
  '5': {
    icon: '🥾', sport: 'Hiking', title: 'Trail Hike — North Ridge',
    date: '5 days ago · 8:00 am', source: 'Garmin Forerunner 265',
    stats: [
      { val: '12.1',   lbl: 'DISTANCE (KM)' },
      { val: '3:15:00',lbl: 'TIME' },
      { val: '640m',   lbl: 'ELEVATION GAIN' },
    ],
    splits: [],
  },
};

export default function ActivityDetailScreen({ route, navigation }) {
  const { id, title } = route.params;
  const d = DETAIL[id] ?? {
    icon: '🏃', sport: 'Activity', title: title ?? 'Activity',
    date: '', source: '', stats: [], splits: [],
  };

  return (
    <SafeAreaView style={styles.root}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerSport}>{d.sport.toUpperCase()}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Title card */}
        <View style={styles.titleCard}>
          <View style={styles.titleRow}>
            <View style={styles.iconWrap}>
              <Text style={styles.icon}>{d.icon}</Text>
            </View>
            <View style={styles.titleInfo}>
              <Text style={styles.title}>{d.title}</Text>
              <Text style={styles.date}>{d.date}</Text>
              <View style={styles.sourceBadge}>
                <Text style={styles.sourceText}>⌚ {d.source}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Map placeholder */}
        <View style={styles.mapPlaceholder}>
          <Text style={styles.mapIcon}>🗺️</Text>
          <Text style={styles.mapLabel}>Route map</Text>
          <Text style={styles.mapSub}>OpenStreetMap / Mapbox coming soon</Text>
        </View>

        {/* Stats grid */}
        <Text style={styles.sectionTitle}>STATS</Text>
        <View style={styles.statsGrid}>
          {d.stats.map(s => (
            <View key={s.lbl} style={styles.statCard}>
              <Text style={styles.statVal}>{s.val}</Text>
              <Text style={styles.statLbl}>{s.lbl}</Text>
            </View>
          ))}
        </View>

        {/* Splits (running only) */}
        {d.splits.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>KM SPLITS</Text>
            <View style={styles.splitsCard}>
              {d.splits.map((s, i) => (
                <View key={s.km} style={[styles.splitRow, i < d.splits.length - 1 && styles.splitBorder]}>
                  <Text style={styles.splitKm}>KM {s.km}</Text>
                  <View style={styles.splitBarWrap}>
                    <View style={[styles.splitBar, { width: `${Math.min(100, (330 / parseInt(s.pace)) * 80)}%` }]} />
                  </View>
                  <Text style={styles.splitPace}>{s.pace}</Text>
                </View>
              ))}
            </View>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  scroll: { padding: 16, paddingBottom: 40 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backBtn:     { width: 60 },
  backText:    { fontSize: 16, color: ORANGE, fontWeight: '600' },
  headerSport: { fontSize: 14, fontWeight: '900', color: DARK, letterSpacing: 1 },

  // Title card
  titleCard: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  titleRow:  { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  iconWrap:  {
    width: 52, height: 52, backgroundColor: '#fff',
    borderRadius: 14, justifyContent: 'center', alignItems: 'center',
  },
  icon:      { fontSize: 26 },
  titleInfo: { flex: 1 },
  title:     { fontSize: 15, fontWeight: '800', color: DARK, lineHeight: 20 },
  date:      { fontSize: 12, color: '#888', marginTop: 4 },
  sourceBadge: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#D9D0C7',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  sourceText: { fontSize: 11, color: '#555', fontWeight: '600' },

  // Map placeholder
  mapPlaceholder: {
    backgroundColor: '#E0D8CF',
    borderRadius: 16,
    height: 180,
    marginBottom: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#CCC5BB',
    borderStyle: 'dashed',
  },
  mapIcon:  { fontSize: 32, marginBottom: 8 },
  mapLabel: { fontSize: 14, fontWeight: '700', color: DARK },
  mapSub:   { fontSize: 12, color: '#888', marginTop: 4 },

  // Section title
  sectionTitle: {
    fontSize: 13, fontWeight: '900', color: DARK,
    letterSpacing: 1, marginBottom: 10,
  },

  // Stats grid (3-column)
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  statCard: {
    width: (width - 52) / 3,
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 12,
  },
  statVal: { fontSize: 20, fontWeight: '900', color: DARK },
  statLbl: { fontSize: 9,  fontWeight: '700', color: '#888', letterSpacing: 0.6, marginTop: 4 },

  // Splits
  splitsCard: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 10,
  },
  splitBorder: { borderBottomWidth: 1, borderBottomColor: '#D9D0C7' },
  splitKm:     { width: 36, fontSize: 12, fontWeight: '700', color: '#888' },
  splitBarWrap:{ flex: 1, height: 6, backgroundColor: '#D9D0C7', borderRadius: 3 },
  splitBar:    { height: 6, backgroundColor: ORANGE, borderRadius: 3 },
  splitPace:   { width: 42, fontSize: 13, fontWeight: '800', color: DARK, textAlign: 'right' },
});
