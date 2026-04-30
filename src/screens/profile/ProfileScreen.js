import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, TextInput, Image, Platform, Alert, ActivityIndicator,
  Modal, Dimensions, StatusBar, Switch,
} from 'react-native';
import { useState, useEffect, useMemo } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import DateTimePicker from '@react-native-community/datetimepicker';
import { LinearGradient } from 'expo-linear-gradient';
import { signOut } from 'firebase/auth';
import { firebaseAuth } from '../../lib/firebase';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../context/ThemeContext';
import { useStravaConnect } from '../../hooks/useStravaConnect';
import { useAppleHealthConnect } from '../../hooks/useAppleHealthConnect';

/*
  Supabase — add columns if not present:
  alter table profiles add column if not exists photos         text[]  default '{}';
  alter table profiles add column if not exists unit_distance  text    default 'km';   -- 'km' | 'mi'
  alter table profiles add column if not exists unit_elevation text    default 'm';    -- 'm'  | 'ft'
  alter table profiles add column if not exists unit_weight    text    default 'kg';   -- 'kg' | 'lb'
*/

const { width: SW, height: SH } = Dimensions.get('window');
const SLOT_SIZE = (SW - 32 - 8) / 3;
const MAX_PHOTOS = 6;

const SPORTS_OPTIONS  = ['Running','Cycling','Climbing','Swimming','Hiking','Skiing','Gym','Yoga'];
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
    true,
    true,
    p.photos?.length > 0,
    p.sports?.length > 0,
    !!p.city,
    !!p.bio,
    p.availability?.length > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionTitle({ children, styles }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function FieldLabel({ children, styles }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

function ChipSelect({ options, selected, onToggle, styles }) {
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

function SingleSelect({ options, selected, onSelect, styles }) {
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

// ─── Photo Grid ───────────────────────────────────────────────────────────────

function PhotoGrid({ photos, uploadingSlot, selectedSlot, onAdd, onRemove, onSelect, onSwapOrMove, styles, c }) {
  const slots = Array.from({ length: MAX_PHOTOS });

  return (
    <View style={styles.photoGrid}>
      {slots.map((_, i) => {
        const url      = photos[i];
        const filled   = !!url;
        const loading  = uploadingSlot === i;
        const selected = selectedSlot === i;

        return (
          <TouchableOpacity
            key={i}
            style={[
              styles.photoSlot,
              selected && styles.photoSlotSelected,
              i === 0 && styles.photoSlotMain,
            ]}
            activeOpacity={0.8}
            onPress={() => {
              if (loading) return;
              if (filled) {
                if (selectedSlot !== null && selectedSlot !== i) {
                  onSwapOrMove(selectedSlot, i);
                } else {
                  onSelect(selected ? null : i);
                }
              } else {
                if (selectedSlot !== null) {
                  onSwapOrMove(selectedSlot, i);
                } else {
                  onAdd(i);
                }
              }
            }}
          >
            {loading ? (
              <ActivityIndicator color={c.ORANGE} />
            ) : filled ? (
              <>
                <Image source={{ uri: url }} style={styles.photoSlotImage} />
                {i === 0 && (
                  <View style={styles.mainBadge}>
                    <Text style={styles.mainBadgeText}>MAIN</Text>
                  </View>
                )}
                {selected && (
                  <View style={styles.selectedOverlay}>
                    <Text style={styles.selectedOverlayText}>↕ Move</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => onRemove(i)}
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                >
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.photoSlotEmpty}>
                <Text style={styles.photoSlotPlus}>+</Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { colors: c, isDark, toggleTheme } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving,         setSaving]         = useState(false);

  const [firstName,  setFirstName]  = useState('');
  const [dob,        setDob]        = useState(null);
  const [dobLocked,  setDobLocked]  = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [bio,        setBio]        = useState('');

  const [city,   setCity]   = useState('');
  const [radius, setRadius] = useState('10 km');
  const [avail,  setAvail]  = useState([]);

  const [sports,  setSports]  = useState([]);
  const [skill,   setSkill]   = useState('');
  const [looking, setLooking] = useState('');

  const [photos,        setPhotos]        = useState([]);
  const [uploadingSlot, setUploadingSlot] = useState(null);
  const [selectedSlot,  setSelectedSlot]  = useState(null);

  const [showPreview,  setShowPreview]  = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const apple  = useAppleHealthConnect();
  const [garminConnected, setGarminConnected] = useState(false);
  const strava = useStravaConnect();

  const [unitDistance,  setUnitDistance]  = useState('km');
  const [unitElevation, setUnitElevation] = useState('m');
  const [unitWeight,    setUnitWeight]    = useState('kg');

  const uid = firebaseAuth.currentUser?.uid;

  useEffect(() => {
    if (!uid) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .single();
      if (data) {
        setFirstName(data.first_name   ?? '');
        setBio      (data.bio          ?? '');
        setCity     (data.city         ?? '');
        setRadius   (data.radius       ?? '10 km');
        setSports   (data.sports       ?? []);
        setSkill    (data.skill        ?? '');
        setLooking  (data.looking_for  ?? '');
        setAvail        (data.availability   ?? []);
        setPhotos       (data.photos         ?? []);
        setUnitDistance (data.unit_distance  ?? 'km');
        setUnitElevation(data.unit_elevation ?? 'm');
        setUnitWeight   (data.unit_weight    ?? 'kg');
        if (data.date_of_birth) {
          setDob(new Date(data.date_of_birth));
          setDobLocked(true);
        }
      }
      setLoadingProfile(false);
    })();
  }, [uid]);

  async function addPhoto(slotIndex) {
    if (photos.length >= MAX_PHOTOS && !photos[slotIndex]) return;
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

    setUploadingSlot(slotIndex);
    try {
      const asset = result.assets[0];
      const ext   = asset.uri.split('.').pop().toLowerCase().replace('jpeg', 'jpg');
      const path  = `${uid}/photo_${slotIndex}_${Date.now()}.${ext}`;

      const { error } = await supabase.storage
        .from('avatars')
        .upload(path, decode(asset.base64), { contentType: `image/${ext}`, upsert: true });
      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);

      setPhotos(prev => {
        const next = [...prev];
        next[slotIndex] = publicUrl;
        while (next.length > 0 && !next[next.length - 1]) next.pop();
        return next;
      });
    } catch (e) {
      Alert.alert('Upload failed', e.message);
    } finally {
      setUploadingSlot(null);
    }
  }

  function removePhoto(index) {
    setSelectedSlot(null);
    setPhotos(prev => prev.filter((_, i) => i !== index));
  }

  function swapOrMove(fromIndex, toIndex) {
    setSelectedSlot(null);
    setPhotos(prev => {
      const next = Array.from({ length: MAX_PHOTOS }, (_, i) => prev[i] ?? null);
      const tmp = next[fromIndex];
      next[fromIndex] = next[toIndex];
      next[toIndex]   = tmp;
      while (next.length > 0 && !next[next.length - 1]) next.pop();
      return next;
    });
  }

  async function handleSave() {
    if (!uid) return;
    if (!firstName.trim()) { Alert.alert('Required', 'Please enter your name.'); return; }
    if (!dob)              { Alert.alert('Required', 'Date of birth is required.'); return; }

    setSaving(true);
    try {
      const { error } = await supabase.from('profiles').upsert({
        id:            uid,
        first_name:    firstName.trim(),
        date_of_birth: dob.toISOString().split('T')[0],
        bio:           bio.trim(),
        city:          city.trim(),
        radius,
        sports,
        skill,
        looking_for:   looking,
        availability:  avail,
        photos,
        unit_distance:  unitDistance,
        unit_elevation: unitElevation,
        unit_weight:    unitWeight,
        updated_at:     new Date().toISOString(),
      });
      if (error) throw error;
      setDobLocked(true);
      Alert.alert('Saved', 'Profile updated successfully!');
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  const toggleItem = (list, setList, item) =>
    setList(list.includes(item) ? list.filter(i => i !== item) : [...list, item]);

  const progress = progressFromProfile({ photos, sports, city, bio, availability: avail });
  const age      = calcAge(dob);

  const CHECKLIST = [
    { key: 'account',  label: 'Account created',  done: true },
    { key: 'email',    label: 'Email verified',    done: true },
    { key: 'photo',    label: 'Profile photo',     done: photos.length > 0 },
    { key: 'sports',   label: 'Sports selected',   done: sports.length > 0 },
    { key: 'location', label: 'Location set',      done: !!city },
    { key: 'bio',      label: 'Bio written',        done: !!bio },
    { key: 'avail',    label: 'Availability set',  done: avail.length > 0 },
  ];

  if (loadingProfile) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={c.ORANGE} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>MY PROFILE</Text>
        <TouchableOpacity style={styles.settingsBtn} onPress={() => setShowSettings(true)} activeOpacity={0.7}>
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── Photos ── */}
        <SectionTitle styles={styles}>PHOTOS</SectionTitle>
        <View style={styles.photosCard}>
          <Text style={styles.photosHint}>
            {selectedSlot !== null
              ? 'Tap another photo or empty slot to move it there. Tap the same to deselect.'
              : 'Tap a photo to reorder · tap + to add · tap ✕ to remove'}
          </Text>
          <PhotoGrid
            photos={photos}
            uploadingSlot={uploadingSlot}
            selectedSlot={selectedSlot}
            onAdd={addPhoto}
            onRemove={removePhoto}
            onSelect={setSelectedSlot}
            onSwapOrMove={swapOrMove}
            styles={styles}
            c={c}
          />
          <Text style={styles.photosCount}>{photos.length} / {MAX_PHOTOS} photos · First photo is your main</Text>
        </View>

        {/* ── Progress ── */}
        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>Profile Complete</Text>
            <Text style={styles.progressPct}>{progress}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <View style={styles.checklist}>
            {CHECKLIST.map(item => (
              <View key={item.key} style={styles.checkRow}>
                <View style={[styles.checkDot, item.done && styles.checkDotDone]}>
                  {item.done && <Text style={styles.checkMark}>✓</Text>}
                </View>
                <Text style={[styles.checkText, item.done && styles.checkTextDone]}>{item.label}</Text>
              </View>
            ))}
          </View>
          <View style={styles.lockBadge}>
            <Text style={styles.lockText}>Complete 100% to unlock athlete matching</Text>
          </View>
        </View>

        {/* ── Basic Info ── */}
        <SectionTitle styles={styles}>BASIC INFO</SectionTitle>
        <View style={styles.formCard}>
          <FieldLabel styles={styles}>Name</FieldLabel>
          <TextInput
            style={styles.input}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Your name"
            placeholderTextColor={c.TEXT_FAINT}
          />

          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <FieldLabel styles={styles}>Date of Birth {dobLocked && '(locked)'}</FieldLabel>
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
              <FieldLabel styles={styles}>Age</FieldLabel>
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

          <FieldLabel styles={styles}>Bio</FieldLabel>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={bio}
            onChangeText={setBio}
            placeholder="Tell athletes about yourself — your experience, goals, what you're looking for in a training partner…"
            placeholderTextColor={c.TEXT_FAINT}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* ── Location & Availability ── */}
        <SectionTitle styles={styles}>LOCATION & AVAILABILITY</SectionTitle>
        <View style={styles.formCard}>
          <FieldLabel styles={styles}>City</FieldLabel>
          <TextInput
            style={styles.input}
            value={city}
            onChangeText={setCity}
            placeholder="San Francisco"
            placeholderTextColor={c.TEXT_FAINT}
          />

          <FieldLabel styles={styles}>Search Radius</FieldLabel>
          <SingleSelect options={RADIUS_OPTIONS} selected={radius} onSelect={setRadius} styles={styles} />

          <FieldLabel styles={styles}>Availability</FieldLabel>
          <ChipSelect options={AVAIL_OPTIONS} selected={avail} onToggle={o => toggleItem(avail, setAvail, o)} styles={styles} />
        </View>

        {/* ── Sports & Skill ── */}
        <SectionTitle styles={styles}>SPORTS & SKILL LEVEL</SectionTitle>
        <View style={styles.formCard}>
          <FieldLabel styles={styles}>Your Sports</FieldLabel>
          <ChipSelect options={SPORTS_OPTIONS} selected={sports} onToggle={o => toggleItem(sports, setSports, o)} styles={styles} />

          <FieldLabel styles={styles}>Overall Skill Level</FieldLabel>
          <SingleSelect options={SKILL_OPTIONS} selected={skill} onSelect={setSkill} styles={styles} />

          <FieldLabel styles={styles}>Looking For</FieldLabel>
          <SingleSelect options={LOOKING_OPTIONS} selected={looking} onSelect={setLooking} styles={styles} />
        </View>

        {/* ── Save ── */}
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

        <TouchableOpacity
          style={styles.previewBtn}
          onPress={() => setShowPreview(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.previewBtnText}>See how your profile looks</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.signOutBtn} onPress={() => signOut(firebaseAuth)}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

      </ScrollView>

      {/* ══ Profile Preview Modal ══════════════════════════════════════════════ */}
      <Modal visible={showPreview} animationType="slide" statusBarTranslucent onRequestClose={() => setShowPreview(false)}>
        <View style={styles.modalRoot}>
          <StatusBar barStyle="light-content" />

          <View style={styles.previewBanner}>
            <Text style={styles.previewBannerText}>PREVIEW MODE</Text>
          </View>

          <View style={styles.card}>
            {photos[0] ? (
              <Image source={{ uri: photos[0] }} style={styles.cardPhoto} />
            ) : (
              <View style={[styles.cardPhoto, styles.cardPhotoPlaceholder]}>
                <Text style={styles.cardInitials}>{(firstName?.[0] ?? '?').toUpperCase()}</Text>
              </View>
            )}

            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.92)']}
              style={styles.cardGradient}
            />

            {photos.length > 1 && (
              <View style={styles.cardDots}>
                {photos.map((_, i) => (
                  <View key={i} style={[styles.cardDot, i === 0 && styles.cardDotActive]} />
                ))}
              </View>
            )}

            <View style={styles.cardInfo}>
              <View style={styles.cardNameRow}>
                <Text style={styles.cardName}>{firstName || 'Your Name'}</Text>
                {age !== null && (
                  <View style={styles.cardAgeBadge}>
                    <Text style={styles.cardAge}>{age}</Text>
                  </View>
                )}
              </View>

              {!!city && (
                <Text style={styles.cardCity}>{city}{radius ? `  ·  within ${radius}` : ''}</Text>
              )}

              {sports.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginBottom: 10 }}
                  contentContainerStyle={{ gap: 6 }}
                >
                  {sports.map(s => (
                    <View key={s} style={styles.cardSportChip}>
                      <Text style={styles.cardSportChipText}>{s}</Text>
                    </View>
                  ))}
                </ScrollView>
              )}

              <View style={styles.cardMetaRow}>
                {!!skill && (
                  <View style={styles.cardSkillBadge}>
                    <Text style={styles.cardSkillText}>{skill}</Text>
                  </View>
                )}
                {!!looking && (
                  <Text style={styles.cardLooking}>Looking for: {looking}</Text>
                )}
              </View>

              {!!bio && <Text style={styles.cardBio} numberOfLines={3}>{bio}</Text>}
            </View>
          </View>

          <View style={styles.actionRow}>
            <View style={[styles.actionBtn, styles.actionPass]}>
              <Text style={styles.actionPassIcon}>✕</Text>
            </View>
            <View style={[styles.actionBtn, styles.actionStar]}>
              <Text style={styles.actionStarIcon}>★</Text>
            </View>
            <View style={[styles.actionBtn, styles.actionLike]}>
              <Text style={styles.actionLikeIcon}>♥</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.closeBtn} onPress={() => setShowPreview(false)} activeOpacity={0.8}>
            <Text style={styles.closeBtnText}>Close Preview</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ══ Settings Modal ════════════════════════════════════════════════════ */}
      <Modal visible={showSettings} animationType="slide" onRequestClose={() => setShowSettings(false)}>
        <SafeAreaView style={styles.settingsRoot}>
          <View style={styles.settingsHeader}>
            <Text style={styles.settingsTitle}>Settings</Text>
            <TouchableOpacity onPress={() => setShowSettings(false)} activeOpacity={0.7}>
              <Text style={styles.settingsClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.settingsScroll} showsVerticalScrollIndicator={false}>

            {/* ── Appearance ── */}
            <Text style={styles.settingsSection}>APPEARANCE</Text>
            <View style={styles.appearanceRow}>
              <View>
                <Text style={styles.appearanceLabel}>Dark Mode</Text>
                <Text style={styles.appearanceSub}>{isDark ? 'Currently dark' : 'Currently light'}</Text>
              </View>
              <Switch
                value={isDark}
                onValueChange={toggleTheme}
                trackColor={{ false: '#D9D0C7', true: c.ORANGE }}
                thumbColor={isDark ? '#fff' : '#fff'}
              />
            </View>

            <View style={styles.settingsDivider} />

            {/* ── Units ── */}
            <Text style={styles.settingsSection}>UNITS</Text>
            <Text style={styles.settingsSectionSub}>Choose your preferred measurement units.</Text>

            {[
              { label: 'Distance',  options: ['km', 'mi'],  value: unitDistance,  setter: setUnitDistance  },
              { label: 'Elevation', options: ['m', 'ft'],   value: unitElevation, setter: setUnitElevation },
              { label: 'Weight',    options: ['kg', 'lb'],  value: unitWeight,    setter: setUnitWeight    },
            ].map(row => (
              <View key={row.label} style={styles.unitRow}>
                <Text style={styles.unitLabel}>{row.label}</Text>
                <View style={styles.unitToggle}>
                  {row.options.map(opt => (
                    <TouchableOpacity
                      key={opt}
                      style={[styles.unitOption, row.value === opt && styles.unitOptionActive]}
                      onPress={() => row.setter(opt)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.unitOptionText, row.value === opt && styles.unitOptionTextActive]}>
                        {opt}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}

            <TouchableOpacity
              style={styles.unitSaveBtn}
              onPress={handleSave}
              activeOpacity={0.85}
            >
              <Text style={styles.unitSaveBtnText}>Save Units</Text>
            </TouchableOpacity>

            <View style={styles.settingsDivider} />

            {/* ── Connected Apps ── */}
            <Text style={styles.settingsSection}>CONNECTED APPS</Text>
            <Text style={styles.settingsSectionSub}>Sync your workouts and health data automatically.</Text>

            {[
              { key: 'apple',  name: 'Apple Health',  label: 'AH', bg: '#FF2D55', desc: 'Sync workouts, heart rate, and activity rings from your iPhone and Apple Watch.', connected: apple.connected, onConnect: apple.connect, onDisconnect: apple.disconnect, loading: apple.syncing, sub: apple.available ? null : 'Requires dev build' },
              { key: 'garmin', name: 'Garmin Connect', label: 'GC', bg: '#007CC3', desc: 'Import runs, rides, swims and all activities recorded on your Garmin device.',    connected: garminConnected, onConnect: () => setGarminConnected(true), onDisconnect: () => setGarminConnected(false), loading: false },
              { key: 'strava', name: 'Strava',         label: 'ST', bg: '#FC4C02', desc: 'Pull in all your Strava activities and keep your training log in sync.',           connected: strava.connected, onConnect: strava.connect, onDisconnect: strava.disconnect, loading: strava.connecting, sub: strava.athleteName, reauth: strava.requiresReauth },
            ].map(app => (
              <View key={app.key} style={styles.integrationCard}>
                <View style={[styles.integrationIcon, { backgroundColor: app.bg }]}>
                  <Text style={styles.integrationEmoji}>{app.label}</Text>
                </View>
                <View style={styles.integrationInfo}>
                  <Text style={styles.integrationName}>{app.name}</Text>
                  <Text style={styles.integrationDesc}>{app.desc}</Text>
                  {app.connected && !app.reauth && (
                    <View style={styles.integrationStatus}>
                      <View style={styles.statusDot} />
                      <Text style={styles.statusText}>
                        {app.sub ? `Connected as ${app.sub}` : 'Connected · Syncing'}
                      </Text>
                    </View>
                  )}
                  {app.reauth && (
                    <View style={styles.integrationStatus}>
                      <View style={[styles.statusDot, { backgroundColor: '#E8602C' }]} />
                      <Text style={[styles.statusText, { color: '#E8602C' }]}>Reconnect required</Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity
                  style={[
                    styles.connectBtn,
                    app.connected && !app.reauth ? styles.connectBtnConnected : null,
                    app.reauth ? styles.connectBtnReauth : null,
                  ]}
                  onPress={app.connected && !app.reauth ? app.onDisconnect : app.onConnect}
                  disabled={app.loading}
                  activeOpacity={0.8}
                >
                  {app.loading
                    ? <ActivityIndicator size="small" color={app.connected && !app.reauth ? '#2E9E5B' : c.TEXT} />
                    : <Text style={[
                        styles.connectBtnText,
                        app.connected && !app.reauth ? styles.connectBtnTextConnected : null,
                        app.reauth ? styles.connectBtnTextReauth : null,
                      ]}>
                        {app.connected && !app.reauth ? 'Connected' : app.reauth ? 'Reconnect' : 'Connect'}
                      </Text>
                  }
                </TouchableOpacity>
              </View>
            ))}

            <Text style={styles.settingsNote}>More integrations coming soon — Wahoo, Polar, Suunto, and more.</Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
}

// ─── Styles factory ───────────────────────────────────────────────────────────

function makeStyles(c) {
  return StyleSheet.create({
    root:   { flex: 1, backgroundColor: c.BG },
    scroll: { paddingBottom: 40 },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    },
    headerTitle:  { fontSize: 20, fontWeight: '900', color: c.TEXT, letterSpacing: 1 },
    settingsBtn:  { padding: 6 },
    settingsIcon: { fontSize: 22 },

    sectionTitle: {
      fontSize: 13, fontWeight: '900', color: c.DARK_ORANGE,
      letterSpacing: 1, marginHorizontal: 16, marginTop: 20, marginBottom: 10,
    },

    // ── Photos ──
    photosCard:  { backgroundColor: c.CARD_BG, borderRadius: 16, marginHorizontal: 16, padding: 14 },
    photosHint:  { fontSize: 11, color: c.TEXT_MUTED, textAlign: 'center', marginBottom: 12 },
    photosCount: { fontSize: 11, color: c.TEXT_MUTED, textAlign: 'center', marginTop: 10 },

    photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    photoSlot: {
      width: SLOT_SIZE, height: SLOT_SIZE, borderRadius: 12,
      overflow: 'hidden', backgroundColor: c.DIVIDER,
      justifyContent: 'center', alignItems: 'center',
    },
    photoSlotMain:     { width: SLOT_SIZE * 2 + 4, height: SLOT_SIZE * 2 + 4 },
    photoSlotSelected: { borderWidth: 2.5, borderColor: c.ORANGE },
    photoSlotImage:    { width: '100%', height: '100%' },
    photoSlotEmpty:    { justifyContent: 'center', alignItems: 'center' },
    photoSlotPlus:     { fontSize: 28, color: c.TEXT_MUTED, fontWeight: '300' },

    mainBadge: {
      position: 'absolute', bottom: 6, left: 6,
      backgroundColor: c.ORANGE, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
    },
    mainBadgeText: { fontSize: 9, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },

    selectedOverlay: {
      position: 'absolute', inset: 0,
      backgroundColor: 'rgba(232,96,44,0.35)',
      justifyContent: 'center', alignItems: 'center',
    },
    selectedOverlayText: { fontSize: 13, fontWeight: '800', color: '#fff' },

    removeBtn: {
      position: 'absolute', top: 5, right: 5,
      width: 22, height: 22, borderRadius: 11,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center', alignItems: 'center',
    },
    removeBtnText: { fontSize: 10, color: '#fff', fontWeight: '800' },

    // ── Progress card ──
    progressCard:    { backgroundColor: c.CARD_BG, borderRadius: 16, marginHorizontal: 16, marginTop: 16, padding: 16 },
    progressHeader:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    progressLabel:   { fontSize: 12, fontWeight: '700', color: c.TEXT },
    progressPct:     { fontSize: 12, fontWeight: '900', color: c.ORANGE },
    progressTrack:   { height: 6, backgroundColor: c.DIVIDER, borderRadius: 3, marginBottom: 12 },
    progressFill:    { height: 6, backgroundColor: c.ORANGE, borderRadius: 3 },

    checklist:     { gap: 6, marginBottom: 10 },
    checkRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
    checkDot:      { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: c.DIVIDER, justifyContent: 'center', alignItems: 'center' },
    checkDotDone:  { backgroundColor: '#3A7D44', borderColor: '#3A7D44' },
    checkMark:     { color: '#fff', fontSize: 10, fontWeight: '900' },
    checkText:     { fontSize: 11, color: c.TEXT_MUTED },
    checkTextDone: { color: c.TEXT, fontWeight: '600' },
    lockBadge:     { backgroundColor: c.DIVIDER, borderRadius: 8, padding: 8, marginTop: 4 },
    lockText:      { fontSize: 10, color: c.TEXT_SUB, fontWeight: '600', textAlign: 'center' },

    // ── Form ──
    formCard:         { backgroundColor: c.CARD_BG, borderRadius: 16, marginHorizontal: 16, padding: 16, gap: 12 },
    fieldRow:         { flexDirection: 'row', gap: 10 },
    fieldHalf:        { flex: 1 },
    fieldLabel:       { fontSize: 11, fontWeight: '700', color: c.TEXT_SUB, letterSpacing: 0.4, marginBottom: 6 },
    input:            { backgroundColor: c.INPUT_BG, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: c.TEXT },
    inputText:        { fontSize: 14, color: c.TEXT },
    inputPlaceholder: { fontSize: 14, color: c.TEXT_FAINT },
    inputLocked:      { backgroundColor: c.BAR_EMPTY },
    inputLockedText:  { fontSize: 14, color: c.TEXT_MUTED },
    textarea:         { minHeight: 90, paddingTop: 10 },

    pickerDone:     { alignItems: 'flex-end', paddingHorizontal: 4, marginTop: -4 },
    pickerDoneText: { fontSize: 14, fontWeight: '700', color: c.ORANGE },

    // ── Chips ──
    chipGroup:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip:           { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: c.DIVIDER },
    chipActive:     { backgroundColor: c.TEXT },
    chipText:       { fontSize: 12, fontWeight: '600', color: c.TEXT_SUB },
    chipTextActive: { color: c.BG },

    // ── Buttons ──
    publishBtn: {
      backgroundColor: c.ORANGE, borderRadius: 16,
      marginHorizontal: 16, marginTop: 20,
      paddingVertical: 16, alignItems: 'center',
      shadowColor: c.ORANGE, shadowOpacity: 0.3,
      shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
    },
    publishBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    btnDisabled:    { opacity: 0.6 },

    previewBtn:     { marginHorizontal: 16, marginTop: 12, borderRadius: 16, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5, borderColor: c.TEXT },
    previewBtnText: { fontSize: 14, fontWeight: '700', color: c.TEXT },

    signOutBtn:  { alignItems: 'center', marginTop: 16, paddingVertical: 8 },
    signOutText: { fontSize: 14, color: c.TEXT_MUTED, fontWeight: '600' },

    // ══ Preview Modal ════════════════════════════════════════════════════════════
    modalRoot:         { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', paddingTop: 54, paddingBottom: 24 },
    previewBanner:     { backgroundColor: c.ORANGE, paddingHorizontal: 20, paddingVertical: 6, borderRadius: 20, marginBottom: 16 },
    previewBannerText: { fontSize: 11, fontWeight: '900', color: '#fff', letterSpacing: 1 },

    card:                 { width: SW - 32, height: SH * 0.58, borderRadius: 24, overflow: 'hidden', backgroundColor: '#222' },
    cardPhoto:            { width: '100%', height: '100%', position: 'absolute' },
    cardPhotoPlaceholder: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#333' },
    cardInitials:         { fontSize: 72, fontWeight: '900', color: '#666' },
    cardGradient:         { position: 'absolute', bottom: 0, left: 0, right: 0, height: '65%' },

    cardDots:      { position: 'absolute', top: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 4 },
    cardDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
    cardDotActive: { backgroundColor: '#fff', width: 18 },

    cardInfo:    { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20 },
    cardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
    cardName:    { fontSize: 32, fontWeight: '900', color: '#fff' },
    cardAgeBadge:{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
    cardAge:     { fontSize: 20, fontWeight: '700', color: '#fff' },
    cardCity:    { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginBottom: 10, fontWeight: '500' },

    cardSportChip:     { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
    cardSportChipText: { fontSize: 12, color: '#fff', fontWeight: '600' },
    cardMetaRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
    cardSkillBadge:    { backgroundColor: c.ORANGE, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
    cardSkillText:     { fontSize: 11, color: '#fff', fontWeight: '800' },
    cardLooking:       { fontSize: 12, color: 'rgba(255,255,255,0.65)' },
    cardBio:           { fontSize: 13, color: 'rgba(255,255,255,0.8)', lineHeight: 18 },

    actionRow:     { flexDirection: 'row', gap: 20, marginTop: 24, alignItems: 'center' },
    actionBtn:     { justifyContent: 'center', alignItems: 'center', borderRadius: 50, borderWidth: 2 },
    actionPass:    { width: 60, height: 60, borderColor: '#FF4D6D', backgroundColor: 'rgba(255,77,109,0.12)' },
    actionPassIcon:{ fontSize: 22, color: '#FF4D6D' },
    actionStar:    { width: 48, height: 48, borderColor: '#F5C518', backgroundColor: 'rgba(245,197,24,0.12)' },
    actionStarIcon:{ fontSize: 18, color: '#F5C518' },
    actionLike:    { width: 60, height: 60, borderColor: '#4CAF50', backgroundColor: 'rgba(76,175,80,0.12)' },
    actionLikeIcon:{ fontSize: 22, color: '#4CAF50' },

    closeBtn:     { marginTop: 20, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
    closeBtnText: { fontSize: 14, color: '#fff', fontWeight: '700' },

    // ══ Settings Modal ════════════════════════════════════════════════════════════
    settingsRoot:       { flex: 1, backgroundColor: c.BG },
    settingsHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: c.DIVIDER },
    settingsTitle:      { fontSize: 20, fontWeight: '900', color: c.TEXT },
    settingsClose:      { fontSize: 18, color: c.TEXT_MUTED, fontWeight: '700', padding: 4 },
    settingsScroll:     { padding: 20, paddingBottom: 40 },
    settingsSection:    { fontSize: 12, fontWeight: '900', color: c.DARK_ORANGE, letterSpacing: 1, marginBottom: 12 },
    settingsSectionSub: { fontSize: 13, color: c.TEXT_MUTED, lineHeight: 18, marginBottom: 20 },
    settingsNote:       { fontSize: 12, color: c.TEXT_MUTED, textAlign: 'center', marginTop: 8, lineHeight: 18 },
    settingsDivider:    { height: 1, backgroundColor: c.DIVIDER, marginVertical: 24 },

    appearanceRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.CARD_BG, borderRadius: 14, padding: 16, marginBottom: 4 },
    appearanceLabel:{ fontSize: 15, fontWeight: '700', color: c.TEXT },
    appearanceSub:  { fontSize: 12, color: c.TEXT_MUTED, marginTop: 2 },

    integrationCard:   { backgroundColor: c.CARD_BG, borderRadius: 16, padding: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 14 },
    integrationIcon:   { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
    integrationEmoji:  { fontSize: 13, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
    integrationInfo:   { flex: 1 },
    integrationName:   { fontSize: 15, fontWeight: '800', color: c.TEXT, marginBottom: 3 },
    integrationDesc:   { fontSize: 12, color: c.TEXT_MUTED, lineHeight: 17 },
    integrationStatus: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
    statusDot:         { width: 7, height: 7, borderRadius: 4, backgroundColor: '#3A7D44' },
    statusText:        { fontSize: 11, color: '#3A7D44', fontWeight: '600' },

    connectBtn:              { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: c.TEXT, flexShrink: 0 },
    connectBtnConnected:     { borderColor: '#2E9E5B', backgroundColor: 'transparent' },
    connectBtnReauth:        { borderColor: '#E8602C', backgroundColor: 'transparent' },
    connectBtnText:          { fontSize: 12, fontWeight: '700', color: c.TEXT },
    connectBtnTextConnected: { color: '#2E9E5B' },
    connectBtnTextReauth:    { color: '#E8602C' },

    unitRow:              { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    unitLabel:            { fontSize: 14, fontWeight: '600', color: c.TEXT },
    unitToggle:           { flexDirection: 'row', backgroundColor: c.DIVIDER, borderRadius: 10, padding: 3, gap: 3 },
    unitOption:           { paddingHorizontal: 18, paddingVertical: 6, borderRadius: 8 },
    unitOptionActive:     { backgroundColor: c.TEXT },
    unitOptionText:       { fontSize: 13, fontWeight: '700', color: c.TEXT_SUB },
    unitOptionTextActive: { color: c.BG },

    unitSaveBtn:     { backgroundColor: c.ORANGE, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
    unitSaveBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  });
}
