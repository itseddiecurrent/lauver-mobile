import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, ScrollView, Dimensions, Image,
} from 'react-native';

const { height } = Dimensions.get('window');
const ORANGE = '#E8602C';
const DARK   = '#1C1A18';

const SPORTS = [
  { icon: '🏃', label: 'Running' },
  { icon: '🚴', label: 'Cycling' },
  { icon: '🏊', label: 'Swimming' },
  { icon: '🧗', label: 'Climbing' },
  { icon: '🥾', label: 'Hiking' },
  { icon: '⛷️', label: 'Skiing' },
  { icon: '🏋️', label: 'Gym' },
  { icon: '🧘', label: 'Yoga' },
];

const STATS = [
  { value: '50+',       label: 'Sports' },
  { value: 'AI',        label: 'Matching' },
  { value: 'Beta',      label: 'Free Access' },
];

export default function LandingScreen({ navigation }) {
  return (
    <View style={styles.root}>

      {/* ── HERO (dark) ─────────────────────────── */}
      <View style={styles.hero}>
        <SafeAreaView>
          <Image
            source={require('../../assets/lauver-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.pill}>AI-Powered Athletic Community · Beta</Text>

          <Text style={styles.h1}>
            Find{'\n'}Your{'\n'}
            <Text style={styles.accent}>Pack.</Text>
          </Text>

          <Text style={styles.sub}>
            Track every stride, climb, and sprint.{'\n'}
            Let AI connect you with athletes who actually fit your life.
          </Text>

          {/* Stats row */}
          <View style={styles.statsRow}>
            {STATS.map(s => (
              <View key={s.label} style={styles.statItem}>
                <Text style={styles.statValue}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </SafeAreaView>
      </View>

      {/* ── BOTTOM (light) ──────────────────────── */}
      <View style={styles.bottom}>

        {/* Sport pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillsScroll}
        >
          {SPORTS.map(s => (
            <View key={s.label} style={styles.sportPill}>
              <Text style={styles.sportIcon}>{s.icon}</Text>
              <Text style={styles.sportLabel}>{s.label}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Value props */}
        <View style={styles.props}>
          {[
            { icon: '🎯', title: 'Smart Matching',   desc: 'AI pairs you with athletes who match your pace, schedule, and vibe.' },
            { icon: '📍', title: 'Local Community',  desc: 'Discover group rides, trail runs, and gym sessions near you.' },
            { icon: '📊', title: 'Track Everything', desc: 'Log activities from Garmin, Apple Watch, or manually.' },
          ].map(p => (
            <View key={p.title} style={styles.propRow}>
              <View style={styles.propIcon}>
                <Text style={styles.propIconText}>{p.icon}</Text>
              </View>
              <View style={styles.propText}>
                <Text style={styles.propTitle}>{p.title}</Text>
                <Text style={styles.propDesc}>{p.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* CTAs */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.btnPrimary}
            activeOpacity={0.85}
            onPress={() => navigation.replace('Main')}
          >
            <Text style={styles.btnPrimaryText}>Try the App  →</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.btnGhost}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={styles.btnGhostText}>Sign In</Text>
          </TouchableOpacity>
        </View>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: DARK },

  // ── Hero ──
  hero: {
    backgroundColor: DARK,
    paddingHorizontal: 28,
    paddingBottom: 28,
    minHeight: height * 0.46,
    justifyContent: 'flex-end',
  },
  logo: {
    width: 120,
    height: 40,
    marginBottom: 24,
    tintColor: '#fff',
  },
  pill: {
    color: ORANGE,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 18,
    textTransform: 'uppercase',
  },
  h1: {
    fontSize: 62,
    fontWeight: '900',
    lineHeight: 62,
    color: '#fff',
    marginBottom: 16,
  },
  accent: { color: ORANGE },
  sub: {
    fontSize: 15,
    color: '#AAA',
    lineHeight: 22,
    marginBottom: 28,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 0,
  },
  statItem: {
    flex: 1,
    borderLeftWidth: 1,
    borderLeftColor: '#333',
    paddingLeft: 14,
    marginRight: 4,
  },
  statValue: { color: '#fff', fontSize: 20, fontWeight: '800' },
  statLabel: { color: '#777', fontSize: 11, marginTop: 2 },

  // ── Bottom ──
  bottom: {
    flex: 1,
    backgroundColor: '#F7F5F2',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 24,
    paddingBottom: 8,
  },

  // Sport pills scroll
  pillsScroll: {
    paddingHorizontal: 24,
    gap: 8,
    marginBottom: 24,
  },
  sportPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sportIcon:  { fontSize: 16 },
  sportLabel: { fontSize: 13, fontWeight: '600', color: '#222' },

  // Value props
  props: {
    paddingHorizontal: 24,
    gap: 16,
    marginBottom: 24,
  },
  propRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  propIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  propIconText: { fontSize: 20 },
  propText:     { flex: 1 },
  propTitle:    { fontSize: 14, fontWeight: '700', color: '#1a1a1a', marginBottom: 2 },
  propDesc:     { fontSize: 13, color: '#777', lineHeight: 18 },

  // CTAs
  actions: {
    paddingHorizontal: 24,
    gap: 10,
    paddingBottom: 16,
  },
  btnPrimary: {
    backgroundColor: ORANGE,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: ORANGE,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
  btnGhost: {
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#DDD',
  },
  btnGhostText: { color: '#555', fontSize: 15, fontWeight: '600' },
});
