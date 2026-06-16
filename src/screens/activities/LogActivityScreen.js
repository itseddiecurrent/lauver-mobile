import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, SafeAreaView, ActivityIndicator,
  Platform, Alert,
} from 'react-native';
import { useState, useMemo, useCallback } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../../context/ThemeContext';
import { useAuth }  from '../../hooks/useAuth';
import { insertActivity } from '../../lib/activities';

// ─── Config ───────────────────────────────────────────────────────────────────

const SPORTS = [
  { key: 'running',  label: 'Run',   emoji: '🏃' },
  { key: 'cycling',  label: 'Ride',  emoji: '🚴' },
  { key: 'climbing', label: 'Climb', emoji: '🧗' },
  { key: 'swimming', label: 'Swim',  emoji: '🏊' },
  { key: 'hiking',   label: 'Hike',  emoji: '🥾' },
  { key: 'skiing',   label: 'Ski',   emoji: '⛷️' },
  { key: 'gym',      label: 'Gym',   emoji: '💪' },
  { key: 'yoga',     label: 'Yoga',  emoji: '🧘' },
];

const DEFAULT_TITLES = {
  running:  'Morning Run',
  cycling:  'Ride',
  climbing: 'Climbing Session',
  swimming: 'Swim',
  hiking:   'Hike',
  skiing:   'Ski Day',
  gym:      'Gym Session',
  yoga:     'Yoga',
};

const DISTANCE_SPORTS = ['running', 'cycling', 'swimming', 'hiking'];
const ROUTES_SPORTS   = ['climbing'];

