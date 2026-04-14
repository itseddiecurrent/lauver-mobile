import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, Dimensions, FlatList,
} from 'react-native';
import { useState } from 'react';

const { width } = Dimensions.get('window');
const ORANGE  = '#E8602C';
const DARK    = '#1C1A18';
const BG      = '#F0EDE8';
const CARD_BG = '#EAE6DF';

// ─── Mock data ─────────────────────────────────────────────────────────────────

const ALL_TIME_STATS = [
  { label: 'TOTAL ACTIVITIES', value: '47',   sub: 'all time' },
  { label: 'TOTAL DISTANCE',   value: '612',  sub: 'km all time' },
  { label: 'LONGEST',          value: '38.4', sub: 'km — Half Marathon' },
  { label: 'BEST PACE',        value: '4:32', sub: 'min / km' },
];

// Distance (km) per week under each period
const CHART_DATA = {
  Month:    [{ label: 'W1', km: 32 }, { label: 'W2', km: 48 }, { label: 'W3', km: 21 }, { label: 'W4', km: 56 }],
  '3 Months': [
    { label: 'W1', km: 28 }, { label: 'W2', km: 40 }, { label: 'W3', km: 15 },
    { label: 'W4', km: 52 }, { label: 'W5', km: 38 }, { label: 'W6', km: 44 },
    { label: 'W7', km: 21 }, { label: 'W8', km: 56 }, { label: 'W9', km: 30 },
    { label: 'W10', km: 48 }, { label: 'W11', km: 36 }, { label: 'W12', km: 60 },
  ],
  Year: [
    { label: 'Jan', km: 45 }, { label: 'Feb', km: 38 }, { label: 'Mar', km: 60 },
    { label: 'Apr', km: 72 }, { label: 'May', km: 55 }, { label: 'Jun', km: 80 },
    { label: 'Jul', km: 66 }, { label: 'Aug', km: 90 }, { label: 'Sep', km: 48 },
    { label: 'Oct', km: 70 }, { label: 'Nov', km: 42 }, { label: 'Dec', km: 56 },
  ],
};

const ACTIVITIES = [
  {
    id: '1', icon: '🏃', sport: 'Run',
    title: 'Morning Run — Riverside Trail',
    date: 'Today', time: '6:42 am',
    meta: 'Running · Avg pace 5:05/km · 312 kcal',
    stats: [{ val: '8.3 km', lbl: 'distance' }, { val: '42:17', lbl: 'time' }, { val: '148', lbl: 'bpm avg' }],
  },
  {
    id: '2', icon: '🚴', sport: 'Ride',
    title: 'Evening Ride — City Loop',
    date: 'Yesterday', time: '5:30 pm',
    meta: 'Cycling · Avg 23.7 km/h · 480 kcal',
    stats: [{ val: '24.6 km', lbl: 'distance' }, { val: '1:02:44', lbl: 'time' }, { val: '139', lbl: 'bpm avg' }],
  },
  {
    id: '3', icon: '🧗', sport: 'Climb',
    title: 'Bouldering Session — The Cave',
    date: '2 days ago', time: '7:00 pm',
    meta: 'Climbing · V3–V5',
    stats: [{ val: '14', lbl: 'routes' }, { val: '1:20:00', lbl: 'time' }],
  },
  {
    id: '4', icon: '🏊', sport: 'Swim',
    title: 'Lap Swim — Municipal Pool',
    date: '3 days ago', time: '7:15 am',
    meta: 'Swimming · 50m pool',
    stats: [{ val: '2.4 km', lbl: 'distance' }, { val: '48:22', lbl: 'time' }],
  },
  {
    id: '5', icon: '🥾', sport: 'Run',
    title: 'Trail Hike — North Ridge',
    date: '5 days ago', time: '8:00 am',
    meta: 'Hiking · 640m elevation',
    stats: [{ val: '12.1 km', lbl: 'distance' }, { val: '3:15:00', lbl: 'time' }],
  },
];

const FILTERS = ['All', '🏃 Run', '🚴 Ride', '🧗 Climb', '🏊 Swim'];
const PERIODS  = ['Month', '3 Months', 'Year'];

const BAR_MAX_H = 80;

// ─── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statSub}>{sub}</Text>
    </View>
  );
}

