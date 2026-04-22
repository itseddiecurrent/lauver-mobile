// src/hooks/useStravaConnect.js
//
// Handles the full Strava OAuth flow:
//   1. Open Strava auth page in browser
//   2. Receive redirect with ?code=
//   3. POST code + userId to our edge function
//   4. Edge function exchanges code for tokens and saves to DB

import { useState, useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri, useAuthRequest } from 'expo-auth-session';
import { supabase } from '../lib/supabase';
import { firebaseAuth } from '../lib/firebase';

// Required so Expo can close the browser after redirect on iOS
WebBrowser.maybeCompleteAuthSession();

const STRAVA_CLIENT_ID = process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID;

// Strava OAuth discovery (manual — Strava doesn't publish a discovery doc)
const discovery = {
  authorizationEndpoint: 'https://www.strava.com/oauth/mobile/authorize',
  tokenEndpoint:         'https://www.strava.com/oauth/token',
  revocationEndpoint:    'https://www.strava.com/oauth/deauthorize',
};

export function useStravaConnect() {
  const [connected,      setConnected]      = useState(false);
  const [athleteName,    setAthleteName]    = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [connecting,     setConnecting]     = useState(false);
  const [requiresReauth, setRequiresReauth] = useState(false);
  const [error,          setError]          = useState(null);

  const userId = firebaseAuth.currentUser?.uid;

  // Redirect URI — must match what's registered at strava.com/settings/api
  // During development this resolves to:
  //   https://auth.expo.io/@your-username/lauver-mobile-app
  const redirectUri = makeRedirectUri({ scheme: 'lauver' });

  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId:            STRAVA_CLIENT_ID,
      scopes:              ['activity:read_all'],
      redirectUri,
      // Strava requires response_type=code (default) and these extras:
      extraParams: {
        approval_prompt: 'auto',   // 'auto' skips re-approval if already authorized
                                   // use 'force' to always show the approval screen
      },
    },
    discovery,
  );

  // ── Check existing connection on mount ────────────────────────────────────

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from('platform_connections')
        .select('meta, requires_reauth')
        .eq('user_id', userId)
        .eq('platform', 'strava')
        .maybeSingle();

      if (data) {
        setConnected(true);
        setAthleteName(data.meta?.athlete_name ?? null);
        setRequiresReauth(data.requires_reauth ?? false);
      }
      setLoading(false);
    })();
  }, [userId]);

  // ── Handle redirect response from browser ─────────────────────────────────

  useEffect(() => {
    if (!response || response.type !== 'success') return;

    const { code } = response.params;
    if (!code || !userId) return;

    (async () => {
      setConnecting(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();

        // Call our edge function to exchange code for tokens
        const res = await fetch(
          `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/strava-auth`,
          {
            method:  'POST',
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${session?.access_token ?? ''}`,
            },
            body: JSON.stringify({ code, userId }),
          },
        );

        const result = await res.json();
        if (!res.ok) throw new Error(result.error ?? 'Connection failed');

        setConnected(true);
        setAthleteName(result.athlete?.name ?? null);
        setRequiresReauth(false);
      } catch (e) {
        setError(e.message);
      } finally {
        setConnecting(false);
      }
    })();
  }, [response]);

  // ── Disconnect ─────────────────────────────────────────────────────────────

  async function disconnect() {
    if (!userId) return;
    await supabase
      .from('platform_connections')
      .delete()
      .eq('user_id', userId)
      .eq('platform', 'strava');
    setConnected(false);
    setAthleteName(null);
    setRequiresReauth(false);
  }

  // ── Connect (opens browser) ────────────────────────────────────────────────

  async function connect() {
    setError(null);
    await promptAsync();
  }

  return {
    connected,
    athleteName,
    requiresReauth,
    loading,
    connecting,
    error,
    connect,
    disconnect,
    redirectUri,   // expose so you can show it in Settings for debugging
  };
}
