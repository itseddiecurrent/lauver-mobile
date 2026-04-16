import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, SafeAreaView, Dimensions, Image,
} from 'react-native';
import { useDashboard } from '../../hooks/useDashboard';

const ORANGE  = '#E8602C';
const DARK    = '#1C1A18';
const BG      = '#F0EDE8';
const CARD_BG = '#EAE6DF';
const { width } = Dimensions.get('window');
const BAR_MAX_HEIGHT = 80;

// ─── Formatters ───────────────────────────────────────────────────────────────

const SPORT_ICONS = {
  running: '🏃', cycling: '🚴', swimming: '🏊',
  climbing: '🧗', hiking: '🥾', skiing: '⛷️',
  gym: '🏋️', yoga: '🧘',
};

function fmtWeekDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${String(m).padStart(2, '0')}`;
}

function fmtActivityDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function relativeDate(iso) {
  const d       = new Date(iso);
  const diffDay = Math.floor((Date.now() - d) / 86400000);
  const time    = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDay === 0) return `Today, ${time}`;
  if (diffDay === 1) return 'Yesterday';
  return `${diffDay} days ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, note }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statSub}>{sub}</Text>
      {note ? <Text style={styles.statNote}>{note}</Text> : null}
    </View>
  );
}

function WeeklyChart({ bars }) {
  const max = Math.max(...bars.map(b => b.mins), 1);
  const hasData = bars.some(b => b.mins > 0);

  return (
    <View style={styles.chartCard}>
      <Text style={styles.sectionTitle}>WEEKLY ACTIVITY</Text>
      <View style={styles.barsRow}>
        {bars.map(b => {
          const h = b.mins > 0 ? Math.max(8, (b.mins / max) * BAR_MAX_HEIGHT) : 4;
          return (
            <View key={b.day} style={styles.barCol}>
              <View style={styles.barTrack}>
                <View style={[
                  styles.bar,
                  { height: h },
                  b.today && b.mins > 0 ? styles.barToday
                    : b.mins > 0        ? styles.barActive
                                        : styles.barEmpty,
                ]} />
              </View>
              <Text style={styles.barDay}>{b.day}</Text>
            </View>
          );
        })}
      </View>
      {!hasData && (
        <Text style={styles.chartHint}>Log an activity to see your weekly chart</Text>
      )}
    </View>
  );
}

