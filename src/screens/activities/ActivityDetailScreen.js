import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, SafeAreaView, Dimensions, ActivityIndicator,
} from 'react-native';
import { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useUnits } from '../../hooks/useUnits';
import { getActivityById } from '../../lib/activities';

const { width } = Dimensions.get('window');

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtDuration(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtPace(seconds, km) {
  if (!seconds || !km || km === 0) return '—';
  const secPerKm = seconds / km;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtSpeed(seconds, km) {
  if (!seconds || !km || km === 0) return '—';
  return (km / (seconds / 3600)).toFixed(1);
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diffDay = Math.floor((Date.now() - d) / 86400000);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (diffDay === 0) return `Today, ${dateStr} · ${time}`;
  if (diffDay === 1) return `Yesterday, ${dateStr} · ${time}`;
  return `${dateStr} · ${time}`;
}

function sourceLabel(canonical_source) {
  const MAP = {
    garmin: 'Garmin',
    apple:  'Apple Health',
    strava: 'Strava',
    manual: 'Manual entry',
  };
  return MAP[canonical_source] ?? 'Manual entry';
}

function capitalise(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

// ─── Build stats array from a DB activity row ─────────────────────────────────

function buildStats(activity, fmtDist = v => `${v} km`, fmtElev = v => `${v} m`) {
  const { sport, distance_km, duration_seconds, avg_heart_rate, calories, routes_count, elevation_gain_m } = activity;
  const stats = [];

  if (distance_km != null) {
    stats.push({ val: fmtDist(distance_km), lbl: 'DISTANCE' });
  }
  if (routes_count != null) {
    stats.push({ val: String(routes_count), lbl: 'ROUTES' });
  }

  stats.push({ val: fmtDuration(duration_seconds), lbl: 'TIME' });

  if (sport === 'running' && distance_km > 0) {
    stats.push({ val: fmtPace(duration_seconds, distance_km), lbl: 'AVG PACE (MIN/KM)' });
  }
  if ((sport === 'cycling' || sport === 'swimming') && distance_km > 0) {
    stats.push({ val: fmtSpeed(duration_seconds, distance_km), lbl: 'AVG SPEED (KM/H)' });
  }
  if (avg_heart_rate != null) {
    stats.push({ val: String(avg_heart_rate), lbl: 'AVG BPM' });
  }
  if (calories != null) {
    stats.push({ val: String(calories), lbl: 'CALORIES (KCAL)' });
  }
  if (elevation_gain_m != null) {
    stats.push({ val: fmtElev(elevation_gain_m), lbl: 'ELEVATION GAIN' });
  }

  return stats;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ActivityDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { fmtDistance, fmtElevation } = useUnits();

  const [activity, setActivity] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getActivityById(id)
      .then(data => { if (!cancelled) { setActivity(data); setLoading(false); } })
      .catch(e   => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id]);

  const stats = activity ? buildStats(activity, fmtDistance, fmtElevation) : [];

  return (
    <SafeAreaView style={s.root}>

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={s.headerSport}>
          {activity ? capitalise(activity.sport).toUpperCase() : ''}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={c.ORANGE} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.retryBtn}>
            <Text style={s.retryText}>Go back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

          {/* Title card */}
          <View style={s.titleCard}>
            <Text style={s.title}>{activity.title}</Text>
            <Text style={s.date}>{fmtDate(activity.started_at)}</Text>
            <View style={s.sourceBadge}>
              <Text style={s.sourceText}>{sourceLabel(activity.canonical_source)}</Text>
            </View>
            {activity.notes ? (
              <Text style={s.notes}>{activity.notes}</Text>
            ) : null}
          </View>

          {/* Map placeholder — GPS tracks not yet supported */}
          <View style={s.mapPlaceholder}>
            <Text style={s.mapLabel}>Route map</Text>
            <Text style={s.mapSub}>GPS tracks not yet supported</Text>
          </View>

          {/* Stats grid */}
          {stats.length > 0 && (
            <>
              <Text style={s.sectionTitle}>STATS</Text>
              <View style={s.statsGrid}>
                {stats.map(st => (
                  <View key={st.lbl} style={s.statCard}>
                    <Text style={s.statVal}>{st.val}</Text>
                    <Text style={s.statLbl}>{st.lbl}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles factory ───────────────────────────────────────────────────────────

function makeStyles(c) {
  return StyleSheet.create({
    root:   { flex: 1, backgroundColor: c.BG },
    scroll: { padding: 16, paddingBottom: 40 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },

    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    },
    backBtn:     { width: 60 },
    backText:    { fontSize: 16, color: c.ORANGE, fontWeight: '600' },
    headerSport: { fontSize: 14, fontWeight: '900', color: c.TEXT, letterSpacing: 1 },

    errorText: { fontSize: 14, color: c.TEXT_MUTED, textAlign: 'center' },
    retryBtn:  { backgroundColor: c.ORANGE, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 8 },
    retryText: { color: '#fff', fontWeight: '700', fontSize: 13 },

    titleCard:   { backgroundColor: c.CARD_BG, borderRadius: 16, padding: 16, marginBottom: 12 },
    title:       { fontSize: 16, fontWeight: '800', color: c.TEXT, lineHeight: 22 },
    date:        { fontSize: 12, color: c.TEXT_MUTED, marginTop: 4 },
    sourceBadge: { marginTop: 8, alignSelf: 'flex-start', backgroundColor: c.ELEVATED, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
    sourceText:  { fontSize: 11, color: c.TEXT_SUB, fontWeight: '600' },
    notes:       { fontSize: 13, color: c.TEXT_SUB, marginTop: 12, lineHeight: 18 },

    mapPlaceholder: {
      backgroundColor: c.CARD_BG, borderRadius: 16, height: 160, marginBottom: 20,
      justifyContent: 'center', alignItems: 'center',
      borderWidth: 1.5, borderColor: c.DIVIDER, borderStyle: 'dashed',
    },
    mapLabel: { fontSize: 14, fontWeight: '700', color: c.TEXT },
    mapSub:   { fontSize: 12, color: c.TEXT_MUTED, marginTop: 4 },

    sectionTitle: { fontSize: 13, fontWeight: '900', color: c.DARK_ORANGE, letterSpacing: 1, marginBottom: 10 },

    statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
    statCard:  { width: (width - 52) / 3, backgroundColor: c.CARD_BG, borderRadius: 14, padding: 12 },
    statVal:   { fontSize: 20, fontWeight: '900', color: c.TEXT },
    statLbl:   { fontSize: 9, fontWeight: '700', color: c.TEXT_MUTED, letterSpacing: 0.6, marginTop: 4 },
  });
}
