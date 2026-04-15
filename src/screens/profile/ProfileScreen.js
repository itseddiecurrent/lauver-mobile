import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, TextInput, Image, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import DateTimePicker from '@react-native-community/datetimepicker';
import { signOut } from 'firebase/auth';
import { firebaseAuth } from '../../lib/firebase';
import { supabase } from '../../lib/supabase';

/*
  Supabase setup required:
  ─────────────────────────────────────────────────────
  -- 1. profiles table
  create table profiles (
    id           text primary key,   -- Firebase UID
    first_name   text,
    last_name    text,
    date_of_birth date,
    bio          text,
    city         text,
    radius       text default '10 km',
    sports       text[] default '{}',
    skill        text,
    looking_for  text,
    availability text[] default '{}',
    avatar_url   text,
    is_published boolean default false,
    updated_at   timestamptz default now()
  );
  alter table profiles enable row level security;
  create policy "own" on profiles using (true) with check (true); -- tighten once Firebase OIDC is enabled

  -- 2. Storage bucket
  insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
  create policy "avatars public read"  on storage.objects for select using (bucket_id = 'avatars');
  create policy "avatars owner write"  on storage.objects for insert using (bucket_id = 'avatars');
  create policy "avatars owner update" on storage.objects for update using (bucket_id = 'avatars');
  ─────────────────────────────────────────────────────
*/

const ORANGE  = '#E8602C';
const DARK    = '#1C1A18';
const BG      = '#F0EDE8';
const CARD_BG = '#EAE6DF';

const SPORTS_OPTIONS  = ['🏃 Running','🚴 Cycling','🧗 Climbing','🏊 Swimming','🥾 Hiking','⛷️ Skiing','🏋️ Gym','🧘 Yoga'];
const AVAIL_OPTIONS   = ['Early Mornings','Mornings','Evenings','Weekends','Flexible'];
const SKILL_OPTIONS   = ['Beginner','Intermediate','Advanced','Elite'];
const LOOKING_OPTIONS = ['Training Partner','Group & Partners','Running Buddy','Coach / Mentor'];
const RADIUS_OPTIONS  = ['5 km','10 km','25 km','50 km'];

