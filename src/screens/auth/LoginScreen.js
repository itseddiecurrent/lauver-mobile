import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  SafeAreaView, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator, Image,
} from 'react-native';
import { useState } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithCredential,
} from 'firebase/auth';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { firebaseAuth } from '../../lib/firebase';

WebBrowser.maybeCompleteAuthSession();

const ORANGE  = '#E8602C';
const DARK    = '#1C1A18';
const BG      = '#F7F5F2';
const CARD_BG = '#EAE6DF';

export default function LoginScreen() {
  const [mode, setMode]         = useState('signin');
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');

  // Google OAuth via expo-auth-session
  // Needs EXPO_PUBLIC_GOOGLE_CLIENT_ID (web), IOS_CLIENT_ID, ANDROID_CLIENT_ID
  // set in .env and configured in Google Cloud Console + Firebase console
  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId:        process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId:     process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  });

  // ── Email / password ──────────────────────────────────────────────────────

  async function handleSubmit() {
    setError('');
    setSuccess('');
    if (!email || !password) { setError('Please enter your email and password.'); return; }
    setLoading(true);
    try {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      } else {
        if (!name.trim()) { setError('Please enter your name.'); setLoading(false); return; }
        const { user } = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
        await updateProfile(user, { displayName: name.trim() });
        setSuccess('Account created! Signing you in…');
      }
      // onAuthStateChanged in useAuth handles navigation automatically
    } catch (e) {
      setError(friendlyError(e.code));
    } finally {
      setLoading(false);
    }
  }

  // ── Google sign-in ────────────────────────────────────────────────────────

  async function handleGoogle() {
    setError('');
    try {
      const result = await promptAsync();
      if (result?.type === 'success') {
        const { id_token } = result.params;
        const credential = GoogleAuthProvider.credential(id_token);
        await signInWithCredential(firebaseAuth, credential);
        // onAuthStateChanged handles the rest
      }
    } catch (e) {
      setError(friendlyError(e.code));
    }
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  const googleReady = !!request;

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand */}
          <View style={styles.brand}>
            <Image
              source={require('../../../assets/lauver-logo.png')}
              style={styles.brandLogo}
              resizeMode="contain"
            />
            <Text style={styles.brandTag}>AI-Powered Athletic Community</Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {/* Tabs */}
            <View style={styles.tabs}>
              <TouchableOpacity
                style={[styles.tab, mode === 'signin' && styles.tabActive]}
                onPress={() => { setMode('signin'); setError(''); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabText, mode === 'signin' && styles.tabTextActive]}>Sign In</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, mode === 'signup' && styles.tabActive]}
                onPress={() => { setMode('signup'); setError(''); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>Create Account</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.cardTitle}>
              {mode === 'signin' ? 'Welcome back' : 'Join the pack'}
            </Text>

            {/* Name (signup only) */}
            {mode === 'signup' && (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>NAME</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  placeholderTextColor="#BBB"
                  autoCapitalize="words"
                />
              </View>
            )}

            {/* Email */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>EMAIL</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="#BBB"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Password */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={mode === 'signup' ? 'Min. 6 characters' : '••••••••'}
                placeholderTextColor="#BBB"
                secureTextEntry
              />
            </View>

            {/* Feedback */}
            {!!error   && <Text style={styles.error}>{error}</Text>}
            {!!success && <Text style={styles.successMsg}>{success}</Text>}

            {/* Submit */}
            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.submitBtnText}>
                    {mode === 'signin' ? 'Sign In' : 'Create Account'}
                  </Text>
              }
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Google */}
            <TouchableOpacity
              style={[styles.googleBtn, !googleReady && styles.btnDisabled]}
              onPress={handleGoogle}
              disabled={!googleReady}
              activeOpacity={0.85}
            >
              <Text style={styles.googleIcon}>G</Text>
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.footer}>
            By continuing you agree to Lauver's Terms of Service and Privacy Policy.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function friendlyError(code = '') {
  const map = {
    'auth/invalid-email':          'Please enter a valid email address.',
    'auth/user-not-found':         'No account found with this email.',
    'auth/wrong-password':         'Incorrect password.',
    'auth/invalid-credential':     'Incorrect email or password.',
    'auth/email-already-in-use':   'An account already exists with this email.',
    'auth/weak-password':          'Password must be at least 6 characters.',
    'auth/too-many-requests':      'Too many attempts. Please try again later.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },

  brand:     { alignItems: 'center', marginBottom: 32 },
  brandLogo: { width: 550, height: 180, marginBottom: 6 },
  brandTag:  { fontSize: 13, color: '#888' },

  card: { backgroundColor: CARD_BG, borderRadius: 24, padding: 24 },

  tabs:         { flexDirection: 'row', backgroundColor: '#D9D0C7', borderRadius: 14, padding: 4, marginBottom: 20 },
  tab:          { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive:    { backgroundColor: '#fff' },
  tabText:      { fontSize: 14, fontWeight: '600', color: '#888' },
  tabTextActive:{ color: DARK, fontWeight: '700' },

  cardTitle: { fontSize: 22, fontWeight: '900', color: DARK, marginBottom: 20 },

  field:      { marginBottom: 14 },
  fieldLabel: { fontSize: 10, fontWeight: '800', color: '#888', letterSpacing: 0.8, marginBottom: 6 },
  input: {
    backgroundColor: '#fff', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, color: DARK,
  },

  error:      { fontSize: 13, color: ORANGE,    marginBottom: 12, fontWeight: '500', lineHeight: 18 },
  successMsg: { fontSize: 13, color: '#2E9E5B', marginBottom: 12, fontWeight: '500', lineHeight: 18 },

  submitBtn: {
    backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 15, alignItems: 'center',
    shadowColor: ORANGE, shadowOpacity: 0.3, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  btnDisabled:   { opacity: 0.6 },

  divider:     { flexDirection: 'row', alignItems: 'center', marginVertical: 16, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#CCC5BB' },
  dividerText: { fontSize: 12, color: '#AAA', fontWeight: '600' },

  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 14, paddingVertical: 14,
    borderWidth: 1.5, borderColor: '#D9D0C7',
  },
  googleIcon:    { fontSize: 16, fontWeight: '900', color: '#4285F4' },
  googleBtnText: { fontSize: 15, fontWeight: '700', color: DARK },

  footer: { textAlign: 'center', fontSize: 11, color: '#AAA', marginTop: 20, lineHeight: 16 },
});
