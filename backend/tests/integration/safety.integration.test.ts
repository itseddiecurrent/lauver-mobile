import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/database.js';
import { DiscoverService } from '../../src/discover.js';
import { UnavailableProfilePhotoStorage } from '../../src/object-storage.js';
import { ProfileService } from '../../src/profile.js';
import type { BlockedPage } from '../../src/safety.js';
import { createAuthServiceStub, createTestApp } from '../helpers/test-app.js';

const database = createDatabase(process.env.TEST_DATABASE_URL!);
const sql = new Client({ connectionString: process.env.TEST_DATABASE_URL! });
const id = (n: number) => `e1700000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const a = id(1), b = id(2), c = id(3);
const json = <T>(response: { body: unknown }): T => response.body as T;
type Receipt = { referenceId: string; blockedUser: boolean };
type ReportRow = { id: string; snapshot: Record<string, unknown> };
const storage = new UnavailableProfilePhotoStorage();
let actorId = a;
const app = createTestApp({ database, safetyService: database.safetyService,
  profileService: new ProfileService({ repository: database.profileRepository, storage }),
  discoverService: new DiscoverService(database.discoverRepository, storage, 'step07-integration-cursor-secret'),
  authService: createAuthServiceStub({ restore: vi.fn().mockImplementation(() => Promise.resolve({ id: actorId, email: null })) }) });
beforeAll(async () => {
  await sql.connect();
  for (let n = 1; n <= 55; n++) {
    await sql.query(`INSERT INTO users(id,updated_at) VALUES($1,now())`, [id(n)]);
    await sql.query(`INSERT INTO profiles(user_id,display_name,bio,city_name,country_code,city_latitude,city_longitude,is_complete,updated_at)
      VALUES($1,$2,'Original bio','Safety City','CN',0,0,true,now())`, [id(n), `Safety ${n}`]);
    await sql.query(`INSERT INTO user_sports(user_id,sport,pace_value,pace_unit,updated_at) VALUES($1,'running',5.5,'min/km',now())`, [id(n)]);
  }
});
afterAll(async () => {
  await sql.query('DELETE FROM safety_audit_events WHERE actor_id=ANY($1::uuid[])', [Array.from({ length: 55 }, (_, n) => id(n + 1))]);
  await sql.query('DELETE FROM reports WHERE reporter_id=ANY($1::uuid[])', [Array.from({ length: 55 }, (_, n) => id(n + 1))]);
  await sql.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [Array.from({ length: 55 }, (_, n) => id(n + 1))]);
  await database.disconnect(); await sql.end();
});
const report = (targetId = b, blockUser = false) => ({ targetType: 'user', targetId, reason: 'harassment', details: 'Evidence note', blockUser });

describe('PostgreSQL safety policy and immutable evidence', () => {
  it('commits chat evidence and its message audit together', async () => {
    const receipt = await database.safetyService.reportChatMessage(a, b, 'dm-test', 'message-test', 'x'.repeat(600), b,
      'other', 'Chat acceptance', id(101));
    const saved = (await sql.query<ReportRow>('SELECT * FROM reports WHERE id=$1', [receipt.referenceId])).rows[0]!;
    expect(saved).toMatchObject({ reporter_id: a, target_user_id: b, source: 'chat', status: 'open',
      snapshot: { channelId: 'dm-test', messageId: 'message-test', senderId: b, text: 'x'.repeat(500) } });
    expect((await sql.query("SELECT 1 FROM safety_audit_events WHERE report_id=$1 AND action='report_message' AND request_id=$2", [receipt.referenceId, id(101)])).rowCount).toBe(1);
    await expect(sql.query(`UPDATE reports SET snapshot='{}'::jsonb WHERE id=$1`, [receipt.referenceId])).rejects.toMatchObject({ code: '23514' });
  });
  it('rolls back chat reports when their audit cannot be written', async () => {
    const before = (await sql.query<{count:number}>('SELECT count(*)::int AS count FROM reports')).rows[0]!.count;
    await sql.query(`CREATE FUNCTION reject_chat_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test audit failure'; END $$`);
    await sql.query('CREATE TRIGGER reject_chat_test_audit BEFORE INSERT ON safety_audit_events FOR EACH ROW EXECUTE FUNCTION reject_chat_test_audit()');
    try {
      await expect(database.safetyService.reportChatMessage(a, b, 'dm-test', 'message-rollback', 'text', b, 'other', undefined, id(102))).rejects.toThrow();
    } finally {
      await sql.query('DROP TRIGGER reject_chat_test_audit ON safety_audit_events');
      await sql.query('DROP FUNCTION reject_chat_test_audit()');
    }
    expect((await sql.query<{count:number}>('SELECT count(*)::int AS count FROM reports')).rows[0]!.count).toBe(before);
  });
  it('blocks both Discover and direct Profile reads; repeats are idempotent and unblock only affects the owner', async () => {
    actorId = a;
    await request(app).get(`/v1/users/${b}`).expect(200);
    await request(app).post(`/v1/blocks/${b}`).expect(204);
    await request(app).post(`/v1/blocks/${b}`).expect(204);
    expect((await sql.query('SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [a,b])).rowCount).toBe(1);
    await request(app).get(`/v1/users/${b}`).expect(404);
    expect(json<{ users: { id: string }[] }>(await request(app).get('/v1/discover?radius=unlimited&limit=50')).users.map(u => u.id)).not.toContain(b);
    actorId = b;
    await request(app).get(`/v1/users/${a}`).expect(404);
    expect(json<{ users: { id: string }[] }>(await request(app).get('/v1/discover?radius=unlimited&limit=50')).users.map(u => u.id)).not.toContain(a);
    await request(app).delete(`/v1/blocks/${a}`).expect(204);
    await request(app).get(`/v1/users/${a}`).expect(404);
    actorId = a;
    await request(app).delete(`/v1/blocks/${b}`).expect(204);
    await request(app).delete(`/v1/blocks/${b}`).expect(204);
    await request(app).get(`/v1/users/${b}`).expect(200);
    expect((await sql.query<{ count: number }>(`SELECT count(*)::int AS count FROM safety_audit_events WHERE actor_id=$1 AND action='block' AND target_id=$2 AND request_id IS NOT NULL`, [a,b])).rows[0]!.count).toBe(2);
  });
  it('rejects self block/report and nonexistent or unavailable targets', async () => {
    actorId = a;
    await request(app).post(`/v1/blocks/${a}`).expect(422);
    await request(app).post(`/v1/blocks/${a.toUpperCase()}`).expect(422);
    await request(app).post('/v1/reports').send(report(a)).expect(422);
    await request(app).post('/v1/reports').send(report(a.toUpperCase())).expect(422);
    await request(app).post(`/v1/blocks/${id(999)}`).expect(404);
    await request(app).post('/v1/reports').send(report(id(999))).expect(404);
    await sql.query(`UPDATE users SET status='SUSPENDED' WHERE id=$1`, [c]);
    await request(app).post('/v1/reports').send(report(c)).expect(404);
    await sql.query(`UPDATE users SET status='ACTIVE' WHERE id=$1`, [c]);
  });
  it('stores server snapshots, repeated target evidence and request metadata without auto block', async () => {
    actorId = a;
    const response = await request(app).post('/v1/reports').send(report()).expect(201);
    expect(json<Receipt>(response).blockedUser).toBe(false);
    const saved = (await sql.query<ReportRow>('SELECT * FROM reports WHERE id=$1', [json<Receipt>(response).referenceId])).rows[0]!;
    expect(saved).toMatchObject({ reporter_id: a, target_user_id: b, status: 'open', source: 'profile', request_id: response.headers['x-request-id'] });
    expect(saved.snapshot).toMatchObject({ displayName: 'Safety 2', bio: 'Original bio', sports: [{ sport: 'running', paceValue: 5.5, paceUnit: 'min/km' }] });
    expect(JSON.stringify(saved.snapshot)).not.toMatch(/latitude|longitude|photoKey|password|email/);
    await sql.query(`UPDATE profiles SET bio='Changed bio' WHERE user_id=$1`, [b]);
    expect((await sql.query<ReportRow>('SELECT snapshot FROM reports WHERE id=$1', [saved.id])).rows[0]!.snapshot.bio).toBe('Original bio');
    await expect(sql.query(`UPDATE reports SET snapshot='{}'::jsonb WHERE id=$1`, [saved.id])).rejects.toMatchObject({ code: '23514' });
    const repeat = await request(app).post('/v1/reports').send(report()).expect(201);
    expect(json<Receipt>(repeat).referenceId).not.toBe(saved.id);
    expect((await sql.query<ReportRow>('SELECT snapshot FROM reports WHERE id=$1', [json<Receipt>(repeat).referenceId])).rows[0]!.snapshot.bio).toBe('Changed bio');
    expect((await sql.query('SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2',[a,b])).rowCount).toBe(0);
  });
  it('commits report-and-block together and rolls both back if audit persistence fails', async () => {
    actorId = a;
    const response = await request(app).post('/v1/reports').send(report(b,true)).expect(201);
    expect(json<Receipt>(response).blockedUser).toBe(true);
    await request(app).get(`/v1/users/${b}`).expect(404);
    await request(app).delete(`/v1/blocks/${b}`).expect(204);
    const before = (await sql.query<{count:number}>('SELECT count(*)::int AS count FROM reports')).rows[0]!.count;
    await sql.query(`CREATE FUNCTION reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test audit failure'; END $$`);
    await sql.query('CREATE TRIGGER reject_test_audit BEFORE INSERT ON safety_audit_events FOR EACH ROW EXECUTE FUNCTION reject_test_audit()');
    try {
      await request(app).post('/v1/reports').send(report(c,true)).expect(500);
    } finally {
      await sql.query('DROP TRIGGER reject_test_audit ON safety_audit_events');
      await sql.query('DROP FUNCTION reject_test_audit()');
    }
    expect((await sql.query<{count:number}>('SELECT count(*)::int AS count FROM reports')).rows[0]!.count).toBe(before);
    expect((await sql.query('SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2',[a,c])).rowCount).toBe(0);
  });
  it('paginates only the callers blocked users, without coordinates or unavailable profile details', async () => {
    actorId = a;
    await sql.query(`INSERT INTO blocks(blocker_id,blocked_id) SELECT $1::uuid,id FROM users WHERE id=ANY($2::uuid[])`, [a,Array.from({ length: 54 }, (_,n)=>id(n+2))]);
    await sql.query(`UPDATE users SET status='SUSPENDED' WHERE id=$1`, [b]);
    const first = json<BlockedPage>(await request(app).get('/v1/blocks').expect(200));
    expect(first.users).toHaveLength(50);
    expect(first.users[0]).toEqual({ id:b,displayName:null,cityName:null });
    const second = json<BlockedPage>(await request(app).get(`/v1/blocks?cursor=${first.nextCursor}`).expect(200));
    expect(second.users).toHaveLength(4);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.users,...second.users].map(u=>u.id)).size).toBe(54);
    expect(JSON.stringify(first)).not.toMatch(/latitude|longitude|photoKey/);
    actorId = c;
    expect(json<BlockedPage>(await request(app).get('/v1/blocks')).users).toEqual([]);
    await sql.query(`UPDATE users SET status='ACTIVE' WHERE id=$1`, [b]);
    await sql.query('DELETE FROM blocks WHERE blocker_id=$1',[a]);
  });
});
