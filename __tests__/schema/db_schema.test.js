/**
 * Task 0 schema validation — runs against the real Supabase DB via CLI.
 *
 * These are integration tests that shell out to `supabase db query --linked`
 * to verify the actual remote schema matches what the app code expects.
 * They do NOT use Jest's Supabase mock.
 *
 * Run individually: npx jest __tests__/schema/db_schema.test.js --forceExit
 */

const { execSync } = require('child_process');

function dbQuery(sql) {
  const raw = execSync(
    `supabase db query --linked ${JSON.stringify(sql)}`,
    { cwd: process.cwd(), timeout: 30000 }
  ).toString();
  // CLI outputs JSON; strip the "boundary" wrapper lines
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Unexpected CLI output:\n${raw}`);
  return JSON.parse(match[0]).rows;
}

// ─── Tables ───────────────────────────────────────────────────────────────────

describe('Required tables exist', () => {
  let tables;
  beforeAll(() => {
    tables = dbQuery(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
    ).map(r => r.table_name);
  });

  const REQUIRED = [
    'activities', 'activity_sources', 'communities',
    'event_rsvps', 'events',
    'group_members', 'groups',
    'matches', 'messages',
    'platform_connections',
    'post_comments', 'post_reactions', 'posts',
    'profiles', 'swipes',
  ];

  REQUIRED.forEach(name => {
    test(`table "${name}" exists`, () => {
      expect(tables).toContain(name);
    });
  });
});

// ─── RLS enabled ─────────────────────────────────────────────────────────────

describe('RLS enabled on tables with user data', () => {
  let rlsMap;
  beforeAll(() => {
    const rows = dbQuery(
      "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public';"
    );
    rlsMap = Object.fromEntries(rows.map(r => [r.tablename, r.rowsecurity]));
  });

  const RLS_TABLES = [
    'activities', 'activity_sources', 'communities',
    'event_rsvps', 'group_members',
    'matches', 'messages',
    'post_comments', 'post_reactions', 'posts',
    'profiles', 'swipes',
  ];

  RLS_TABLES.forEach(name => {
    test(`RLS enabled on "${name}"`, () => {
      expect(rlsMap[name]).toBe(true);
    });
  });
});

// ─── Column spot-checks ───────────────────────────────────────────────────────

describe('Critical column spot-checks', () => {
  let colMap;
  beforeAll(() => {
    const rows = dbQuery(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public';"
    );
    colMap = {};
    for (const { table_name, column_name } of rows) {
      (colMap[table_name] = colMap[table_name] || []).push(column_name);
    }
  });

  const checks = [
    // activities
    ['activities', 'canonical_source'],
    ['activities', 'elevation_gain_m'],
    // profiles — base columns
    ['profiles', 'skill'],
    ['profiles', 'city'],
    ['profiles', 'availability'],
    ['profiles', 'photos'],
    ['profiles', 'display_name'],
    ['profiles', 'unit_distance'],
    ['profiles', 'unit_elevation'],
    ['profiles', 'unit_weight'],
    // profiles — match columns (Step 1)
    ['profiles', 'visible_in_match'],
    ['profiles', 'gender'],
    ['profiles', 'pref_gender'],
    ['profiles', 'pref_distance_km'],
    ['profiles', 'pref_sports'],
    ['profiles', 'latitude'],
    ['profiles', 'longitude'],
    ['profiles', 'location_updated_at'],
    // posts
    ['posts', 'photo_url'],
    ['posts', 'activity_id'],
    // swipes — renamed columns (Step 1)
    ['swipes', 'swiper_id'],
    ['swipes', 'swiped_id'],
    ['swipes', 'direction'],
    // matches (Step 1)
    ['matches', 'user1_id'],
    ['matches', 'user2_id'],
    ['matches', 'matched_at'],
    ['matches', 'unmatched_by'],
    ['matches', 'unmatched_at'],
    // messages (Step 1)
    ['messages', 'match_id'],
    ['messages', 'sender_id'],
    ['messages', 'body'],
    ['messages', 'sent_at'],
    ['messages', 'read_at'],
    // activity_sources
    ['activity_sources', 'platform'],
    ['activity_sources', 'external_id'],
  ];

  checks.forEach(([table, col]) => {
    test(`${table}.${col} exists`, () => {
      expect(colMap[table]).toContain(col);
    });
  });
});

// ─── Storage bucket ───────────────────────────────────────────────────────────

describe('Storage buckets', () => {
  let buckets;
  beforeAll(() => {
    buckets = dbQuery(
      "SELECT id, public FROM storage.buckets;"
    );
  });

  test('post-media bucket exists', () => {
    expect(buckets.map(b => b.id)).toContain('post-media');
  });

  test('post-media bucket is public', () => {
    const b = buckets.find(b => b.id === 'post-media');
    expect(b?.public).toBe(true);
  });
});

// ─── RPC functions ───────────────────────────────────────────────────────────

describe('RPC functions', () => {
  let procs;
  beforeAll(() => {
    procs = dbQuery("SELECT proname FROM pg_proc ORDER BY proname;").map(r => r.proname);
  });

  const REQUIRED_RPCS = [
    // pre-existing
    'increment_group_member_count',
    'get_week_stats_for_user',
    'get_month_stats_for_user',
    'get_all_time_stats_for_user',
    'get_weekly_chart_for_user',
    'get_recent_activities_for_user',
    'get_activities_list_for_user',
    'get_activities_for_chart',
    // Step 2 — match
    'haversine_km',
    'get_match_candidates',
    'record_swipe',
    'get_today_likes_count',
    'get_my_matches',
    'get_messages',
    'send_message',
    'mark_messages_read',
    'do_unmatch',
    'update_location',
  ];

  REQUIRED_RPCS.forEach(fn => {
    test(`function "${fn}" exists`, () => {
      expect(procs).toContain(fn);
    });
  });
});

// ─── Step 2 RPC smoke tests ───────────────────────────────────────────────────

describe('Step 2 RPC smoke tests', () => {
  test('haversine_km: NYC to LA ≈ 3940 km', () => {
    const rows = dbQuery(
      "SELECT round(haversine_km(40.7128, -74.0060, 34.0522, -118.2437)::numeric, 0)::integer AS km;"
    );
    const km = rows[0].km;
    expect(km).toBeGreaterThan(3900);
    expect(km).toBeLessThan(3980);
  });

  test('haversine_km: same point = 0 km', () => {
    const rows = dbQuery(
      "SELECT haversine_km(40.7128, -74.0060, 40.7128, -74.0060) AS km;"
    );
    expect(parseFloat(rows[0].km)).toBe(0);
  });

  test('get_match_candidates: returns empty array for unknown uid', () => {
    const rows = dbQuery(
      "SELECT * FROM get_match_candidates('no-such-user');"
    );
    expect(rows).toHaveLength(0);
  });

  test('get_today_likes_count: returns 0 for unknown uid', () => {
    const rows = dbQuery(
      "SELECT get_today_likes_count('no-such-user') AS n;"
    );
    expect(parseInt(rows[0].n)).toBe(0);
  });

  test('get_my_matches: returns empty array for unknown uid', () => {
    const rows = dbQuery(
      "SELECT * FROM get_my_matches('no-such-user');"
    );
    expect(rows).toHaveLength(0);
  });

  test('record_swipe: returns daily_limit error after 15 right-swipes', () => {
    // Create temp profiles for the swiper and 16 targets
    const swiper = 'tlc-swiper-001';
    const targets = Array.from({ length: 16 }, (_, i) => `tlc-target-${String(i).padStart(3,'0')}`);

    // Cleanup any leftovers from previous run
    dbQuery(`DELETE FROM swipes WHERE swiper_id = '${swiper}';`);
    dbQuery(`DELETE FROM profiles WHERE id like 'tlc-%';`);

    // Insert temp profiles
    const profileRows = [swiper, ...targets]
      .map(id => `('${id}', 'Test')`)
      .join(',');
    dbQuery(`INSERT INTO profiles (id, first_name) VALUES ${profileRows} ON CONFLICT DO NOTHING;`);

    // Insert exactly 15 right-swipes directly (bypass RPC to seed quickly)
    const swipeRows = targets.slice(0, 15)
      .map(t => `('${swiper}', '${t}', 'right')`)
      .join(',');
    dbQuery(`INSERT INTO swipes (swiper_id, swiped_id, direction) VALUES ${swipeRows} ON CONFLICT DO NOTHING;`);

    // 16th like via RPC — should hit daily_limit
    const rows = dbQuery(
      `SELECT record_swipe('${swiper}', '${targets[15]}', 'right') AS result;`
    );
    // CLI already deserialises json columns into objects
    const result = typeof rows[0].result === 'string'
      ? JSON.parse(rows[0].result)
      : rows[0].result;
    expect(result.error).toBe('daily_limit');
    expect(result.matched).toBe(false);

    // Cleanup
    dbQuery(`DELETE FROM swipes WHERE swiper_id = '${swiper}';`);
    dbQuery(`DELETE FROM profiles WHERE id like 'tlc-%';`);
  });
});
