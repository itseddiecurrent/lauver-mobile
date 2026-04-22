// supabase/functions/strava-auth/index.ts
//
// Exchanges a Strava OAuth code for tokens, then stores them in
// platform_connections. Called by the app after the user approves Strava.
//
// POST /functions/v1/strava-auth
// Body: { code: string, userId: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body: { code?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { code, userId } = body;
  if (!code || !userId) {
    return json({ error: 'Missing required fields: code, userId' }, 400);
  }

  // ── Exchange code for tokens ──────────────────────────────────────────────
  const clientId     = Deno.env.get('STRAVA_CLIENT_ID');
  const clientSecret = Deno.env.get('STRAVA_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    return json({ error: 'Strava credentials not configured' }, 500);
  }

  const tokenRes = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error('Strava token exchange failed:', err);
    return json({ error: 'Strava token exchange failed', detail: err }, 400);
  }

  const tokens = await tokenRes.json();
  // tokens shape: { access_token, refresh_token, expires_at (unix), athlete: {...} }

  // ── Store tokens in platform_connections ─────────────────────────────────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,  // service role bypasses RLS
  );

  const { error: upsertError } = await supabase
    .from('platform_connections')
    .upsert({
      user_id:          userId,
      platform:         'strava',
      access_token:     tokens.access_token,
      refresh_token:    tokens.refresh_token,
      token_expires_at: new Date(tokens.expires_at * 1000).toISOString(),
      meta: {
        athlete_id:   tokens.athlete?.id,
        athlete_name: `${tokens.athlete?.firstname ?? ''} ${tokens.athlete?.lastname ?? ''}`.trim(),
      },
    }, { onConflict: 'user_id,platform' });

  if (upsertError) {
    console.error('DB upsert failed:', upsertError);
    return json({ error: 'Failed to save connection', detail: upsertError.message }, 500);
  }

  return json({
    ok: true,
    athlete: {
      id:   tokens.athlete?.id,
      name: `${tokens.athlete?.firstname ?? ''} ${tokens.athlete?.lastname ?? ''}`.trim(),
    },
  });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