function ActivityRow({ activity }) {
  const icon   = SPORT_ICONS[activity.sport] ?? '🏅';
  const sport  = activity.sport.charAt(0).toUpperCase() + activity.sport.slice(1);
  const when   = `${relativeDate(activity.started_at)} · ${sport}`;

  return (
    <View style={styles.activityRow}>
      <View style={styles.activityIcon}>
        <Text style={styles.activityIconText}>{icon}</Text>
      </View>
      <View style={styles.activityInfo}>
        <Text style={styles.activityTitle} numberOfLines={1}>{activity.title}</Text>
        <Text style={styles.activityWhen}>{when}</Text>
      </View>
      <View style={styles.activityStats}>
        {activity.distance_km != null && (
          <View style={styles.activityStat}>
            <Text style={styles.activityStatVal}>{activity.distance_km}</Text>
            <Text style={styles.activityStatLabel}>KM</Text>
          </View>
        )}
        {activity.routes_count != null && (
          <View style={styles.activityStat}>
            <Text style={styles.activityStatVal}>{activity.routes_count}</Text>
            <Text style={styles.activityStatLabel}>ROUTES</Text>
          </View>
        )}
        <View style={styles.activityStat}>
          <Text style={styles.activityStatVal}>{fmtActivityDuration(activity.duration_seconds)}</Text>
          <Text style={styles.activityStatLabel}>TIME</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { weekStats, weeklyChart, recentActivities, monthStats, loading, error, refresh } = useDashboard();

  const chartBars = weeklyChart.length > 0
    ? weeklyChart
    : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day, i) => {
        const todayIdx = (() => { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; })();
        return { day, mins: 0, today: i === todayIdx };
      });

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image
            source={require('../../../assets/lauver-logo.png')}
            style={styles.headerLogo}
            resizeMode="contain"
          />
        </View>
        <TouchableOpacity style={styles.logBtn} activeOpacity={0.85}>
          <Text style={styles.logBtnText}>+ Log Activity</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={ORANGE} />
        </View>
      ) : error ? (
        <View style={styles.loadingWrap}>
          <Text style={styles.errorText}>Could not load data.</Text>
          <TouchableOpacity onPress={refresh} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ── This week stat cards ── */}
          <View style={styles.statsGrid}>
            <StatCard
              label="THIS WEEK"
              value={String(weekStats.count)}
              sub="activities"
            />
            <StatCard
              label="DISTANCE"
              value={weekStats.totalDistanceKm > 0 ? String(weekStats.totalDistanceKm) : '0'}
              sub="km this week"
            />
            <StatCard
              label="ACTIVE TIME"
              value={fmtWeekDuration(weekStats.totalDurationSeconds)}
              sub="this week"
            />
            <StatCard
              label="MATCHES"
              value="—"
              sub="complete profile to unlock"
              note="profile incomplete"
            />
          </View>

          {/* ── Weekly activity chart ── */}
          <WeeklyChart bars={chartBars} />

          {/* ── Recent activities ── */}
          <Text style={styles.sectionTitle}>RECENT ACTIVITIES</Text>
          {recentActivities.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>🏃</Text>
              <Text style={styles.emptyTitle}>No activities yet</Text>
              <Text style={styles.emptyBody}>Tap "+ Log Activity" to record your first workout.</Text>
            </View>
          ) : (
            <View style={styles.activitiesList}>
              {recentActivities.map(a => <ActivityRow key={a.id} activity={a} />)}
            </View>
          )}

          {/* ── Quick stats ── */}
          <Text style={[styles.sectionTitle, { marginTop: 20 }]}>QUICK STATS</Text>

          <View style={styles.quickCard}>
            <Text style={styles.quickCardTitle}>Month Total</Text>
            <View style={styles.quickRow}>
              <View>
                <Text style={[styles.quickBig, monthStats.count > 0 && styles.quickBigActive]}>
                  {monthStats.count}
                </Text>
                <Text style={styles.quickSub}>activities</Text>
              </View>
              <View style={styles.quickDivider} />
              <View>
                <Text style={[styles.quickBig, monthStats.totalDistanceKm > 0 && styles.quickBigActive]}>
                  {monthStats.totalDistanceKm}
                </Text>
                <Text style={styles.quickSub}>km</Text>
              </View>
            </View>
          </View>

          <View style={styles.quickCard}>
            <Text style={styles.quickCardTitle}>Community</Text>
            <Text style={styles.quickBody}>No posts yet. Join the community and share your first activity.</Text>
          </View>

          <View style={[styles.quickCard, { marginBottom: 32 }]}>
            <Text style={styles.quickCardTitle}>Profile</Text>
            <Text style={styles.quickBody}>0% complete — finish your profile to unlock athlete matching.</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: '0%' }]} />
            </View>
            <TouchableOpacity activeOpacity={0.7}>
              <Text style={styles.quickLink}>Complete profile →</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },

  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  errorText:   { fontSize: 14, color: '#888' },
  retryBtn:    { backgroundColor: ORANGE, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 8 },
  retryText:   { color: '#fff', fontWeight: '700', fontSize: 13 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 6,
    paddingRight: 16,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: BG,
  },
  headerLeft: { alignItems: 'flex-start', justifyContent: 'center', flexShrink: 1 },
  headerLogo: { width: 240, height: 80, marginLeft: -60 },
  logBtn: {
    marginLeft: 12,
    alignSelf: 'center',
    backgroundColor: ORANGE,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  logBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard:  { width: (width - 42) / 2, backgroundColor: CARD_BG, borderRadius: 14, padding: 14 },
  statLabel: { fontSize: 10, fontWeight: '700', color: '#888', letterSpacing: 0.8, marginBottom: 4 },
  statValue: { fontSize: 30, fontWeight: '900', color: DARK, lineHeight: 34 },
  statSub:   { fontSize: 12, color: '#666', marginTop: 2 },
  statNote:  { fontSize: 11, color: '#AAA', marginTop: 4 },

  chartCard: { backgroundColor: CARD_BG, borderRadius: 14, padding: 16, marginBottom: 20 },
  barsRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 16, height: BAR_MAX_HEIGHT + 24 },
  barCol:    { flex: 1, alignItems: 'center' },
  barTrack:  { height: BAR_MAX_HEIGHT, justifyContent: 'flex-end' },
  bar:       { width: 28, borderRadius: 6 },
  barToday:  { backgroundColor: ORANGE },
  barActive: { backgroundColor: '#D9C9B4' },
  barEmpty:  { backgroundColor: '#E0D9D0', height: 4 },
  barDay:    { fontSize: 10, color: '#BBB', marginTop: 6 },
  chartHint: { fontSize: 11, color: '#BBB', textAlign: 'center', marginTop: 4 },

  sectionTitle: { fontSize: 13, fontWeight: '900', color: DARK, letterSpacing: 1, marginBottom: 10 },

  activitiesList: { gap: 8, marginBottom: 20 },
  activityRow: {
    backgroundColor: CARD_BG, borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  activityIcon:      { width: 40, height: 40, backgroundColor: '#fff', borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  activityIconText:  { fontSize: 20 },
  activityInfo:      { flex: 1 },
  activityTitle:     { fontSize: 13, fontWeight: '700', color: DARK },
  activityWhen:      { fontSize: 11, color: '#888', marginTop: 2 },
  activityStats:     { flexDirection: 'row', gap: 12 },
  activityStat:      { alignItems: 'flex-end' },
  activityStatVal:   { fontSize: 14, fontWeight: '800', color: DARK },
  activityStatLabel: { fontSize: 9, color: '#999', fontWeight: '600', letterSpacing: 0.5 },

  emptyCard:  { backgroundColor: CARD_BG, borderRadius: 14, padding: 28, alignItems: 'center' },
  emptyIcon:  { fontSize: 32, marginBottom: 10, opacity: 0.4 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: DARK, marginBottom: 4 },
  emptyBody:  { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 18 },

  quickCard:       { backgroundColor: CARD_BG, borderRadius: 14, padding: 16, marginBottom: 10 },
  quickCardTitle:  { fontSize: 13, fontWeight: '700', color: DARK, marginBottom: 10 },
  quickRow:        { flexDirection: 'row', alignItems: 'center', gap: 24 },
  quickBig:        { fontSize: 32, fontWeight: '900', color: '#CCC' },
  quickBigActive:  { color: DARK },
  quickSub:        { fontSize: 12, color: '#AAA' },
  quickDivider:    { width: 1, height: 40, backgroundColor: '#CCC' },
  quickBody:       { fontSize: 13, color: '#AAA', lineHeight: 18, marginBottom: 6 },
  quickLink:       { fontSize: 13, fontWeight: '700', color: ORANGE },

  progressTrack: { height: 6, backgroundColor: '#D9D0C7', borderRadius: 3, marginVertical: 10 },
  progressFill:  { height: 6, backgroundColor: ORANGE, borderRadius: 3 },
});
