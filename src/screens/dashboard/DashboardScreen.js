import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, SafeAreaView, Dimensions,
} from 'react-native';

const ORANGE  = '#E8602C';
const DARK    = '#1C1A18';
const BG      = '#F0EDE8';
const CARD_BG = '#EAE6DF';
const { width } = Dimensions.get('window');

// ─── Mock data ────────────────────────────────────────────────────────────────
const STATS = [
  { label: 'THIS WEEK',   value: '3',    sub: 'activities',     delta: '+1 from last week', up: true  },
  { label: 'DISTANCE',    value: '42.1', sub: 'km this week',   delta: '+8.3 km',            up: true  },
  { label: 'ACTIVE TIME', value: '3h24', sub: 'this week',      delta: '-12 min',            up: false },
  { label: 'MATCHES',     value: '—',    sub: 'complete profile to unlock', delta: 'profile incomplete', up: null },
];

// Weekly bar data: minutes per day (0 = no activity)
const WEEK_BARS = [
  { day: 'Mon', mins: 42 },
  { day: 'Tue', mins: 65 },
  { day: 'Wed', mins: 0  },
  { day: 'Thu', mins: 80 },
  { day: 'Fri', mins: 90, today: true },
  { day: 'Sat', mins: 30 },
  { day: 'Sun', mins: 0  },
];

const ACTIVITIES = [
  { icon: '🏃', title: 'Morning Run — Riverside Trail', when: 'Today, 6:42 am · Running',   stat1: '8.3',  label1: 'KM',     stat2: '42:17',  label2: 'TIME'  },
  { icon: '🚴', title: 'Evening Ride — City Loop',      when: 'Yesterday · Cycling',         stat1: '24.6', label1: 'KM',     stat2: '1:02:44', label2: 'TIME'  },
  { icon: '🧗', title: 'Bouldering Session — The Cave', when: '2 days ago · Climbing',       stat1: '14',   label1: 'ROUTES', stat2: '1:20:00', label2: 'TIME'  },
];

const MAX_MINS = Math.max(...WEEK_BARS.map(b => b.mins));
const BAR_MAX_HEIGHT = 80;

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, delta, up }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statSub}>{sub}</Text>
      {delta ? (
        <Text style={[styles.statDelta, up === true && styles.deltaUp, up === false && styles.deltaDown]}>
          {up === true ? '↑ ' : up === false ? '↓ ' : ''}{delta}
        </Text>
      ) : null}
    </View>
  );
}

