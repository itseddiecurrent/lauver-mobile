import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const ExpoSecureStoreAdapter = {
  getItem:    (key) => SecureStore.getItemAsync(key),
  setItem:    (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage:            ExpoSecureStoreAdapter,
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: false,
  },
});

/**
 * After Firebase sign-in, exchange the Firebase ID token for a Supabase
 * session. This lets Supabase RLS policies use auth.uid() = Firebase UID.
 * Call this every time Firebase reports a signed-in user.
 */
export async function syncFirebaseToSupabase(firebaseUser) {
  if (!firebaseUser) {
    await supabase.auth.signOut();
    return null;
  }

  const idToken = await firebaseUser.getIdToken();

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'firebase',
    token:    idToken,
  });

  if (error) throw error;
  return data.session;
}