function DistanceChart({ period }) {
  const bars = CHART_DATA[period];
  const max  = Math.max(...bars.map(b => b.km));
  const last = bars[bars.length - 1];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chartScroll}
    >
      {bars.map((b) => {
        const h = Math.max(6, (b.km / max) * BAR_MAX_H);
        const isLast = b === last;
        return (
          <View key={b.label} style={styles.barCol}>
            <Text style={styles.barKm}>{b.km}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.bar, { height: h }, isLast ? styles.barActive : styles.barDefault]} />
            </View>
            <Text style={styles.barLabel}>{b.label}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

function ActivityCard({ item, onPress }) {
  return (
    <TouchableOpacity style={styles.actCard} activeOpacity={0.8} onPress={onPress}>
      <View style={styles.actTop}>
        <View style={styles.actIconWrap}>
          <Text style={styles.actIcon}>{item.icon}</Text>
        </View>
        <View style={styles.actInfo}>
          <Text style={styles.actTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.actDate}>{item.date} · {item.time}</Text>
          <Text style={styles.actMeta} numberOfLines={1}>{item.meta}</Text>
        </View>
        <Text style={styles.actChevron}>›</Text>
      </View>
      <View style={styles.actDivider} />
      <View style={styles.actStats}>
        {item.stats.map(s => (
          <View key={s.lbl} style={styles.actStat}>
            <Text style={styles.actStatVal}>{s.val}</Text>
            <Text style={styles.actStatLbl}>{s.lbl}</Text>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────

export default function ActivitiesScreen({ navigation }) {
  const [activePeriod, setActivePeriod] = useState('Month');
  const [activeFilter, setActiveFilter] = useState('All');

  const filtered = activeFilter === 'All'
    ? ACTIVITIES
    : ACTIVITIES.filter(a => activeFilter.includes(a.sport));

  return (
    <SafeAreaView style={styles.root}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>ACTIVITIES</Text>
        <TouchableOpacity style={styles.logBtn} activeOpacity={0.85}>
          <Text style={styles.logBtnText}>+ Log</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── All-time stat cards ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statsScroll}
        >
          {ALL_TIME_STATS.map(s => <StatCard key={s.label} {...s} />)}
        </ScrollView>

        {/* ── Distance by Week chart ── */}
        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <Text style={styles.sectionTitle}>DISTANCE BY WEEK</Text>
            <View style={styles.periodPills}>
              {PERIODS.map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.periodPill, activePeriod === p && styles.periodPillActive]}
                  onPress={() => setActivePeriod(p)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.periodPillText, activePeriod === p && styles.periodPillTextActive]}>
                    {p}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <DistanceChart period={activePeriod} />
          <Text style={styles.chartUnit}>km per week</Text>
        </View>

        {/* ── Activity list header + sport filters ── */}
        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>ALL ACTIVITIES</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.filterChip, activeFilter === f && styles.filterChipActive]}
              onPress={() => setActiveFilter(f)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterChipText, activeFilter === f && styles.filterChipTextActive]}>
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── Activity cards ── */}
        <View style={styles.actList}>
          {filtered.map(item => (
            <ActivityCard
              key={item.id}
              item={item}
              onPress={() => navigation.navigate('ActivityDetail', { id: item.id, title: item.title })}
            />
          ))}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  scroll: { paddingBottom: 32 },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 20, fontWeight: '900', color: DARK, letterSpacing: 1 },
  logBtn: {
    backgroundColor: ORANGE,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  logBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Stat cards (horizontal scroll)
  statsScroll: { paddingHorizontal: 16, gap: 10, marginBottom: 16 },
  statCard: {
    width: 150,
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 14,
  },
  statLabel: { fontSize: 10, fontWeight: '700', color: '#888', letterSpacing: 0.8, marginBottom: 4 },
  statValue: { fontSize: 30, fontWeight: '900', color: DARK, lineHeight: 34 },
  statSub:   { fontSize: 12, color: '#666', marginTop: 2 },

  // Chart card
  chartCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    marginHorizontal: 16,
    padding: 16,
    marginBottom: 20,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  periodPills:   { flexDirection: 'row', gap: 6 },
  periodPill:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: '#D9D0C7' },
  periodPillActive: { backgroundColor: DARK },
  periodPillText:   { fontSize: 11, fontWeight: '600', color: '#666' },
  periodPillTextActive: { color: '#fff' },
  chartScroll:   { paddingVertical: 8, gap: 6, alignItems: 'flex-end' },
  barCol:        { alignItems: 'center', width: 36 },
  barKm:         { fontSize: 9, color: '#999', marginBottom: 4 },
  barTrack:      { height: BAR_MAX_H, justifyContent: 'flex-end' },
  bar:           { width: 24, borderRadius: 6 },
  barActive:     { backgroundColor: ORANGE },
  barDefault:    { backgroundColor: '#C8BFAF' },
  barLabel:      { fontSize: 10, color: '#888', marginTop: 6 },
  chartUnit:     { fontSize: 10, color: '#AAA', marginTop: 6, textAlign: 'right' },

  // Section title
  sectionTitle: { fontSize: 13, fontWeight: '900', color: DARK, letterSpacing: 1 },

  // Filter chips
  listHeader:   { paddingHorizontal: 16, marginBottom: 10 },
  filterScroll: { paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: CARD_BG,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  filterChipActive:     { backgroundColor: DARK, borderColor: DARK },
  filterChipText:       { fontSize: 13, fontWeight: '600', color: '#555' },
  filterChipTextActive: { color: '#fff' },

  // Activity cards
  actList: { paddingHorizontal: 16, gap: 10 },
  actCard: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    padding: 14,
  },
  actTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actIconWrap: {
    width: 44,
    height: 44,
    backgroundColor: '#fff',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actIcon:    { fontSize: 22 },
  actInfo:    { flex: 1 },
  actTitle:   { fontSize: 14, fontWeight: '700', color: DARK },
  actDate:    { fontSize: 11, color: ORANGE, fontWeight: '600', marginTop: 2 },
  actMeta:    { fontSize: 11, color: '#888', marginTop: 1 },
  actChevron: { fontSize: 22, color: '#BBB', fontWeight: '300' },
  actDivider: { height: 1, backgroundColor: '#D9D0C7', marginVertical: 12 },
  actStats:   { flexDirection: 'row', gap: 20 },
  actStat:    {},
  actStatVal: { fontSize: 15, fontWeight: '800', color: DARK },
  actStatLbl: { fontSize: 10, color: '#999', fontWeight: '600', letterSpacing: 0.4, marginTop: 1 },
});