function WeeklyChart() {
  return (
    <View style={styles.chartCard}>
      <Text style={styles.sectionTitle}>WEEKLY ACTIVITY</Text>
      <View style={styles.barsRow}>
        {WEEK_BARS.map(b => {
          const h = b.mins > 0 ? Math.max(8, (b.mins / MAX_MINS) * BAR_MAX_HEIGHT) : 4;
          return (
            <View key={b.day} style={styles.barCol}>
              <View style={styles.barTrack}>
                <View style={[
                  styles.bar,
                  { height: h },
                  b.today ? styles.barToday : b.mins > 0 ? styles.barActive : styles.barEmpty,
                ]} />
              </View>
              <Text style={styles.barDay}>{b.day}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function ActivityRow({ icon, title, when, stat1, label1, stat2, label2 }) {
  return (
    <View style={styles.activityRow}>
      <View style={styles.activityIcon}>
        <Text style={styles.activityIconText}>{icon}</Text>
      </View>
      <View style={styles.activityInfo}>
        <Text style={styles.activityTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.activityWhen}>{when}</Text>
      </View>
      <View style={styles.activityStats}>
        <View style={styles.activityStat}>
          <Text style={styles.activityStatVal}>{stat1}</Text>
          <Text style={styles.activityStatLabel}>{label1}</Text>
        </View>
        <View style={styles.activityStat}>
          <Text style={styles.activityStatVal}>{stat2}</Text>
          <Text style={styles.activityStatLabel}>{label2}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DashboardScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>DASHBOARD</Text>
        <TouchableOpacity style={styles.logBtn} activeOpacity={0.85}>
          <Text style={styles.logBtnText}>+ Log Activity</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Stat cards (2×2 grid) ── */}
        <View style={styles.statsGrid}>
          {STATS.map(s => <StatCard key={s.label} {...s} />)}
        </View>

        {/* ── Weekly chart ── */}
        <WeeklyChart />

        {/* ── Recent Activities ── */}
        <Text style={styles.sectionTitle}>RECENT ACTIVITIES</Text>
        <View style={styles.activitiesList}>
          {ACTIVITIES.map(a => <ActivityRow key={a.title} {...a} />)}
        </View>

        {/* ── Quick Stats ── */}
        <Text style={styles.sectionTitle}>QUICK STATS</Text>

        <View style={styles.quickCard}>
          <Text style={styles.quickCardTitle}>Month Total</Text>
          <View style={styles.quickRow}>
            <View>
              <Text style={styles.quickBig}>11</Text>
              <Text style={styles.quickSub}>activities</Text>
            </View>
            <View style={styles.quickDivider} />
            <View>
              <Text style={styles.quickBig}>168</Text>
              <Text style={styles.quickSub}>km</Text>
            </View>
          </View>
        </View>

        <View style={styles.quickCard}>
          <Text style={styles.quickCardTitle}>Community</Text>
          <Text style={styles.quickBody}>3 new posts from athletes near you.</Text>
          <TouchableOpacity activeOpacity={0.7}>
            <Text style={styles.quickLink}>View feed →</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.quickCard, { marginBottom: 32 }]}>
          <Text style={styles.quickCardTitle}>Profile</Text>
          <Text style={styles.quickBody}>40% complete — finish to unlock athlete matching.</Text>
          {/* Progress bar */}
          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>
          <TouchableOpacity activeOpacity={0.7}>
            <Text style={styles.quickLink}>Complete profile →</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: BG,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: DARK,
    letterSpacing: 1,
  },
  logBtn: {
    backgroundColor: ORANGE,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  logBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Stats grid
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    width: (width - 42) / 2,
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 14,
  },
  statLabel: { fontSize: 10, fontWeight: '700', color: '#888', letterSpacing: 0.8, marginBottom: 4 },
  statValue: { fontSize: 30, fontWeight: '900', color: DARK, lineHeight: 34 },
  statSub:   { fontSize: 12, color: '#666', marginTop: 2 },
  statDelta: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  deltaUp:   { color: '#3A7D44' },
  deltaDown: { color: ORANGE },

  // Chart
  chartCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  barsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 16,
    height: BAR_MAX_HEIGHT + 24,
  },
  barCol:   { flex: 1, alignItems: 'center' },
  barTrack: { height: BAR_MAX_HEIGHT, justifyContent: 'flex-end' },
  bar:      { width: 28, borderRadius: 6 },
  barToday: { backgroundColor: ORANGE },
  barActive:{ backgroundColor: '#D9C9B4' },
  barEmpty: { backgroundColor: '#E5DFD7', height: 4 },
  barDay:   { fontSize: 10, color: '#999', marginTop: 6 },

  // Section title
  sectionTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: DARK,
    letterSpacing: 1,
    marginBottom: 10,
  },

  // Activities
  activitiesList: { gap: 8, marginBottom: 20 },
  activityRow: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  activityIcon: {
    width: 40,
    height: 40,
    backgroundColor: '#fff',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityIconText: { fontSize: 20 },
  activityInfo:     { flex: 1 },
  activityTitle:    { fontSize: 13, fontWeight: '700', color: DARK },
  activityWhen:     { fontSize: 11, color: '#888', marginTop: 2 },
  activityStats:    { flexDirection: 'row', gap: 12 },
  activityStat:     { alignItems: 'flex-end' },
  activityStatVal:  { fontSize: 14, fontWeight: '800', color: DARK },
  activityStatLabel:{ fontSize: 9, color: '#999', fontWeight: '600', letterSpacing: 0.5 },

  // Quick stats
  quickCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  quickCardTitle: { fontSize: 13, fontWeight: '700', color: DARK, marginBottom: 10 },
  quickRow:       { flexDirection: 'row', alignItems: 'center', gap: 24 },
  quickBig:       { fontSize: 32, fontWeight: '900', color: DARK },
  quickSub:       { fontSize: 12, color: '#888' },
  quickDivider:   { width: 1, height: 40, backgroundColor: '#CCC' },
  quickBody:      { fontSize: 13, color: '#555', lineHeight: 18, marginBottom: 6 },
  quickLink:      { fontSize: 13, fontWeight: '700', color: ORANGE },

  // Profile progress bar
  progressTrack: {
    height: 6,
    backgroundColor: '#D9D0C7',
    borderRadius: 3,
    marginVertical: 10,
  },
  progressFill: {
    width: '40%',
    height: 6,
    backgroundColor: ORANGE,
    borderRadius: 3,
  },
});
