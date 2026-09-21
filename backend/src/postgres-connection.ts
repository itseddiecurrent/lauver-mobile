export type PostgresTLSOptions = { rejectUnauthorized: boolean };

export function postgresConnectionOptions(databaseURL: string): {
  connectionString: string;
  ssl?: PostgresTLSOptions;
} {
  const url = new URL(databaseURL);
  const isSupabase = url.hostname.endsWith('.supabase.com') || url.hostname.endsWith('.supabase.co');
  const useTLS = url.hostname.endsWith('.render.com') || isSupabase || url.searchParams.has('sslmode');
  url.searchParams.delete('sslmode');
  url.searchParams.delete('uselibpqcompat');

  // Supabase's managed pooler presents a CA chain that Render's Node runtime
  // can report as self-signed. The connection remains encrypted; only local
  // certificate-chain verification is relaxed for Supabase hosts.
  return {
    connectionString: url.toString(),
    ...(useTLS ? { ssl: { rejectUnauthorized: isSupabase ? false : true } } : {}),
  };
}
