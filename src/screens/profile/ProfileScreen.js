import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, TextInput,
} from 'react-native';
import { useState } from 'react';
import { supabase } from '../../lib/supabase';

const ORANGE  = '#E8602C';
const DARK    = '#1C1A18';
const BG      = '#F0EDE8';
const CARD_BG = '#EAE6DF';

// ─── Config ──────────────────────────────────────────────────────────────────────

const CHECKLIST = [
  { key: 'account', label: 'Account created',     done: true  },
  { key: 'email',   label: 'Email verified',       done: true  },
  { key: 'photo',   label: 'Profile photo',        done: false },
  { key: 'sports',  label: 'Sports selected',      done: false },
  { key: 'location',label: 'Location set',         done: false },
  { key: 'bio',     label: 'Bio written',          done: false },
  { key: 'avail',   label: 'Availability set',     done: false },
];

const SPORTS_OPTIONS = ['🏃 Running','🚴 Cycling','🧗 Climbing','🏊 Swimming','🥾 Hiking','⛷️ Skiing','🏋️ Gym','🧘 Yoga'];
const AVAIL_OPTIONS  = ['Early Mornings','Mornings','Evenings','Weekends','Flexible'];
const SKILL_OPTIONS  = ['Beginner','Intermediate','Advanced','Elite'];
const LOOKING_OPTIONS= ['Training Partner','Group & Partners','Running Buddy','Coach / Mentor'];

const PROGRESS = 40; // %

// ─── Sub-components ─────────────────────────────────────────────────────────────