function fmtDate(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LogActivityScreen({ navigation }) {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { user } = useAuth();

  // ── Form state ──
  const [sport, setSport]         = useState('running');
  const [title, setTitle]         = useState(DEFAULT_TITLES['running']);
  const [startedAt, setStartedAt] = useState(new Date());
  const [mins, setMins]           = useState('');
  const [secs, setSecs]           = useState('');
  const [distance, setDistance]   = useState('');
  const [routes, setRoutes]       = useState('');
  const [calories, setCalories]   = useState('');
  const [notes, setNotes]         = useState('');

  // ── DateTimePicker state ──
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [pickerMode, setPickerMode]         = useState('date');

  // ── Submission ──
  const [saving, setSaving] = useState(false);

  const selectSport = useCallback((key) => {
    setSport(key);
    setTitle(DEFAULT_TITLES[key]);
    if (!DISTANCE_SPORTS.includes(key)) setDistance('');
    if (!ROUTES_SPORTS.includes(key))   setRoutes('');
  }, []);

  const totalSeconds = (parseInt(mins || '0', 10) * 60) + (parseInt(secs || '0', 10));

  const handleSave = useCallback(async () => {
    if (!title.trim())    return Alert.alert('Missing info', 'Please enter a title.');
    if (totalSeconds < 1) return Alert.alert('Missing info', 'Please enter a duration.');

    try {
      setSaving(true);
      await insertActivity(user.uid, {
        title:           title.trim(),
        sport,
        startedAt,
        durationSeconds: totalSeconds,
        distanceKm:      distance ? parseFloat(distance) : null,
        routesCount:     routes   ? parseInt(routes, 10)  : null,
        calories:        calories ? parseInt(calories, 10) : null,
        notes:           notes.trim() || null,
      });
      navigation.goBack();
    } catch (e) {
      setSaving(false);
      Alert.alert('Error', e.message || 'Failed to save activity.');
    }
  }, [user, sport, title, startedAt, totalSeconds, distance, routes, calories, notes, navigation]);

  const onDateChange = useCallback((_, selected) => {
    setShowDatePicker(false);
    setShowTimePicker(false);
    if (!selected) return;
    const next = new Date(startedAt);
    if (pickerMode === 'date') {
      next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    } else {
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    }
    setStartedAt(next);
  }, [startedAt, pickerMode]);

  const showDistance = DISTANCE_SPORTS.includes(sport);
  const showRoutes   = ROUTES_SPORTS.includes(sport);

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.cancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Log Activity</Text>
        {saving
          ? <ActivityIndicator size="small" color={c.ORANGE} style={{ width: 56 }} />
          : <TouchableOpacity onPress={handleSave} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={s.save}>Save</Text>
            </TouchableOpacity>
        }
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">

        {/* Sport */}
        <Text style={s.sectionLabel}>SPORT</Text>
        <View style={s.sportGrid}>
          {SPORTS.map(({ key, label, emoji }) => (
            <TouchableOpacity
              key={key}
              style={[s.sportChip, sport === key && s.sportChipActive]}
              onPress={() => selectSport(key)}
              activeOpacity={0.7}
            >
              <Text style={s.sportEmoji}>{emoji}</Text>
              <Text style={[s.sportLabel, sport === key && s.sportLabelActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Title */}
        <Text style={s.sectionLabel}>TITLE</Text>
        <TextInput
          style={s.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Activity name"
          placeholderTextColor={c.TEXT_MUTED}
          maxLength={80}
        />

        {/* Date / Time */}
        <Text style={s.sectionLabel}>DATE & TIME</Text>
        <View style={s.row}>
          <TouchableOpacity
            style={[s.input, s.rowHalf]}
            onPress={() => { setPickerMode('date'); setShowDatePicker(true); }}
            activeOpacity={0.8}
          >
            <Text style={s.inputText}>{fmtDate(startedAt)}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.input, s.rowHalf]}
            onPress={() => { setPickerMode('time'); setShowTimePicker(true); }}
            activeOpacity={0.8}
          >
            <Text style={s.inputText}>{fmtTime(startedAt)}</Text>
          </TouchableOpacity>
        </View>

        {(showDatePicker || showTimePicker) && (
          <DateTimePicker
            value={startedAt}
            mode={pickerMode}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={onDateChange}
            maximumDate={new Date()}
          />
        )}

        {/* Duration */}
        <Text style={s.sectionLabel}>DURATION</Text>
        <View style={s.row}>
          <View style={[s.inputWrap, s.rowHalf]}>
            <TextInput
              style={s.input}
              value={mins}
              onChangeText={setMins}
              placeholder="0"
              placeholderTextColor={c.TEXT_MUTED}
              keyboardType="number-pad"
              maxLength={4}
            />
            <Text style={s.inputUnit}>min</Text>
          </View>
          <View style={[s.inputWrap, s.rowHalf]}>
            <TextInput
              style={s.input}
              value={secs}
              onChangeText={setSecs}
              placeholder="0"
              placeholderTextColor={c.TEXT_MUTED}
              keyboardType="number-pad"
              maxLength={2}
            />
            <Text style={s.inputUnit}>sec</Text>
          </View>
        </View>

        {/* Distance (distance sports only) */}
        {showDistance && (
          <>
            <Text style={s.sectionLabel}>DISTANCE</Text>
            <View style={s.inputWrap}>
              <TextInput
                style={s.input}
                value={distance}
                onChangeText={setDistance}
                placeholder="0.0"
                placeholderTextColor={c.TEXT_MUTED}
                keyboardType="decimal-pad"
                maxLength={7}
              />
              <Text style={s.inputUnit}>km</Text>
            </View>
          </>
        )}

        {/* Routes (climbing only) */}
        {showRoutes && (
          <>
            <Text style={s.sectionLabel}>ROUTES COMPLETED</Text>
            <TextInput
              style={s.input}
              value={routes}
              onChangeText={setRoutes}
              placeholder="0"
              placeholderTextColor={c.TEXT_MUTED}
              keyboardType="number-pad"
              maxLength={3}
            />
          </>
        )}

        {/* Calories (optional) */}
        <Text style={s.sectionLabel}>CALORIES (optional)</Text>
        <View style={s.inputWrap}>
          <TextInput
            style={s.input}
            value={calories}
            onChangeText={setCalories}
            placeholder="—"
            placeholderTextColor={c.TEXT_MUTED}
            keyboardType="number-pad"
            maxLength={5}
          />
          <Text style={s.inputUnit}>kcal</Text>
        </View>

        {/* Notes */}
        <Text style={s.sectionLabel}>NOTES (optional)</Text>
        <TextInput
          style={[s.input, s.notesInput]}
          value={notes}
          onChangeText={setNotes}
          placeholder="How did it feel? Any highlights?"
          placeholderTextColor={c.TEXT_MUTED}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          maxLength={500}
        />

        <TouchableOpacity
          style={[s.saveBtn, saving && s.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={s.saveBtnText}>Save Activity</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(c) {
  return StyleSheet.create({
    root:        { flex: 1, backgroundColor: c.BG },
    scroll:      { flex: 1 },
    scrollContent: { padding: 16, paddingBottom: 48 },

    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: c.DIVIDER,
    },
    headerTitle: { fontSize: 17, fontWeight: '700', color: c.TEXT },
    cancel:      { fontSize: 16, color: c.TEXT_MUTED, width: 56 },
    save:        { fontSize: 16, fontWeight: '700', color: c.ORANGE, width: 56, textAlign: 'right' },

    sectionLabel: {
      fontSize: 11, fontWeight: '700', color: c.DARK_ORANGE,
      letterSpacing: 0.8, marginTop: 20, marginBottom: 8,
    },

    sportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    sportChip: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 14, paddingVertical: 9,
      borderRadius: 20, backgroundColor: c.CARD_BG,
      borderWidth: 1.5, borderColor: 'transparent',
    },
    sportChipActive: { borderColor: c.ORANGE, backgroundColor: c.INPUT_BG },
    sportEmoji:      { fontSize: 16 },
    sportLabel:      { fontSize: 13, fontWeight: '600', color: c.TEXT_SUB },
    sportLabelActive:{ color: c.ORANGE },

    row:      { flexDirection: 'row', gap: 10 },
    rowHalf:  { flex: 1 },
    inputWrap:{ position: 'relative' },

    input: {
      backgroundColor: c.INPUT_BG,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      color: c.TEXT,
    },
    inputText: { fontSize: 15, color: c.TEXT },
    inputUnit: {
      position: 'absolute', right: 12, top: 0, bottom: 0,
      textAlignVertical: 'center', lineHeight: 44,
      fontSize: 13, color: c.TEXT_MUTED, fontWeight: '600',
    },
    notesInput: { minHeight: 88, paddingTop: 12 },

    saveBtn: {
      marginTop: 32, backgroundColor: c.ORANGE,
      borderRadius: 16, paddingVertical: 16,
      alignItems: 'center',
    },
    saveBtnDisabled: { opacity: 0.6 },
    saveBtnText:     { color: '#fff', fontWeight: '800', fontSize: 16 },
  });
}
