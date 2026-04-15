import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  SafeAreaView, KeyboardAvoidingView, Platform, ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from '../../lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const ORANGE  = '#E8602C';
const DARK    = '#1C1A18';
const BG      = '#F7F5F2';
const CARD_BG = '#EAE6DF';

export default function LoginScreen() {
  const [mode, setMode]         = useState('signin'); // 'signin' | 'signup'
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError]       = useState('');

  // ── Email / password ────────────────────────────────────────────────────────

  async function handleSubmit() {
    setError('');
    if (!email || !password) { setError('Please enter your email and password.'); return; }

    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        if (!name.trim()) { setError('Please enter your name.'); setLoading(false); return; }
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } },
        });
        if (error) throw error;
        setError('Check your email to confirm your account, then sign in.');
        setMode('signin');
      }
    } catch (e) {
      setError(friendlyError(e.message));
    } finally {
      setLoading(false);
    }
  }

  // ── Google OAuth ─────────────────────────────────────────────────────────────

  async function handleGoogle() {
    setError('');
    setGoogleLoading(true);
    try {
      const redirectUrl = Linking.createURL('/');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options:  { redirectTo: redirectUrl, skipBrowserRedirect: true },
      });
      if (error) throw error;

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

      if (result.type === 'success' && result.url) {
        // createSessionFromUrl is called by the Linking listener in useAuth
        // but also handle it here in case of timing
        const { createSessionFromUrl } = await import('../../lib/supabase');
        await createSessionFromUrl(result.url);
      }
    } catch (e) {
      setError(friendlyError(e.message));
    } finally {
      setGoogleLoading(false);
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────────────

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
            <Text style={styles.brandName}>lauver<Text style={styles.brandDot}>.</Text></Text>
            <Text style={styles.brandTag}>AI-Powered Athletic Community</Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {/* Mode tabs */}
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

            {/* Error */}
            {!!error && <Text style={styles.error}>{error}</Text>}

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
              style={[styles.googleBtn, googleLoading && styles.btnDisabled]}
              onPress={handleGoogle}
              disabled={googleLoading}
              activeOpacity={0.85}
            >
              {googleLoading
                ? <ActivityIndicator color={DARK} />
                : <>
                    <Text style={styles.googleIcon}>G</Text>
                    <Text style={styles.googleBtnText}>Continue with Google</Text>
                  </>
              }
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

function friendlyError(message = '') {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials') || m.includes('invalid email or password'))
    return 'Incorrect email or password.';
  if (m.includes('user already registered') || m.includes('already been registered'))
    return 'An account already exists with this email. Sign in instead.';
  if (m.includes('password should be at least'))
    return 'Password must be at least 6 characters.';
  if (m.includes('unable to validate email') || m.includes('invalid email'))
    return 'Please enter a valid email address.';
  if (m.includes('email rate limit') || m.includes('too many requests'))
    return 'Too many attempts. Please wait and try again.';
  if (m.includes('network') || m.includes('fetch'))
    return 'Network error. Check your connection.';
  return 'Something went wrong. Please try again.';
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },

  // Brand
  brand:    { alignItems: 'center', marginBottom: 32 },
  brandName:{ fontSize: 40, fontWeight: '900', color: DARK, letterSpacing: -1 },
  brandDot: { color: ORANGE },
  brandTag: { fontSize: 13, color: '#888', marginTop: 4 },

  // Card
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 24,
    padding: 24,
  },

  // Tabs
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#D9D0C7',
    borderRadius: 14,
    padding: 4,
    marginBottom: 20,
  },
  tab:          { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive:    { backgroundColor: '#fff' },
  tabText:      { fontSize: 14, fontWeight: '600', color: '#888' },
  tabTextActive:{ color: DARK, fontWeight: '700' },

  cardTitle: { fontSize: 22, fontWeight: '900', color: DARK, marginBottom: 20 },

  // Fields
  field:      { marginBottom: 14 },
  fieldLabel: { fontSize: 10, fontWeight: '800', color: '#888', letterSpacing: 0.8, marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: DARK,
  },

  // Error
  error: {
    fontSize: 13,
    color: ORANGE,
    marginBottom: 12,
    fontWeight: '500',
    lineHeight: 18,
  },

  // Submit
  submitBtn: {
    backgroundColor: ORANGE,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: ORANGE,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  btnDisabled:   { opacity: 0.6 },

  // Divider
  divider:     { flexDirection: 'row', alignItems: 'center', marginVertical: 16, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#CCC5BB' },
  dividerText: { fontSize: 12, color: '#AAA', fontWeight: '600' },

  // Google
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: '#D9D0C7',
  },
  googleIcon:    { fontSize: 16, fontWeight: '900', color: '#4285F4' },
  googleBtnText: { fontSize: 15, fontWeight: '700', color: DARK },

  // Footer
  footer: {
    textAlign: 'center',
    fontSize: 11,
    color: '#AAA',
    marginTop: 20,
    lineHeight: 16,
  },
});
