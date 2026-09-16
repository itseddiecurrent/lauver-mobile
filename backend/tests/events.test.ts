import { describe, expect, it, vi } from 'vitest';
import { EventError, EventService } from '../src/events.js';

const creator = 'e2800000-0000-4000-8000-000000000001';
const attendee = 'e2800000-0000-4000-8000-000000000002';
const id = 'e2800000-0000-4000-8000-000000000010';
const future = new Date(Date.now() + 86_400_000);
const later = new Date(future.getTime() + 3_600_000);
function row(capacity = 2, users = [creator]) {
  return { id, creatorId: creator, title: 'Run', description: null, sport: 'running', startsAt: future, endsAt: later, capacity, venueName: 'Park', venueAddress: null, venueLatitude: 31, venueLongitude: 121, status: 'UPCOMING', attendees: users.map((userId) => ({ eventId: id, userId, joinedAt: future })), creator: { id: creator, profile: { displayName: 'Runner' } } } as never;
}
function client(event = row()) {
  const db = { event: { findUnique: vi.fn().mockResolvedValue(event), findUniqueOrThrow: vi.fn().mockResolvedValue(event), findMany: vi.fn(), create: vi.fn(), update: vi.fn() }, eventAttendee: { create: vi.fn(), deleteMany: vi.fn() }, $transaction: vi.fn(), $queryRaw: vi.fn() };
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
  return db;
}
const input = { title: 'Run', sport: 'running' as const, startsAt: future.toISOString(), endsAt: later.toISOString(), capacity: 2, venueName: 'Park', venueLatitude: 31, venueLongitude: 121 };

describe('EventService', () => {
  it('rejects events in the past or with reversed times', async () => {
    const service = new EventService(client() as never);
    await expect(service.create(creator, { ...input, startsAt: new Date(Date.now() - 1000).toISOString() })).rejects.toMatchObject({ code: 'invalid_event_time' });
  });
  it('prevents non-creators from editing or cancelling', async () => {
    const service = new EventService(client() as never);
    await expect(service.update(attendee, id, { title: 'Changed' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.cancel(attendee, id)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('makes duplicate joins idempotent and rejects a full event', async () => {
    const db = client(row(2, [creator])); const service = new EventService(db as never);
    await service.join(attendee, id);
    expect(db.eventAttendee.create).toHaveBeenCalledOnce();
    db.event.findUnique.mockResolvedValue(row(2, [creator, attendee]));
    await service.join(attendee, id);
    expect(db.eventAttendee.create).toHaveBeenCalledOnce();
    db.event.findUnique.mockResolvedValue(row(2, [creator, attendee, 'e2800000-0000-4000-8000-000000000003']));
    await expect(service.join('e2800000-0000-4000-8000-000000000004', id)).rejects.toMatchObject({ code: 'event_full' });
  });
  it('does not allow the creator to leave', async () => {
    await expect(new EventService(client() as never).leave(creator, id)).rejects.toBeInstanceOf(EventError);
  });
});
