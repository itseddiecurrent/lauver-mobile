import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';

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
 * Called after Google OAuth redirects back to the app.
 * Extracts access_token + refresh_token from the redirect URL
 * and hands them to Supabase to establish a session.
 */
export async function createSessionFromUrl(url) {
  // Supabase returns tokens in the URL fragment (#) or query string
  const parsed = Linking.parse(url);
  const params = { ...parsed.queryParams, ...parsed.fragment };

  const accessToken  = params?.access_token;
  const refreshToken = params?.refresh_token;

  if (!accessToken) return null;

  const { data, error } = await supabase.auth.setSession({
    access_token:  accessToken,
    refresh_token: refreshToken,
  });

  if (error) throw error;
  return data.session;
}
