import { useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { supabase, createSessionFromUrl } from '../lib/supabase';

export function useAuth() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Get initial session from secure storage
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // 2. Listen for sign-in / sign-out / token refresh
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    // 3. Handle deep link when Google OAuth redirects back to app
    const handleDeepLink = async ({ url }) => {
      if (url?.includes('access_token') || url?.includes('code=')) {
        try {
          await createSessionFromUrl(url);
          // onAuthStateChange above will update session automatically
        } catch (e) {
          console.warn('OAuth deep link error:', e.message);
        }
      }
    };

    const linkSub = Linking.addEventListener('url', handleDeepLink);

    // Also check if app was opened via OAuth redirect (cold start)
    Linking.getInitialURL().then(url => {
      if (url) handleDeepLink({ url });
    });

    return () => {
      subscription.unsubscribe();
      linkSub.remove();
    };
  }, []);

  return { session, user: session?.user ?? null, loading };
}
