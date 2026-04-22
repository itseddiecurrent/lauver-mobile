// supabase/functions/strava-refresh/index.ts
//
// Refreshes an expired Strava access token and updates platform_connections.
// Called automatically by syncManager before every sync if token is expired.
//
// POST /functions/v1/strava-refresh
// Body: { userId: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  const { userId } = await req.json();
  if (!userId) return json({ error: 'Missing userId' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Fetch current refresh token
  const { data: conn, error: fetchError } = await supabase
    .from('platform_connections')
    .select('refresh_token, token_expires_at')
    .eq('user_id', userId)
    .eq('platform', 'strava')
    .single();

  if (fetchError || !conn) {
    return json({ error: 'No Strava connection found' }, 404);
  }

  // Check if actually expired (give 5 min buffer)
  const expiresAt = new Date(conn.token_expires_at).getTime();
  if (expiresAt > Date.now() + 5 * 60 * 1000) {
    return json({ ok: true, refreshed: false });  // still valid
  }

  // Exchange refresh token
  const tokenRes = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     Deno.env.get('STRAVA_CLIENT_ID'),
      client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
      refresh_token: conn.refresh_token,
      grant_type:    'refresh_token',
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    // Mark connection as needing re-auth
    await supabase
      .from('platform_connections')
      .update({ requires_reauth: true })
      .eq('user_id', userId)
      .eq('platform', 'strava');
    return json({ error: 'Token refresh failed — user must reconnect', detail: err }, 401);
  }

  const tokens = await tokenRes.json();

  await supabase
    .from('platform_connections')
    .update({
      access_token:     tokens.access_token,
      refresh_token:    tokens.refresh_token,
      token_expires_at: new Date(tokens.expires_at * 1000).toISOString(),
      requires_reauth:  false,
    })
    .eq('user_id', userId)
    .eq('platform', 'strava');

  return json({ ok: true, refreshed: true });
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