function calcAge(dob) {
  if (!dob) return null;
  const today = new Date();
  const birth = new Date(dob);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function progressFromProfile(p) {
  const checks = [
    true,                                          // account always done
    true,                                          // email always done
    !!p.avatar_url,
    p.sports?.length > 0,
    !!p.city,
    !!p.bio,
    p.availability?.length > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

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

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving,         setSaving]         = useState(false);

  // Basic info
  const [firstName,  setFirstName]  = useState('');
  const [lastName,   setLastName]   = useState('');
  const [dob,        setDob]        = useState(null);      // Date object or null
  const [dobLocked,  setDobLocked]  = useState(false);     // true once saved
  const [showPicker, setShowPicker] = useState(false);
  const [bio,        setBio]        = useState('');

  // Location & availability
  const [city,   setCity]   = useState('');
  const [radius, setRadius] = useState('10 km');
  const [avail,  setAvail]  = useState([]);

  // Sports & skill
  const [sports,  setSports]  = useState([]);
  const [skill,   setSkill]   = useState('');
  const [looking, setLooking] = useState('');

  // Photo
  const [avatarUrl,    setAvatarUrl]    = useState(null);
  const [uploadingPic, setUploadingPic] = useState(false);

  const uid = firebaseAuth.currentUser?.uid;

  // ── Load profile ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!uid) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .single();
      if (data) {
        setFirstName(data.first_name  ?? '');
        setLastName (data.last_name   ?? '');
        setBio      (data.bio         ?? '');
        setCity     (data.city        ?? '');
        setRadius   (data.radius      ?? '10 km');
        setSports   (data.sports      ?? []);
        setSkill    (data.skill       ?? '');
        setLooking  (data.looking_for ?? '');
        setAvail    (data.availability ?? []);
        setAvatarUrl(data.avatar_url  ?? null);
        if (data.date_of_birth) {
          setDob(new Date(data.date_of_birth));
          setDobLocked(true);
        }
      }
      setLoadingProfile(false);
    })();
  }, [uid]);

  // ── Photo upload ─────────────────────────────────────────────────────────────

  async function handlePickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    if (result.canceled) return;

    setUploadingPic(true);
    try {
      const asset  = result.assets[0];
      const ext    = asset.uri.split('.').pop().toLowerCase().replace('jpeg', 'jpg');
      const path   = `${uid}/avatar.${ext}`;

      const { error } = await supabase.storage
        .from('avatars')
        .upload(path, decode(asset.base64), { contentType: `image/${ext}`, upsert: true });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(path);

      setAvatarUrl(publicUrl);
    } catch (e) {
      Alert.alert('Upload failed', e.message);
    } finally {
      setUploadingPic(false);
    }
  }

  // ── Save profile ─────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!uid) return;
    if (!firstName.trim()) { Alert.alert('Required', 'Please enter your first name.'); return; }
    if (!dob)              { Alert.alert('Required', 'Date of birth is required.'); return; }

    setSaving(true);
    try {
      const payload = {
        id:            uid,
        first_name:    firstName.trim(),
        last_name:     lastName.trim(),
        date_of_birth: dob.toISOString().split('T')[0],
        bio:           bio.trim(),
        city:          city.trim(),
        radius,
        sports,
        skill,
        looking_for:   looking,
        availability:  avail,
        avatar_url:    avatarUrl,
        updated_at:    new Date().toISOString(),
      };
      const { error } = await supabase.from('profiles').upsert(payload);
      if (error) throw error;
      setDobLocked(true);
      Alert.alert('Saved', 'Profile updated successfully!');
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const toggleItem = (list, setList, item) =>
    setList(list.includes(item) ? list.filter(i => i !== item) : [...list, item]);

  const profile = { avatar_url: avatarUrl, sports, city, bio, availability: avail };
  const progress = progressFromProfile(profile);

  const CHECKLIST = [
    { key: 'account',  label: 'Account created',   done: true },
    { key: 'email',    label: 'Email verified',     done: true },
    { key: 'photo',    label: 'Profile photo',      done: !!avatarUrl },
    { key: 'sports',   label: 'Sports selected',    done: sports.length > 0 },
    { key: 'location', label: 'Location set',       done: !!city },
    { key: 'bio',      label: 'Bio written',        done: !!bio },
    { key: 'avail',    label: 'Availability set',   done: avail.length > 0 },
  ];

  const age = calcAge(dob);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loadingProfile) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={ORANGE} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>MY PROFILE</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── Photo + Progress ── */}
        <View style={styles.progressCard}>
          <TouchableOpacity style={styles.photoArea} onPress={handlePickPhoto} activeOpacity={0.8}>
            {uploadingPic ? (
              <View style={styles.photoCircle}>
                <ActivityIndicator color={ORANGE} />
              </View>
            ) : avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.photoCircle} />
            ) : (
              <View style={styles.photoCircle}>
                <Text style={styles.photoIcon}>📷</Text>
              </View>
            )}
            <Text style={styles.photoLabel}>{avatarUrl ? 'Change photo' : 'Upload photo'}</Text>
          </TouchableOpacity>

          <View style={styles.progressSection}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>Profile Complete</Text>
              <Text style={styles.progressPct}>{progress}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
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

          {/* Date of Birth */}
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <FieldLabel>Date of Birth {dobLocked && '🔒'}</FieldLabel>
              {dobLocked ? (
                <View style={[styles.input, styles.inputLocked]}>
                  <Text style={styles.inputLockedText}>
                    {dob?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.input}
                  onPress={() => setShowPicker(true)}
                  activeOpacity={0.7}
                >
                  <Text style={dob ? styles.inputText : styles.inputPlaceholder}>
                    {dob
                      ? dob.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : 'Select date'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.fieldHalf}>
              <FieldLabel>Age</FieldLabel>
              <View style={[styles.input, styles.inputLocked]}>
                <Text style={age ? styles.inputLockedText : styles.inputPlaceholder}>
                  {age !== null ? `${age} years old` : 'Set DOB'}
                </Text>
              </View>
            </View>
          </View>

          {showPicker && (
            <DateTimePicker
              value={dob ?? new Date(2000, 0, 1)}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              maximumDate={new Date()}
              onChange={(_, selected) => {
                setShowPicker(Platform.OS === 'ios');
                if (selected) setDob(selected);
              }}
            />
          )}
          {showPicker && Platform.OS === 'ios' && (
            <TouchableOpacity style={styles.pickerDone} onPress={() => setShowPicker(false)}>
              <Text style={styles.pickerDoneText}>Done</Text>
            </TouchableOpacity>
          )}

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
          <SingleSelect options={RADIUS_OPTIONS} selected={radius} onSelect={setRadius} />

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

        {/* ── Save button ── */}
        <TouchableOpacity
          style={[styles.publishBtn, saving && styles.btnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.publishBtnText}>Save Profile →</Text>
          }
        </TouchableOpacity>

        {/* Sign out */}
        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={() => signOut(firebaseAuth)}
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  lockBadge: { backgroundColor: '#D9D0C7', borderRadius: 8, padding: 8, marginTop: 4 },
  lockText:  { fontSize: 10, color: '#555', fontWeight: '600', textAlign: 'center' },

  // Form card
  formCard:   { backgroundColor: CARD_BG, borderRadius: 16, marginHorizontal: 16, padding: 16, gap: 12 },
  fieldRow:   { flexDirection: 'row', gap: 10 },
  fieldHalf:  { flex: 1 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#666', letterSpacing: 0.4, marginBottom: 6 },
  input: {
    backgroundColor: '#fff', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: DARK,
  },
  inputText:        { fontSize: 14, color: DARK },
  inputPlaceholder: { fontSize: 14, color: '#BBB' },
  inputLocked:      { backgroundColor: '#E8E3DC' },
  inputLockedText:  { fontSize: 14, color: '#888' },
  textarea:         { minHeight: 90, paddingTop: 10 },

  // Date picker done button (iOS)
  pickerDone:     { alignItems: 'flex-end', paddingHorizontal: 4, marginTop: -4 },
  pickerDoneText: { fontSize: 14, fontWeight: '700', color: ORANGE },

  // Chip select
  chipGroup:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:           { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#D9D0C7' },
  chipActive:     { backgroundColor: DARK },
  chipText:       { fontSize: 12, fontWeight: '600', color: '#666' },
  chipTextActive: { color: '#fff' },

  // Save
  publishBtn: {
    backgroundColor: ORANGE, borderRadius: 16,
    marginHorizontal: 16, marginTop: 20,
    paddingVertical: 16, alignItems: 'center',
    shadowColor: ORANGE, shadowOpacity: 0.3,
    shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  publishBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  btnDisabled:    { opacity: 0.6 },

  // Sign out
  signOutBtn:  { alignItems: 'center', marginTop: 16, paddingVertical: 8 },
  signOutText: { fontSize: 14, color: '#AAA', fontWeight: '600' },
});
