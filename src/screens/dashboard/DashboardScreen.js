import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, SafeAreaView, Dimensions, Image,
} from 'react-native';
import { useMemo } from 'react';
import { useDashboard } from '../../hooks/useDashboard';
import { useTheme } from '../../context/ThemeContext';

const { width } = Dimensions.get('window');
const BAR_MAX_HEIGHT = 80;

// ─── Formatters ───────────────────────────────────────────────────────────────

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

function StatCard({ label, value, sub, note, styles }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statSub}>{sub}</Text>
      {note ? <Text style={styles.statNote}>{note}</Text> : null}
    </View>
  );
}

function WeeklyChart({ bars, styles, c }) {
  const max     = Math.max(...bars.map(b => b.mins), 1);
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
                  b.today && b.mins > 0 ? { backgroundColor: c.ORANGE }
                    : b.mins > 0        ? { backgroundColor: c.BAR_ACTIVE }
                                        : { backgroundColor: c.BAR_EMPTY, height: 4 },
                ]} />
              </View>
              <Text style={styles.barDay}>{b.day}</Text>
            </View>
          );
        })}
      </View>
      {!hasData && <Text style={styles.chartHint}>Log an activity to see your weekly chart</Text>}
    </View>
  );
}

function ActivityRow({ activity, styles, c }) {
  const sport = activity.sport.charAt(0).toUpperCase() + activity.sport.slice(1);
  const when  = `${relativeDate(activity.started_at)} · ${sport}`;

  return (
    <View style={styles.activityRow}>
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
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
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
          <ActivityIndicator size="large" color={c.ORANGE} />
        </View>
      ) : error ? (
        <View style={styles.loadingWrap}>
          <Text style={styles.errorText}>Could not load data.</Text>
          <TouchableOpacity onPress={refresh} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          <View style={styles.statsGrid}>
            <StatCard styles={styles} label="THIS WEEK"   value={String(weekStats.count)} sub="activities" />
            <StatCard styles={styles} label="DISTANCE"    value={weekStats.totalDistanceKm > 0 ? String(weekStats.totalDistanceKm) : '0'} sub="km this week" />
            <StatCard styles={styles} label="ACTIVE TIME" value={fmtWeekDuration(weekStats.totalDurationSeconds)} sub="this week" />
            <StatCard styles={styles} label="MATCHES"     value="—" sub="complete profile to unlock" note="profile incomplete" />
          </View>

          <WeeklyChart bars={chartBars} styles={styles} c={c} />

          <Text style={styles.sectionTitle}>RECENT ACTIVITIES</Text>
          {recentActivities.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No activities yet</Text>
              <Text style={styles.emptyBody}>Tap "+ Log Activity" to record your first workout.</Text>
            </View>
          ) : (
            <View style={styles.activitiesList}>
              {recentActivities.map(a => <ActivityRow key={a.id} activity={a} styles={styles} c={c} />)}
            </View>
          )}

          <Text style={[styles.sectionTitle, { marginTop: 20 }]}>QUICK STATS</Text>

          <View style={styles.quickCard}>
            <Text style={styles.quickCardTitle}>Month Total</Text>
            <View style={styles.quickRow}>
              <View>
                <Text style={[styles.quickBig, monthStats.count > 0 && styles.quickBigActive]}>{monthStats.count}</Text>
                <Text style={styles.quickSub}>activities</Text>
              </View>
              <View style={styles.quickDivider} />
              <View>
                <Text style={[styles.quickBig, monthStats.totalDistanceKm > 0 && styles.quickBigActive]}>{monthStats.totalDistanceKm}</Text>
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

// ─── Styles factory ───────────────────────────────────────────────────────────

function makeStyles(c) {
  return StyleSheet.create({
    root:   { flex: 1, backgroundColor: c.BG },
    scroll: { flex: 1 },
    scrollContent: { padding: 16 },

    loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
    errorText:   { fontSize: 14, color: c.TEXT_MUTED },
    retryBtn:    { backgroundColor: c.ORANGE, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 8 },
    retryText:   { color: '#fff', fontWeight: '700', fontSize: 13 },

    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingLeft: 6, paddingRight: 16, paddingTop: 8, paddingBottom: 8,
      backgroundColor: c.BG,
    },
    headerLeft: { alignItems: 'flex-start', justifyContent: 'center', flexShrink: 1 },
    headerLogo: { width: 240, height: 80, marginLeft: -60 },
    logBtn:     { marginLeft: 12, alignSelf: 'center', backgroundColor: c.ORANGE, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
    logBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

    statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
    statCard:  { width: (width - 42) / 2, backgroundColor: c.CARD_BG, borderRadius: 14, padding: 14 },
    statLabel: { fontSize: 10, fontWeight: '700', color: c.DARK_ORANGE, letterSpacing: 0.8, marginBottom: 4 },
    statValue: { fontSize: 30, fontWeight: '900', color: c.TEXT, lineHeight: 34 },
    statSub:   { fontSize: 12, color: c.TEXT_SUB, marginTop: 2 },
    statNote:  { fontSize: 11, color: c.TEXT_MUTED, marginTop: 4 },

    chartCard: { backgroundColor: c.CARD_BG, borderRadius: 14, padding: 16, marginBottom: 20 },
    barsRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 16, height: BAR_MAX_HEIGHT + 24 },
    barCol:    { flex: 1, alignItems: 'center' },
    barTrack:  { height: BAR_MAX_HEIGHT, justifyContent: 'flex-end' },
    bar:       { width: 28, borderRadius: 6 },
    barDay:    { fontSize: 10, color: c.TEXT_MUTED, marginTop: 6 },
    chartHint: { fontSize: 11, color: c.TEXT_MUTED, textAlign: 'center', marginTop: 4 },

    sectionTitle: { fontSize: 13, fontWeight: '900', color: c.DARK_ORANGE, letterSpacing: 1, marginBottom: 10 },

    activitiesList: { gap: 8, marginBottom: 20 },
    activityRow:    { backgroundColor: c.CARD_BG, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
    activityIcon:      { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    activityIconText:  { fontSize: 20 },
    activityInfo:      { flex: 1 },
    activityTitle:     { fontSize: 13, fontWeight: '700', color: c.TEXT },
    activityWhen:      { fontSize: 11, color: c.TEXT_MUTED, marginTop: 2 },
    activityStats:     { flexDirection: 'row', gap: 12 },
    activityStat:      { alignItems: 'flex-end' },
    activityStatVal:   { fontSize: 14, fontWeight: '800', color: c.TEXT },
    activityStatLabel: { fontSize: 9, color: c.TEXT_MUTED, fontWeight: '600', letterSpacing: 0.5 },

    emptyCard:  { backgroundColor: c.CARD_BG, borderRadius: 14, padding: 28, alignItems: 'center' },
    emptyIcon:  { fontSize: 32, marginBottom: 10, opacity: 0.4 },
    emptyTitle: { fontSize: 15, fontWeight: '700', color: c.TEXT, marginBottom: 4 },
    emptyBody:  { fontSize: 13, color: c.TEXT_MUTED, textAlign: 'center', lineHeight: 18 },

    quickCard:      { backgroundColor: c.CARD_BG, borderRadius: 14, padding: 16, marginBottom: 10 },
    quickCardTitle: { fontSize: 13, fontWeight: '700', color: c.DARK_ORANGE, marginBottom: 10 },
    quickRow:       { flexDirection: 'row', alignItems: 'center', gap: 24 },
    quickBig:       { fontSize: 32, fontWeight: '900', color: c.TEXT_FAINT },
    quickBigActive: { color: c.TEXT },
    quickSub:       { fontSize: 12, color: c.TEXT_MUTED },
    quickDivider:   { width: 1, height: 40, backgroundColor: c.DIVIDER },
    quickBody:      { fontSize: 13, color: c.TEXT_MUTED, lineHeight: 18, marginBottom: 6 },
    quickLink:      { fontSize: 13, fontWeight: '700', color: c.ORANGE },

    progressTrack: { height: 6, backgroundColor: c.DIVIDER, borderRadius: 3, marginVertical: 10 },
    progressFill:  { height: 6, backgroundColor: c.ORANGE, borderRadius: 3 },
  });
}
