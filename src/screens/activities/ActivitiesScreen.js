import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, ActivityIndicator,
} from 'react-native';
import { useActivities } from '../../hooks/useActivities';

const ORANGE  = '#E8602C';
const DARK    = '#1C1A18';
const BG      = '#F0EDE8';
const CARD_BG = '#EAE6DF';

const FILTERS = ['All', '🏃 Run', '🚴 Ride', '🧗 Climb', '🏊 Swim'];
const PERIODS  = ['Month', '3 Months', 'Year'];
const BAR_MAX_H = 80;

const SPORT_ICONS = {
  running: '🏃', cycling: '🚴', swimming: '🏊',
  climbing: '🧗', hiking: '🥾', skiing: '⛷️',
  gym: '🏋️', yoga: '🧘',
};

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtPace(secPerKm) {
  if (secPerKm == null) return '—';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function relativeDate(iso) {
  const diffDay = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (diffDay === 0) return 'Today';
  if (diffDay === 1) return 'Yesterday';
  return `${diffDay} days ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub }) {
  const isEmpty = value === '0' || value === '—';
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, isEmpty && styles.statValueEmpty]}>{value}</Text>
      <Text style={styles.statSub}>{sub}</Text>
    </View>
  );
}

function DistanceChart({ data, loading }) {
  if (loading) {
    return (
      <View style={styles.chartEmpty}>
        <ActivityIndicator size="small" color={ORANGE} />
      </View>
    );
  }

  const hasData = data.some(b => b.km > 0);
  if (!hasData) {
    return (
      <View style={styles.chartEmpty}>
        <Text style={styles.chartEmptyIcon}>📊</Text>
        <Text style={styles.chartEmptyText}>No data yet — log activities to see your distance chart</Text>
      </View>
    );
  }

  const max = Math.max(...data.map(b => b.km), 1);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chartScroll}
    >
      {data.map((b, i) => {
        const h       = Math.max(6, (b.km / max) * BAR_MAX_H);
        const isLast  = i === data.length - 1;
        return (
          <View key={b.label} style={styles.barCol}>
            <Text style={styles.barKm}>{b.km > 0 ? b.km : ''}</Text>
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
  const icon  = SPORT_ICONS[item.sport] ?? '🏅';
  const sport = item.sport.charAt(0).toUpperCase() + item.sport.slice(1);
  const time  = new Date(item.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <TouchableOpacity style={styles.actCard} activeOpacity={0.8} onPress={onPress}>
      <View style={styles.actTop}>
        <View style={styles.actIconWrap}>
          <Text style={styles.actIcon}>{icon}</Text>
        </View>
        <View style={styles.actInfo}>
          <Text style={styles.actTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.actDate}>{relativeDate(item.started_at)} · {time}</Text>
          <Text style={styles.actMeta} numberOfLines={1}>{sport}</Text>
        </View>
        <Text style={styles.actChevron}>›</Text>
      </View>
      <View style={styles.actDivider} />
      <View style={styles.actStats}>
        {item.distance_km != null && (
          <View style={styles.actStat}>
            <Text style={styles.actStatVal}>{item.distance_km} km</Text>
            <Text style={styles.actStatLbl}>distance</Text>
          </View>
        )}
        {item.routes_count != null && (
          <View style={styles.actStat}>
            <Text style={styles.actStatVal}>{item.routes_count}</Text>
            <Text style={styles.actStatLbl}>routes</Text>
          </View>
        )}
        <View style={styles.actStat}>
          <Text style={styles.actStatVal}>{fmtDuration(item.duration_seconds)}</Text>
          <Text style={styles.actStatLbl}>time</Text>
        </View>
        {item.avg_heart_rate != null && (
          <View style={styles.actStat}>
            <Text style={styles.actStatVal}>{item.avg_heart_rate}</Text>
            <Text style={styles.actStatLbl}>bpm avg</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ActivitiesScreen({ navigation }) {
  const {
    allTimeStats, chartData, activities,
    loading, chartLoading,
    activePeriod, setActivePeriod,
    activeFilter, setActiveFilter,
  } = useActivities();

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>ACTIVITIES</Text>
        <TouchableOpacity style={styles.logBtn} activeOpacity={0.85}>
          <Text style={styles.logBtnText}>+ Log</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={ORANGE} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

          {/* All-time stat cards */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.statsScroll}
          >
            <StatCard
              label="TOTAL ACTIVITIES"
              value={String(allTimeStats.count)}
              sub="all time"
            />
            <StatCard
              label="TOTAL DISTANCE"
              value={allTimeStats.totalDistanceKm > 0 ? String(allTimeStats.totalDistanceKm) : '0'}
              sub="km all time"
            />
            <StatCard
              label="LONGEST"
              value={allTimeStats.longestKm != null ? `${allTimeStats.longestKm} km` : '—'}
              sub={allTimeStats.longestKm != null ? 'single activity' : 'no activities yet'}
            />
            <StatCard
              label="BEST PACE"
              value={fmtPace(allTimeStats.bestPaceSecPerKm)}
              sub={allTimeStats.bestPaceSecPerKm != null ? 'min / km' : 'no activities yet'}
            />
          </ScrollView>

          {/* Distance chart */}
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
            <DistanceChart data={chartData} loading={chartLoading} />
            {chartData.some(b => b.km > 0) && (
              <Text style={styles.chartUnit}>km per week</Text>
            )}
          </View>

          {/* Sport filter + activity list */}
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

          {activities.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>🏅</Text>
              <Text style={styles.emptyTitle}>No activities logged yet</Text>
              <Text style={styles.emptyBody}>
                Tap "+ Log" to record your first run, ride, climb, or any sport.
              </Text>
              <TouchableOpacity style={styles.emptyBtn} activeOpacity={0.85}>
                <Text style={styles.emptyBtnText}>+ Log your first activity</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.actList}>
              {activities.map(item => (
                <ActivityCard
                  key={item.id}
                  item={item}
                  onPress={() => navigation.navigate('ActivityDetail', { id: item.id, title: item.title })}
                />
              ))}
            </View>
          )}

        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: BG },
  scroll:      { paddingBottom: 32 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  headerTitle: { fontSize: 20, fontWeight: '900', color: DARK, letterSpacing: 1 },
  logBtn:      { backgroundColor: ORANGE, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  logBtnText:  { color: '#fff', fontWeight: '700', fontSize: 13 },

  statsScroll:    { paddingHorizontal: 16, gap: 10, marginBottom: 16 },
  statCard:       { width: 150, backgroundColor: CARD_BG, borderRadius: 14, padding: 14 },
  statLabel:      { fontSize: 10, fontWeight: '700', color: '#888', letterSpacing: 0.8, marginBottom: 4 },
  statValue:      { fontSize: 28, fontWeight: '900', color: DARK, lineHeight: 32 },
  statValueEmpty: { color: '#CCC' },
  statSub:        { fontSize: 12, color: '#AAA', marginTop: 2 },

  chartCard:   { backgroundColor: CARD_BG, borderRadius: 14, marginHorizontal: 16, padding: 16, marginBottom: 20 },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  periodPills:          { flexDirection: 'row', gap: 6 },
  periodPill:           { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: '#D9D0C7' },
  periodPillActive:     { backgroundColor: DARK },
  periodPillText:       { fontSize: 11, fontWeight: '600', color: '#666' },
  periodPillTextActive: { color: '#fff' },
  chartScroll:  { paddingVertical: 8, gap: 6, alignItems: 'flex-end' },
  barCol:       { alignItems: 'center', width: 36 },
  barKm:        { fontSize: 9, color: '#999', marginBottom: 4 },
  barTrack:     { height: BAR_MAX_H, justifyContent: 'flex-end' },
  bar:          { width: 24, borderRadius: 6 },
  barActive:    { backgroundColor: ORANGE },
  barDefault:   { backgroundColor: '#C8BFAF' },
  barLabel:     { fontSize: 10, color: '#888', marginTop: 6 },
  chartUnit:    { fontSize: 10, color: '#AAA', marginTop: 6, textAlign: 'right' },
  chartEmpty:   { alignItems: 'center', paddingVertical: 28 },
  chartEmptyIcon: { fontSize: 28, marginBottom: 10, opacity: 0.35 },
  chartEmptyText: { fontSize: 12, color: '#AAA', textAlign: 'center', lineHeight: 18 },

  sectionTitle: { fontSize: 13, fontWeight: '900', color: DARK, letterSpacing: 1 },
  listHeader:   { paddingHorizontal: 16, marginBottom: 10 },
  filterScroll: { paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  filterChip:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: CARD_BG, borderWidth: 1.5, borderColor: 'transparent' },
  filterChipActive:   { backgroundColor: DARK, borderColor: DARK },
  filterChipText:     { fontSize: 13, fontWeight: '600', color: '#555' },
  filterChipTextActive:{ color: '#fff' },

  actList: { paddingHorizontal: 16, gap: 10 },
  actCard: { backgroundColor: CARD_BG, borderRadius: 16, padding: 14 },
  actTop:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actIconWrap: { width: 44, height: 44, backgroundColor: '#fff', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  actIcon:    { fontSize: 22 },
  actInfo:    { flex: 1 },
  actTitle:   { fontSize: 14, fontWeight: '700', color: DARK },
  actDate:    { fontSize: 11, color: ORANGE, fontWeight: '600', marginTop: 2 },
  actMeta:    { fontSize: 11, color: '#888', marginTop: 1 },
  actChevron: { fontSize: 22, color: '#BBB' },
  actDivider: { height: 1, backgroundColor: '#D9D0C7', marginVertical: 12 },
  actStats:   { flexDirection: 'row', gap: 20, flexWrap: 'wrap' },
  actStat:    {},
  actStatVal: { fontSize: 15, fontWeight: '800', color: DARK },
  actStatLbl: { fontSize: 10, color: '#999', fontWeight: '600', letterSpacing: 0.4, marginTop: 1 },

  emptyCard:  { backgroundColor: CARD_BG, borderRadius: 16, marginHorizontal: 16, padding: 32, alignItems: 'center' },
  emptyIcon:  { fontSize: 36, marginBottom: 12, opacity: 0.4 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: DARK, marginBottom: 6 },
  emptyBody:  { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  emptyBtn:   { backgroundColor: ORANGE, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 10 },
  emptyBtnText:{ color: '#fff', fontWeight: '700', fontSize: 13 },
});
