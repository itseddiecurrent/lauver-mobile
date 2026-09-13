import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { config as loadEnvironment } from 'dotenv';
import { Client } from 'pg';
import { z } from 'zod';
import { Argon2idPasswordHasher } from '../src/auth.js';

const stagingOrigin = 'https://lauver-api-staging.onrender.com';
const journalSchema = z.object({
  version: z.literal(1), runId: z.string().regex(/^[a-f0-9]{32}$/),
  baseURL: z.string(), databaseName: z.string(),
  emails: z.array(z.email()).min(1).max(100),
}).strict();
type Journal = z.infer<typeof journalSchema>;
type Session = { accessToken: string; refreshToken: string; user: { id: string } };
type Page = {
  users: Array<{
    id: string; displayName: string; approximateDistanceKm: number;
    city: { name: string; countryCode: string }; commonSports: string[];
    sports: Array<{ sport: string; paceValue: number | null; paceUnit: string | null }>;
  }>;
  nextCursor: string | null;
};
type Fixture = {
  label: string; id: string; email: string; identityId: string; status: string;
  longitude: number | null; complete: boolean; sport: string; pace: number | null;
  unit: string | null; updatedAt: string;
};
export type AcceptanceOptions = {
  databaseURL: string; baseURL?: string; local?: boolean;
  cleanupState?: string; stateDirectory?: string;
  output?: (message: string) => void;
  signal?: AbortSignal;
};

export function validateAcceptanceTarget(databaseURL: string, baseURL: string, local = false): string {
  const database = new URL(databaseURL);
  const api = new URL(baseURL);
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('A PostgreSQL staging connection is required');
  const name = decodeURIComponent(database.pathname.slice(1));
  if (local) {
    const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
    if (!localHosts.has(database.hostname) || !localHosts.has(api.hostname) || api.protocol !== 'http:' || !name.endsWith('_test')) {
      throw new Error('--local requires a loopback API and a loopback database ending in _test');
    }
  } else if (api.origin !== stagingOrigin || api.pathname !== '/' || api.search !== '' || api.hash !== '' || name !== 'lauver_staging') {
    throw new Error('Only the configured staging API and lauver_staging database are permitted');
  }
  return name;
}

