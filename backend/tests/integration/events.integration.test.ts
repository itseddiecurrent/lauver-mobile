import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createDatabase } from '../../src/database.js';
import { EventService } from '../../src/events.js';
import { createAuthServiceStub, createTestApp } from '../helpers/test-app.js';

const db = createDatabase(process.env.TEST_DATABASE_URL!);
const service = new EventService(db.client);
const users = Array.from({ length: 22 }, () => randomUUID());
const owner = users[0]!, member = users[1]!;
const auth = createAuthServiceStub({ restore: vi.fn().mockResolvedValue({ id: owner, email: null }) });
// Exercise the real routes and application error mapping.
const app = createTestApp({ eventService: service, authService: auth });
const draft = (minutes = 60, capacity = 2) => ({ title: 'Acceptance', sport: 'running' as const,
  startsAt: new Date(Date.now() + minutes * 60000).toISOString(), endsAt: new Date(Date.now() + (minutes + 60) * 60000).toISOString(), capacity, venueName: 'Step 11 integration', venueLatitude: 31.23, venueLongitude: 121.47 });
beforeAll(async () => { for (const id of users) await db.client.user.create({ data: { id } }); });
afterAll(async () => {
  await db.client.safetyAuditEvent.deleteMany({ where: { actorId: { in: users } } });
  await db.client.report.deleteMany({ where: { reporterId: { in: users } } });
  await db.client.user.deleteMany({ where: { id: { in: users } } }); await db.disconnect();
});

describe('Step 11 real PostgreSQL acceptance', () => {
  it('commits before the create response and paginates a new event beyond 20 older starts', async () => {
    for (let n = 1; n <= 21; n++) await service.create(owner, draft(n));
    const created = await service.create(owner, draft(90));
    expect(await service.get(created.id, member)).toMatchObject({ id: created.id, attendeeCount: 1, isCreator: false });
    const first = await service.list({ limit: 20, city: 'Step 11 integration' }, owner);
    expect(first.events).toHaveLength(20); expect(first.events.some(e => e.id === created.id)).toBe(false);
    const next = await service.list({ limit: 20, city: 'Step 11 integration', cursor: first.nextCursor! }, owner);
    expect(next.events.some(e => e.id === created.id)).toBe(true);
    expect(new Set([...first.events, ...next.events].map(e => e.id)).size).toBe(22);
  });
  it('rejects invalid times, capacity, venue, IDs, edit bodies and report reasons with 422', async () => {
    for (const invalid of [{ startsAt: new Date(0).toISOString() }, { capacity: 1 }, { venueLatitude: 91 }, { venueName: '' }]) await request(app).post('/v1/events').send({ ...draft(), ...invalid }).expect(422);
    await request(app).post('/v1/events/not-a-uuid/join').expect(422);
    await request(app).patch('/v1/events/' + randomUUID()).send({ capacity: 1 }).expect(422);
    await request(app).post('/v1/events/' + randomUUID() + '/report').send({ reason: 'invalid' }).expect(422);
  });
  it('serializes 20 distinct users racing for the last place and keeps join/leave idempotent', async () => {
    const event = await service.create(owner, draft());
    const results = await Promise.allSettled(users.slice(1, 21).map(id => service.join(id, event.id)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(r => r.status === 'rejected'); expect(rejected).toHaveLength(19);
    for (const r of rejected) expect(r.reason).toMatchObject({ code: 'event_full' });
    expect((await service.get(event.id)).attendeeCount).toBe(2);
    const winner = users[1 + results.findIndex(r => r.status === 'fulfilled')]!;
    expect((await service.join(winner, event.id)).attendeeCount).toBe(2);
    expect((await service.leave(winner, event.id)).attendeeCount).toBe(1);
    expect((await service.leave(winner, event.id)).attendeeCount).toBe(1);
    await expect(service.leave(owner, event.id)).rejects.toMatchObject({ code: 'creator_cannot_leave' });
  });
  it('prevents shrinking below attendance, including concurrent capacity edits and joins', async () => {
    const event = await service.create(owner, draft(60, 3)); await service.join(member, event.id);
    await Promise.allSettled([service.join(users[2]!, event.id), service.update(owner, event.id, { capacity: 2 })]);
    const current = await service.get(event.id); expect(current.attendeeCount).toBeLessThanOrEqual(current.capacity);
    if (current.capacity === 2) await service.update(owner, event.id, { capacity: 3 });
    if (current.attendeeCount === 2) await service.join(users[2]!, event.id);
    await expect(service.update(owner, event.id, { capacity: 2 })).rejects.toMatchObject({ code: 'capacity_below_attendance' });
  });
  it('enforces creator permissions, removes cancelled events from Upcoming, retains attendee status', async () => {
    const e = await service.create(owner, draft()); await service.join(member, e.id);
    await expect(service.update(member, e.id, { title: 'Forbidden' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.cancel(member, e.id)).rejects.toMatchObject({ statusCode: 403 });
    expect((await service.update(owner, e.id, { title: 'Edited' })).title).toBe('Edited');
    await service.cancel(owner, e.id);
    expect(await service.get(e.id, member)).toMatchObject({ status: 'cancelled', isAttendee: true });
    expect((await service.list({ limit: 50 }, owner)).events.some(r => r.id === e.id)).toBe(false);
    await expect(service.join(users[2]!, e.id)).rejects.toMatchObject({ code: 'event_cancelled' });
  });
  it('stores event and organizer reports with evidence and commits the audit atomically', async () => {
    const e = await service.create(owner, draft());
    for (const target of ['event', 'user'] as const) {
      const receipt = await service.report(member, e.id, 'other', undefined, randomUUID(), target);
      expect(await db.client.report.findUnique({ where: { id: receipt.referenceId } })).toMatchObject({ targetType: target, source: 'event', snapshot: { id: e.id, title: e.title } });
      expect(await db.client.safetyAuditEvent.count({ where: { reportId: receipt.referenceId } })).toBe(1);
    }
    await expect(service.report(owner, e.id, 'other', undefined, randomUUID())).rejects.toMatchObject({ code: 'self_report' });
    const count = await db.client.report.count();
    await db.client.$executeRawUnsafe(`CREATE FUNCTION reject_step11_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Acceptance audit failure'; END $$`);
    await db.client.$executeRawUnsafe('CREATE TRIGGER reject_step11_audit BEFORE INSERT ON safety_audit_events FOR EACH ROW EXECUTE FUNCTION reject_step11_audit()');
    try { await expect(service.report(member, e.id, 'other', undefined, randomUUID())).rejects.toThrow(); }
    finally { await db.client.$executeRawUnsafe('DROP TRIGGER reject_step11_audit ON safety_audit_events'); await db.client.$executeRawUnsafe('DROP FUNCTION reject_step11_audit()'); }
    expect(await db.client.report.count()).toBe(count);
  });
});
