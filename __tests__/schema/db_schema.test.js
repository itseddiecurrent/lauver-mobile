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
    // profiles — real column names (not skill_level / location_name)
    ['profiles', 'skill'],
    ['profiles', 'city'],
    ['profiles', 'availability'],
    ['profiles', 'photos'],
    ['profiles', 'display_name'],
    ['profiles', 'unit_distance'],
    ['profiles', 'unit_elevation'],
    ['profiles', 'unit_weight'],
    // posts
    ['posts', 'photo_url'],
    ['posts', 'activity_id'],
    // swipes
    ['swipes', 'action'],
    ['swipes', 'target_id'],
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

// ─── RPC function ────────────────────────────────────────────────────────────

describe('RPC functions', () => {
  test('increment_group_member_count function exists', () => {
    const rows = dbQuery(
      "SELECT proname FROM pg_proc WHERE proname = 'increment_group_member_count';"
    );
    expect(rows).toHaveLength(1);
  });
});
