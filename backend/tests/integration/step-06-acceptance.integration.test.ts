import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAcceptance } from '../../scripts/verify-step-06-staging.js';
import { AuthService, NoopPasswordResetDelivery } from '../../src/auth.js';
import { createDatabase } from '../../src/database.js';
import { DiscoverService } from '../../src/discover.js';
import { ProfileService } from '../../src/profile.js';
import { UnavailableProfilePhotoStorage } from '../../src/object-storage.js';
import { createTestApp } from '../helpers/test-app.js';

const databaseURL = process.env.TEST_DATABASE_URL!;
const database = createDatabase(databaseURL);
const sql = new Client({ connectionString: databaseURL });
const storage = new UnavailableProfilePhotoStorage();
const discovery = new DiscoverService(database.discoverRepository, storage, 'acceptance-integration-cursor-secret');
const auth = new AuthService({ repository: database.authRepository, passwordResetDelivery: new NoopPasswordResetDelivery(),
  accessTokenSecret: 'acceptance-integration-auth-secret-at-least-32', accessTokenTTLSeconds: 900,
  refreshTokenTTLSeconds: 2592000, passwordResetTTLSeconds: 900,
});
let server: Server;
let baseURL: string;
let failDiscovery = false;
const sentinel = 'ac060000-0000-4000-8000-000000000001';
beforeAll(async () => {
  await sql.connect();
  await sql.query("INSERT INTO users(id,updated_at) VALUES($1,'2026-01-01')", [sentinel]);
  server = createServer(createTestApp({ database, authService: auth,
    profileService: new ProfileService({ repository: database.profileRepository, storage }),
    discoverService: { discover: (userId, query) => failDiscovery
      ? Promise.reject(new Error('Injected API failure')) : discovery.discover(userId, query) },
  }));
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No local test server address');
  baseURL = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve(); }); });
  await sql.query('DELETE FROM users WHERE id=$1', [sentinel]);
  await database.disconnect();
  await sql.end();
});
async function assertNoFixturesRemain() {
  const remaining = await sql.query("SELECT 1 FROM auth_identities WHERE provider_subject LIKE 'step06-%@example.com'");
  expect(remaining.rows).toHaveLength(0);
  expect((await sql.query('SELECT 1 FROM users WHERE id=$1', [sentinel])).rows).toHaveLength(1);
}
describe('Step 06 full acceptance lifecycle', () => {
  it('runs the HTTP/SQL verifier and deletes every generated account without touching an unrelated user', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lauver-step06-success-test-'));
    try {
      const messages: string[] = [];
      const result = await runAcceptance({ databaseURL, baseURL, local: true, stateDirectory: directory, output: (line) => { messages.push(line); } });
      expect(result.checks).toBeGreaterThan(30);
      expect(result.deletedAccounts).toBe(34);
      expect(messages.some((line) => line.includes('deleted-viewer-session-invalid'))).toBe(true);
      expect(await readdir(directory)).toEqual([]);
      await assertNoFixturesRemain();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 30000);

  it('cleans all fixtures even when an API assertion fails after seeding', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lauver-step06-failure-test-'));
    failDiscovery = true;
    try {
      await expect(runAcceptance({ databaseURL, baseURL, local: true, stateDirectory: directory, output: () => {} })).rejects.toThrow('discover-query-http-500');
      expect(await readdir(directory)).toEqual([]);
      await assertNoFixturesRemain();
    } finally { failDiscovery = false; await rm(directory, { recursive: true, force: true }); }
  }, 30000);

  it('still verifies cleanup after cancellation aborts the acceptance requests', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lauver-step06-interrupt-test-'));
    const controller = new AbortController();
    try {
      await expect(runAcceptance({ databaseURL, baseURL, local: true, stateDirectory: directory, signal: controller.signal,
        output: (line) => { if (line === 'PASS viewer-complete-profile') controller.abort(); },
      })).rejects.toThrow();
      expect(await readdir(directory)).toEqual([]);
      await assertNoFixturesRemain();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 30000);

  it('handles a terminated fixture connection and cleans through a fresh connection', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lauver-step06-disconnect-test-'));
    let termination: Promise<unknown> | undefined;
    // Hold the next fixture write until termination completes, so a fast run
    // cannot close its own connection before the injected failure arrives.
    await sql.query('BEGIN');
    await sql.query('LOCK TABLE blocks IN ACCESS EXCLUSIVE MODE');
    try {
      await expect(runAcceptance({ databaseURL, baseURL, local: true, stateDirectory: directory,
        output: (line) => {
          if (line === 'PASS viewer-login-and-api-database-target-match') {
            termination = sql.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='lauver-step06-verifier' AND pid<>pg_backend_pid()")
              .finally(() => sql.query('ROLLBACK'));
          }
        },
      })).rejects.toThrow();
      await termination;
      expect(await readdir(directory)).toEqual([]);
      await assertNoFixturesRemain();
    } finally {
      await termination;
      if (termination === undefined) await sql.query('ROLLBACK');
      if ((await readdir(directory)).includes('cleanup.json')) {
        await runAcceptance({ databaseURL, baseURL, local: true, cleanupState: path.join(directory, 'cleanup.json'), output: () => {} });
      }
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);

  it('replays only the exact journal emails, leaves another run intact, and permits an idempotent replay', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lauver-step06-recovery-test-'));
    const runId = randomBytes(16).toString('hex');
    const email = `step06-${runId}-a@example.com`;
    const recoveryId = 'ac060000-0000-4000-8000-000000000002';
    const otherRunId = 'ac060000-0000-4000-8000-000000000003';
    const otherEmail = `step06-${randomBytes(16).toString('hex')}-a@example.com`;
    const file = path.join(directory, 'cleanup.json');
    const journal = JSON.stringify({ version: 1, runId, baseURL, databaseName: new URL(databaseURL).pathname.slice(1), emails: [email] });
    try {
      for (const [id, fixtureEmail] of [[recoveryId, email], [otherRunId, otherEmail]]) {
        await sql.query("INSERT INTO users(id,updated_at) VALUES($1,'2026-01-01')", [id]);
        await sql.query("INSERT INTO auth_identities(id,user_id,provider,provider_subject,updated_at) VALUES(gen_random_uuid(),$1,'EMAIL',$2,'2026-01-01')", [id, fixtureEmail]);
      }
      await writeFile(file, journal, { mode: 0o600 });
      expect((await runAcceptance({ databaseURL, baseURL, local: true, cleanupState: file, output: () => {} })).deletedAccounts).toBe(1);
      expect((await sql.query('SELECT 1 FROM users WHERE id=$1', [otherRunId])).rows).toHaveLength(1);
      await writeFile(file, journal, { mode: 0o600 });
      expect((await runAcceptance({ databaseURL, baseURL, local: true, cleanupState: file, output: () => {} })).deletedAccounts).toBe(0);
    } finally { await sql.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[recoveryId, otherRunId]]); await rm(directory, { recursive: true, force: true }); }
  });

  it('retains a failed-cleanup journal and completes deletion after its blocking condition is cleared', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lauver-step06-cleanup-failure-test-'));
    const file = path.join(directory, 'cleanup.json');
    const runId = randomBytes(16).toString('hex');
    const userId = 'ac060000-0000-4000-8000-000000000004';
    const journal = JSON.stringify({ version: 1, runId, baseURL, databaseName: new URL(databaseURL).pathname.slice(1), emails: [`step06-${runId}-a@example.com`] });
    try {
      await sql.query("INSERT INTO users(id,updated_at) VALUES($1,'2026-01-01')", [userId]);
      await sql.query("INSERT INTO auth_identities(id,user_id,provider,provider_subject,updated_at) VALUES(gen_random_uuid(),$1,'EMAIL',$2,'2026-01-01')", [userId, `step06-${runId}-a@example.com`]);
      await sql.query("INSERT INTO profiles(user_id,photo_key,updated_at) VALUES($1,'external-object-test-guard','2026-01-01')", [userId]);
      await writeFile(file, journal, { mode: 0o600 });
      await expect(runAcceptance({ databaseURL, baseURL, local: true, cleanupState: file, output: () => {} })).rejects.toThrow('Test cleanup failed');
      expect(await readFile(file, 'utf8')).toBe(journal);
      expect((await sql.query('SELECT 1 FROM users WHERE id=$1', [userId])).rows).toHaveLength(1);
      await sql.query('UPDATE profiles SET photo_key=NULL WHERE user_id=$1', [userId]);
      expect((await runAcceptance({ databaseURL, baseURL, local: true, cleanupState: file, output: () => {} })).deletedAccounts).toBe(1);
      expect(await readdir(directory)).toEqual([]);
    } finally { await sql.query('DELETE FROM users WHERE id=$1', [userId]); await rm(directory, { recursive: true, force: true }); }
  });

  it('rejects a recovery file containing a real-user email before deleting anything', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lauver-step06-bad-journal-test-'));
    const file = path.join(directory, 'cleanup.json');
    try {
      await writeFile(file, JSON.stringify({ version: 1, runId: randomBytes(16).toString('hex'), baseURL,
        databaseName: new URL(databaseURL).pathname.slice(1), emails: ['real-person@example.com'] }), { mode: 0o600 });
      await expect(runAcceptance({ databaseURL, baseURL, local: true, cleanupState: file, output: () => {} })).rejects.toThrow('non-fixture email');
      expect(await readFile(file, 'utf8')).toContain('real-person');
      await assertNoFixturesRemain();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