function SectionTitle({ children }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function FieldLabel({ children }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

function ChipSelect({ options, selected, onToggle }) {
  return (
    <View style={styles.chipGroup}>
      {options.map(o => (
        <TouchableOpacity
          key={o}
          style={[styles.chip, selected.includes(o) && styles.chipActive]}
          onPress={() => onToggle(o)}
          activeOpacity={0.7}
        >
          <Text style={[styles.chipText, selected.includes(o) && styles.chipTextActive]}>{o}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function SingleSelect({ options, selected, onSelect }) {
  return (
    <View style={styles.chipGroup}>
      {options.map(o => (
        <TouchableOpacity
          key={o}
          style={[styles.chip, selected === o && styles.chipActive]}
          onPress={() => onSelect(o)}
          activeOpacity={0.7}
        >
          <Text style={[styles.chipText, selected === o && styles.chipTextActive]}>{o}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Main screen ────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  // Basic info
  const [firstName, setFirstName] = useState('Jane');
  const [lastName,  setLastName]  = useState('Smith');
  const [age,       setAge]       = useState('');
  const [bio,       setBio]       = useState('');

  // Location
  const [city,    setCity]    = useState('');
  const [radius,  setRadius]  = useState('10 km');

  // Sports & skill
  const [sports,  setSports]  = useState([]);
  const [skill,   setSkill]   = useState('');
  const [looking, setLooking] = useState('');

  // Availability
  const [avail, setAvail] = useState([]);

  const toggleItem = (list, setList, item) =>
    setList(list.includes(item) ? list.filter(i => i !== item) : [...list, item]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>MY PROFILE</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── Photo + Progress card ── */}
        <View style={styles.progressCard}>
          {/* Avatar */}
          <TouchableOpacity style={styles.photoArea} activeOpacity={0.8}>
            <View style={styles.photoCircle}>
              <Text style={styles.photoIcon}>📷</Text>
            </View>
            <Text style={styles.photoLabel}>Upload photo</Text>
          </TouchableOpacity>

          {/* Progress */}
          <View style={styles.progressSection}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>Profile Complete</Text>
              <Text style={styles.progressPct}>{PROGRESS}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${PROGRESS}%` }]} />
            </View>
            <View style={styles.checklist}>
              {CHECKLIST.map(c => (
                <View key={c.key} style={styles.checkRow}>
                  <View style={[styles.checkDot, c.done && styles.checkDotDone]}>
                    {c.done && <Text style={styles.checkMark}>✓</Text>}
                  </View>
                  <Text style={[styles.checkText, c.done && styles.checkTextDone]}>{c.label}</Text>
                </View>
              ))}
            </View>
            <View style={styles.lockBadge}>
              <Text style={styles.lockText}>🔒 Complete 100% to unlock athlete matching</Text>
            </View>
          </View>
        </View>

        {/* ── Basic Info ── */}
        <SectionTitle>BASIC INFO</SectionTitle>
        <View style={styles.formCard}>
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <FieldLabel>First Name</FieldLabel>
              <TextInput
                style={styles.input}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="Jane"
                placeholderTextColor="#BBB"
              />
            </View>
            <View style={styles.fieldHalf}>
              <FieldLabel>Last Name</FieldLabel>
              <TextInput
                style={styles.input}
                value={lastName}
                onChangeText={setLastName}
                placeholder="Smith"
                placeholderTextColor="#BBB"
              />
            </View>
          </View>

          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <FieldLabel>Age</FieldLabel>
              <TextInput
                style={styles.input}
                value={age}
                onChangeText={setAge}
                placeholder="28"
                keyboardType="number-pad"
                placeholderTextColor="#BBB"
              />
            </View>
          </View>

          <FieldLabel>Bio</FieldLabel>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={bio}
            onChangeText={setBio}
            placeholder="Tell athletes about yourself — your experience, goals, what you're looking for in a training partner…"
            placeholderTextColor="#BBB"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* ── Location & Availability ── */}
        <SectionTitle>LOCATION & AVAILABILITY</SectionTitle>
        <View style={styles.formCard}>
          <FieldLabel>City</FieldLabel>
          <TextInput
            style={styles.input}
            value={city}
            onChangeText={setCity}
            placeholder="San Francisco"
            placeholderTextColor="#BBB"
          />

          <FieldLabel>Search Radius</FieldLabel>
          <SingleSelect
            options={['5 km', '10 km', '25 km', '50 km']}
            selected={radius}
            onSelect={setRadius}
          />

          <FieldLabel>Availability</FieldLabel>
          <ChipSelect options={AVAIL_OPTIONS} selected={avail} onToggle={o => toggleItem(avail, setAvail, o)} />
        </View>

        {/* ── Sports & Skill ── */}
        <SectionTitle>SPORTS & SKILL LEVEL</SectionTitle>
        <View style={styles.formCard}>
          <FieldLabel>Your Sports</FieldLabel>
          <ChipSelect options={SPORTS_OPTIONS} selected={sports} onToggle={o => toggleItem(sports, setSports, o)} />

          <FieldLabel>Overall Skill Level</FieldLabel>
          <SingleSelect options={SKILL_OPTIONS} selected={skill} onSelect={setSkill} />

          <FieldLabel>Looking For</FieldLabel>
          <SingleSelect options={LOOKING_OPTIONS} selected={looking} onSelect={setLooking} />
        </View>

        {/* ── Identity Verification ── */}
        <SectionTitle>IDENTITY VERIFICATION</SectionTitle>
        <View style={styles.verifyCard}>
          <Text style={styles.verifyTitle}>Verify your identity</Text>
          <Text style={styles.verifySub}>
            Required to enable athlete matching. Upload a government ID or use selfie verification.
          </Text>
          <TouchableOpacity style={styles.verifyBtn} activeOpacity={0.85}>
            <Text style={styles.verifyBtnText}>Verify Now →</Text>
          </TouchableOpacity>
        </View>

        {/* ── Publish button ── */}
        <TouchableOpacity style={styles.publishBtn} activeOpacity={0.85}>
          <Text style={styles.publishBtnText}>Publish Profile & Unlock Matching →</Text>
        </TouchableOpacity>

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutBtn} onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  scroll: { paddingBottom: 40 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  headerTitle: { fontSize: 20, fontWeight: '900', color: DARK, letterSpacing: 1 },

  sectionTitle: {
    fontSize: 13, fontWeight: '900', color: DARK,
    letterSpacing: 1, marginHorizontal: 16, marginTop: 20, marginBottom: 10,
  },

  // Progress card
  progressCard: {
    backgroundColor: CARD_BG, borderRadius: 16,
    marginHorizontal: 16, padding: 16, flexDirection: 'row', gap: 16,
  },
  photoArea:   { alignItems: 'center', gap: 6 },
  photoCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#D9D0C7', justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#CCC', borderStyle: 'dashed',
  },
  photoIcon:  { fontSize: 28 },
  photoLabel: { fontSize: 11, color: '#888', fontWeight: '600', width: 72, textAlign: 'center' },

  progressSection: { flex: 1 },
  progressHeader:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel:   { fontSize: 12, fontWeight: '700', color: DARK },
  progressPct:     { fontSize: 12, fontWeight: '900', color: ORANGE },
  progressTrack:   { height: 6, backgroundColor: '#D9D0C7', borderRadius: 3, marginBottom: 12 },
  progressFill:    { height: 6, backgroundColor: ORANGE, borderRadius: 3 },

  checklist: { gap: 6, marginBottom: 10 },
  checkRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkDot:  {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 1.5, borderColor: '#CCC',
    justifyContent: 'center', alignItems: 'center',
  },
  checkDotDone:  { backgroundColor: '#3A7D44', borderColor: '#3A7D44' },
  checkMark:     { color: '#fff', fontSize: 10, fontWeight: '900' },
  checkText:     { fontSize: 11, color: '#888' },
  checkTextDone: { color: DARK, fontWeight: '600' },
  lockBadge: {
    backgroundColor: '#D9D0C7', borderRadius: 8,
    padding: 8, marginTop: 4,
  },
  lockText: { fontSize: 10, color: '#555', fontWeight: '600', textAlign: 'center' },

  // Form card
  formCard: { backgroundColor: CARD_BG, borderRadius: 16, marginHorizontal: 16, padding: 16, gap: 12 },
  fieldRow: { flexDirection: 'row', gap: 10 },
  fieldHalf:{ flex: 1 },
  fieldLabel:{ fontSize: 11, fontWeight: '700', color: '#666', letterSpacing: 0.4, marginBottom: 6 },
  input: {
    backgroundColor: '#fff', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: DARK,
  },
  textarea: { minHeight: 90, paddingTop: 10 },

  // Chip select
  chipGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:          { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#D9D0C7' },
  chipActive:    { backgroundColor: DARK },
  chipText:      { fontSize: 12, fontWeight: '600', color: '#666' },
  chipTextActive:{ color: '#fff' },

  // Verify
  verifyCard: {
    backgroundColor: CARD_BG, borderRadius: 16,
    marginHorizontal: 16, padding: 16,
  },
  verifyTitle: { fontSize: 14, fontWeight: '800', color: DARK, marginBottom: 6 },
  verifySub:   { fontSize: 13, color: '#666', lineHeight: 18, marginBottom: 14 },
  verifyBtn:   { backgroundColor: DARK, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  verifyBtnText:{ color: '#fff', fontSize: 14, fontWeight: '700' },

  // Publish
  publishBtn: {
    backgroundColor: ORANGE, borderRadius: 16,
    marginHorizontal: 16, marginTop: 20,
    paddingVertical: 16, alignItems: 'center',
    shadowColor: ORANGE, shadowOpacity: 0.3,
    shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  publishBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  // Sign out
  signOutBtn: { alignItems: 'center', marginTop: 16, paddingVertical: 8 },
  signOutText:{ fontSize: 14, color: '#AAA', fontWeight: '600' },
});