export function acceptanceConnectionURL(databaseURL: string, local = false): string {
  if (local) return databaseURL;
  const url = new URL(databaseURL);
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

function validateJournal(value: unknown, baseURL: string, databaseName: string): Journal {
  const journal = journalSchema.parse(value);
  if (journal.baseURL !== baseURL || journal.databaseName !== databaseName || new Set(journal.emails).size !== journal.emails.length) {
    throw new Error('Cleanup journal does not match this target');
  }
  const prefix = `step06-${journal.runId}-`;
  if (journal.emails.some((email) => !email.startsWith(prefix) || !/^[a-z0-9-]+@example\.com$/.test(email.slice(prefix.length)))) {
    throw new Error('Cleanup journal contains a non-fixture email');
  }
  return journal;
}

async function cleanup(client: Client, journal: Journal): Promise<number> {
  await client.query('BEGIN');
  try {
    const owned = await client.query<{ id: string; photo_key: string | null; identity_count: number; provider: string }>(`
      SELECT u.id, p.photo_key,
        (SELECT count(*)::int FROM auth_identities other WHERE other.user_id=u.id) AS identity_count,
        ai.provider::text AS provider
      FROM users u JOIN auth_identities ai ON ai.user_id=u.id
      LEFT JOIN profiles p ON p.user_id=u.id
      WHERE ai.provider_subject=ANY($1::text[]) FOR UPDATE OF u`, [journal.emails]);
    if (owned.rows.some((row) => row.provider !== 'EMAIL' || row.identity_count !== 1 || row.photo_key !== null)) {
      throw new Error('Fixture acquired external data; cleanup requires investigation');
    }
    const ids = owned.rows.map((row) => row.id);
    const uploads = await client.query('SELECT 1 FROM profile_photo_uploads WHERE user_id=ANY($1::uuid[]) LIMIT 1', [ids]);
    if (uploads.rows.length !== 0) throw new Error('Fixture has an object-storage upload; refusing an orphan-producing deletion');
    const identityIds = await client.query<{ id: string }>('SELECT id FROM auth_identities WHERE user_id=ANY($1::uuid[])', [ids]);
    const deleted = await client.query('DELETE FROM users WHERE id=ANY($1::uuid[]) RETURNING id', [ids]);
    for (const table of ['profiles', 'user_sports', 'training_times', 'sessions', 'email_tokens', 'auth_identities', 'profile_photo_uploads']) {
      const remaining = await client.query(`SELECT 1 FROM ${table} WHERE user_id=ANY($1::uuid[]) LIMIT 1`, [ids]);
      if (remaining.rows.length !== 0) throw new Error('Fixture cascade cleanup failed');
    }
    const credentials = await client.query('SELECT 1 FROM password_credentials WHERE identity_id=ANY($1::uuid[]) LIMIT 1', [identityIds.rows.map((row) => row.id)]);
    const blocks = await client.query('SELECT 1 FROM blocks WHERE blocker_id=ANY($1::uuid[]) OR blocked_id=ANY($1::uuid[]) LIMIT 1', [ids]);
    if (credentials.rows.length !== 0 || blocks.rows.length !== 0) throw new Error('Fixture credentials or blocks remain');
    await client.query('COMMIT');
    return deleted.rowCount ?? 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function makeFixtures(runId: string): Fixture[] {
  const specs = [
    ['a', 0, 'running', 5.5, 'ACTIVE', true],
    ['b', 0, 'running', 4, 'ACTIVE', true],
    ['c', 0, 'running', 8, 'ACTIVE', true],
    ['d', 0, 'cycling', 25, 'ACTIVE', true],
    ['e', 0, 'running', null, 'ACTIVE', true],
    ['f', null, 'running', 5.5, 'ACTIVE', false],
    ['g', 1, 'running', 5.5, 'ACTIVE', true],
    ['inside', 0.04496, 'running', 5.5, 'ACTIVE', true],
    ['outside', 0.04497, 'running', 5.5, 'ACTIVE', true],
    ['blocked-out', 0, 'running', 5.5, 'ACTIVE', true],
    ['blocked-in', 0, 'running', 5.5, 'ACTIVE', true],
    ['suspended', 0, 'running', 5.5, 'SUSPENDED', true],
    ['deleted', 0, 'running', 5.5, 'DELETED', true],
    ...Array.from({ length: 21 }, (_, n) => [`page-${n}`, 0, 'running', 5.5, 'ACTIVE', true]),
  ] as const;
  return specs.map(([label, longitude, sport, pace, status, complete]) => ({
    label: String(label), id: randomUUID(), identityId: randomUUID(),
    email: `step06-${runId}-${label}@example.com`, longitude: longitude as number | null,
    sport: String(sport), pace: pace as number | null,
    unit: pace === null ? null : sport === 'cycling' ? 'km/h' : 'min/km',
    status: String(status), complete: Boolean(complete),
    updatedAt: label === 'page-0' ? '2026-01-02T00:00:00.000Z' : '2026-01-01T00:00:00.000Z',
  }));
}

async function seed(client: Client, fixtures: Fixture[], passwordHash: string): Promise<void> {
  const data = JSON.stringify(fixtures.map((f) => ({ ...f, passwordHash })));
  await client.query('BEGIN');
  try {
    await client.query(`INSERT INTO users(id,status,updated_at)
      SELECT id::uuid,status::"UserStatus",'2026-01-01'::timestamp
      FROM jsonb_to_recordset($1::jsonb) AS f(id text,status text)`, [data]);
    await client.query(`INSERT INTO auth_identities(id,user_id,provider,provider_subject,updated_at)
      SELECT "identityId"::uuid,id::uuid,'EMAIL',email,'2026-01-01'::timestamp
      FROM jsonb_to_recordset($1::jsonb) AS f(id text,"identityId" text,email text)`, [data]);
    await client.query(`INSERT INTO password_credentials(identity_id,password_hash)
      SELECT "identityId"::uuid,"passwordHash" FROM jsonb_to_recordset($1::jsonb) AS f("identityId" text,"passwordHash" text)`, [data]);
    await client.query(`INSERT INTO profiles(user_id,display_name,bio,city_name,country_code,city_latitude,city_longitude,is_complete,updated_at)
      SELECT id::uuid,'Step 06 '||label,'Disposable Discover acceptance fixture',
        CASE WHEN longitude IS NOT NULL THEN 'Step 06 Test City' END,
        CASE WHEN longitude IS NOT NULL THEN 'CN' END,
        CASE WHEN longitude IS NOT NULL THEN 0 END,
        CASE WHEN longitude IS NOT NULL THEN longitude+70 END,complete,"updatedAt"::timestamp
      FROM jsonb_to_recordset($1::jsonb) AS f(id text,label text,longitude numeric,complete boolean,"updatedAt" text)`, [data]);
    await client.query(`INSERT INTO user_sports(user_id,sport,pace_value,pace_unit,updated_at)
      SELECT id::uuid,sport,pace,unit,'2026-01-01'::timestamp
      FROM jsonb_to_recordset($1::jsonb) AS f(id text,sport text,pace numeric,unit text)`, [data]);
    await client.query(`INSERT INTO training_times(user_id,weekday,time_bucket)
      SELECT id::uuid,1,'morning' FROM jsonb_to_recordset($1::jsonb) AS f(id text,complete boolean) WHERE complete`, [data]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

export async function runAcceptance(options: AcceptanceOptions): Promise<{ checks: number; deletedAccounts: number }> {
  const baseURL = options.baseURL ?? stagingOrigin;
  const databaseName = validateAcceptanceTarget(options.databaseURL, baseURL, options.local);
  const output = options.output ?? ((message: string) => { console.log(message); });
  const connectionOptions = { connectionString: acceptanceConnectionURL(options.databaseURL, options.local), application_name: 'lauver-step06-verifier', connectionTimeoutMillis: 5000, statement_timeout: 15000 };
  const connectionFailure = new AbortController();
  const client = new Client(connectionOptions);
  client.on('error', () => { connectionFailure.abort(); });
  try {
    await client.connect();
  } catch {
    await client.end().catch(() => undefined);
    if (/^dpg-[a-z0-9-]+$/.test(new URL(options.databaseURL).hostname)) {
      throw new Error('Use the External Database URL for this local run. No test accounts were created.');
    }
    throw new Error('Staging database connection failed; check the external URL and database IP allow list. No test accounts were created.');
  }
  let journal: Journal | undefined;
  let statePath = options.cleanupState;
  let session: Session | undefined;
  let checks = 0;
  let deletedAccounts = 0;
  let failure: unknown;
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(label);
    checks += 1; output(`PASS ${label}`);
  };
  const call = async (method: string, endpoint: string, body?: unknown, token?: string, ignoreCancellation = false) => {
    const response = await fetch(baseURL + endpoint, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(20000), ...(!ignoreCancellation ? [connectionFailure.signal, ...(options.signal ? [options.signal] : [])] : [])]), redirect: 'error',
    });
    const text = await response.text();
    return { status: response.status, body: text === '' ? null : JSON.parse(text) as unknown };
  };
  try {
    if (statePath !== undefined) {
      journal = validateJournal(JSON.parse(await readFile(statePath, 'utf8')), baseURL, databaseName);
    } else {
      check((await call('GET', '/readyz')).status === 200, 'staging-ready');
      check((await call('GET', '/v1/discover')).status === 401, 'discover-deployed-and-authenticated');
      const runId = randomBytes(16).toString('hex');
      const fixtures = makeFixtures(runId);
      const preparedJournal: Journal = { version: 1, runId, baseURL, databaseName, emails: fixtures.map((f) => f.email) };
      const directory = options.stateDirectory ?? path.join(os.tmpdir(), `lauver-step06-${runId}`);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      statePath = path.join(directory, 'cleanup.json');
      await writeFile(statePath, JSON.stringify(preparedJournal), { mode: 0o600, flag: 'wx' });
      journal = preparedJournal;
      output(`Recovery journal: ${statePath}`);
      const password = `Step06Validation9-${randomBytes(24).toString('hex')}`;
      const viewer = fixtures[0]!;
      const passwordHash = await new Argon2idPasswordHasher().hash(password);
      await seed(client, fixtures, passwordHash);
      const registration = await call('POST', '/v1/auth/login', { email: viewer.email, password });
      check(registration.status === 200, 'viewer-login-and-api-database-target-match');
      session = registration.body as Session;
      check(session.user.id === viewer.id, 'api-and-database-target-match');
      const patched = await call('PATCH', '/v1/me', {
        displayName: 'Step 06 a', bio: 'Disposable Discover acceptance fixture',
        city: { name: 'Step 06 Test City', regionCode: null, countryCode: 'CN', latitude: 0, longitude: 70 },
        sports: [{ sport: 'running', paceValue: 5.5 }], trainingTimes: [{ weekday: 1, timeBucket: 'morning' }],
      }, session.accessToken);
      check(patched.status === 200, 'viewer-complete-profile');
      const find = (label: string) => fixtures.find((f) => f.label === label)!;
      await client.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2),($3,$1)', [viewer.id, find('blocked-out').id, find('blocked-in').id]);
      // HTTP pagination can outlast the database's idle-connection limit.
      // Close the fixture connection and use a fresh connection for cleanup.
      await client.end();
      const fixtureIds = new Set(fixtures.map((f) => f.id));
      const visible = fixtures.filter((f) => f.label !== 'a' && f.complete && f.status === 'ACTIVE' && !f.label.startsWith('blocked-') && f.longitude !== null && f.longitude < 1);
      const expected = [...visible].sort((a, b) => (a.longitude! - b.longitude!) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).map((f) => f.id);
      const get = async (query: string, token = session!.accessToken): Promise<Page> => {
        const response = await call('GET', `/v1/discover?${query}`, undefined, token);
        if (response.status !== 200) throw new Error(`discover-query-http-${response.status}`);
        const page = response.body as Page;
        if (!Array.isArray(page.users) || !(page.nextCursor === null || typeof page.nextCursor === 'string')) throw new Error('discover-page-contract');
        return page;
      };
      const ownIds = (page: Page) => page.users.filter((u) => fixtureIds.has(u.id)).map((u) => u.id);
      const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
      const baseline = await get('radius=10&limit=50');
      check(same(ownIds(baseline), expected), 'distance-timestamp-uuid-order-and-exclusions');
      check(!/"(?:latitude|longitude|photoKey|city_latitude|city_longitude)"/.test(JSON.stringify(baseline)), 'public-coordinate-privacy');
      check(baseline.users.every((u) => Number.isInteger(u.approximateDistanceKm)), 'whole-kilometre-approximation');
      check(baseline.users.find((u) => u.id === find('d').id)?.commonSports.length === 0, 'common-sports-not-fabricated');
      for (let n = 0; n < 10; n++) check(same(ownIds(await get('radius=10&limit=50')), expected), `stable-order-${n + 1}`);
      const radius5 = await get('radius=5&limit=50');
      check(ownIds(radius5).includes(find('inside').id) && !ownIds(radius5).includes(find('outside').id), 'five-kilometre-inside-outside-boundary');
      check(same(ownIds(await get('sport=cycling&radius=10&limit=50')), [find('d').id]), 'sport-filter');
      check(same(ownIds(await get('sport=running&paceMin=4&paceMax=4.5&radius=10&limit=50')), [find('b').id]), 'numeric-pace-range-4-to-4.5');
      check(same(ownIds(await get('sport=running&paceMin=7&paceMax=9&radius=10&limit=50')), [find('c').id]), 'numeric-pace-range-7-to-9');
      const ranged = await get('sport=running&paceMin=5&paceMax=6.5&radius=10&limit=50');
      check(!ownIds(ranged).includes(find('e').id) && ownIds(baseline).includes(find('e').id), 'missing-pace-excluded-only-with-range');
      for (const [label, query, ids] of [
        ['cycling-range-20-to-30', 'sport=cycling&paceMin=20&paceMax=30', [find('d').id]],
        ['cycling-range-excludes-25', 'sport=cycling&paceMin=30&paceMax=40', []],
        ['cycling-exact-value-25', 'sport=cycling&paceMin=25&paceMax=25', [find('d').id]],
        ['running-exact-value-4', 'sport=running&paceMin=4&paceMax=4', [find('b').id]],
        ['running-open-lower-end', 'sport=running&paceMax=4.5', [find('b').id]],
        ['running-open-upper-end', 'sport=running&paceMin=7', [find('c').id]],
      ] as const) {
        check(same(ownIds(await get(`${query}&radius=10&limit=50`)), [...ids]), label);
      }
      check((await get('radius=10')).nextCursor !== null, 'default-page-has-load-more');
      for (const radius of [20, 30, 40, 50, 60, 70, 80, 90, 100]) {
        check(same(ownIds(await get(`radius=${radius}&limit=50`)), expected), `expanded-radius-${radius}`);
      }
      check(same(ownIds(await get('radius=unlimited&limit=50')), [...expected, find('g').id]), 'unlimited-includes-beyond-100-km-with-exclusions');
      for (const limit of [1, 7, 20]) {
        let cursor: string | null = null;
        const ids: string[] = [];
        let pages = 0;
        do {
          const query = new URLSearchParams({ radius: '10', limit: String(limit), ...(cursor === null ? {} : { cursor }) });
          const page = await get(query.toString());
          ids.push(...page.users.map((u) => u.id)); cursor = page.nextCursor;
          if (++pages > 200) throw new Error('pagination-did-not-terminate');
        } while (cursor !== null);
        check(new Set(ids).size === ids.length && same(ids.filter((userId) => fixtureIds.has(userId)), expected), `pagination-no-duplicates-or-omissions-limit-${limit}`);
      }
      for (const query of ['radius=7', 'sport=invalid', 'paceBracket=fast', 'sport=running&paceMin=6&paceMax=5', 'limit=0', 'limit=51', 'userId=forged', 'radius=5&radius=10']) {
        check((await call('GET', `/v1/discover?${query}`, undefined, session.accessToken)).status === 422, `invalid-query-${query}`);
      }
      const first = await get('radius=10&limit=1');
      for (const [label, query] of [
        ['changed-filter', new URLSearchParams({ radius: '5', cursor: first.nextCursor! })],
        ['finite-cursor-rejected-for-unlimited', new URLSearchParams({ radius: 'unlimited', cursor: first.nextCursor! })],
        ['cursor-rejected-for-changed-pace-range', new URLSearchParams({ radius: '10', sport: 'running', paceMin: '4', cursor: first.nextCursor! })],
        ['tampered-cursor', new URLSearchParams({ radius: '10', cursor: first.nextCursor! + 'x' })],
      ] as const) {
        check((await call('GET', `/v1/discover?${query}`, undefined, session.accessToken)).status === 422, label);
      }
      const login = await call('POST', '/v1/auth/login', { email: find('b').email, password });
      check(login.status === 200, 'second-user-login');
      check((await call('GET', `/v1/discover?${new URLSearchParams({ radius: '10', cursor: first.nextCursor! })}`, undefined, (login.body as Session).accessToken)).status === 422, 'foreign-user-cursor-rejected');
      const blockedLogin = await call('POST', '/v1/auth/login', { email: find('blocked-in').email, password });
      check(blockedLogin.status === 200, 'blocked-user-login');
      check(!(await get('radius=10&limit=50', (blockedLogin.body as Session).accessToken)).users.some((u) => u.id === viewer.id), 'reverse-block-discovery-isolation');
      const fresh = await call('POST', '/v1/auth/login', { email: viewer.email, password });
      check(fresh.status === 200 && same(ownIds(await get('radius=10&limit=50', (fresh.body as Session).accessToken)), expected), 'fresh-session-persistent-discovery');
    }
  } catch (error) {
    failure = error;
    output('FAIL acceptance; cleaning this run');
  } finally {
    const cleanupClient = new Client({ ...connectionOptions, application_name: 'lauver-step06-verifier-cleanup' });
    cleanupClient.on('error', () => { /* Queries reject; retain the recovery journal on failure. */ });
    try {
      if (journal !== undefined && statePath !== undefined) {
        await cleanupClient.connect();
        deletedAccounts = await cleanup(cleanupClient, journal);
        if (session !== undefined) check((await call('GET', '/v1/auth/session', undefined, session.accessToken, true)).status === 401, 'deleted-viewer-session-invalid');
        await rm(statePath);
        output(`PASS cleanup: ${deletedAccounts} test accounts and all dependent database rows deleted`);
      }
    } catch {
      output(`CLEANUP FAILED; retry with --cleanup-state ${statePath ?? '(journal unavailable)'}`);
      failure = new Error('Test cleanup failed; recovery journal retained');
    } finally {
      await cleanupClient.end().catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }
  if (failure !== undefined) throw failure instanceof Error ? failure : new Error('Step 06 acceptance failed');
  return { checks, deletedAccounts };
}

async function main(): Promise<void> {
  loadEnvironment({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env.staging'), quiet: true });
  const { values } = parseArgs({ options: {
    'cleanup-state': { type: 'string' }, local: { type: 'boolean', default: false },
  } });
  const databaseURL = process.env.STAGING_DATABASE_URL ?? (process.env.NODE_ENV === 'staging' ? process.env.DATABASE_URL : undefined);
  if (!databaseURL) throw new Error('Set STAGING_DATABASE_URL in backend/.env.staging; it is required to delete the test accounts completely');
  const controller = new AbortController();
  const interrupt = () => { controller.abort(); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const result = await runAcceptance({ databaseURL, baseURL: process.env.STEP06_API_BASE_URL, local: values.local, cleanupState: values['cleanup-state'], signal: controller.signal });
    console.log(JSON.stringify({ result: 'passed', ...result }));
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    // Never print transport/SQL errors: they can contain URLs, credentials or SQL parameters.
    console.error(error instanceof Error && /^(Set STAGING_|Only the configured|--local requires|A PostgreSQL|Test cleanup failed|Use the External|Staging database)/.test(error.message) ? error.message : 'Step 06 acceptance failed; fixture cleanup was attempted.');
    process.exitCode = 1;
  });
}
