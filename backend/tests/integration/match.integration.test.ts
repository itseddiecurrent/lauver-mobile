import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/database.js';
import { MatchService } from '../../src/match.js';
import { UnavailableProfilePhotoStorage } from '../../src/object-storage.js';

const databaseURL = process.env.TEST_DATABASE_URL;
if (!databaseURL) throw new Error('TEST_DATABASE_URL is required for Match integration tests');

const database = createDatabase(databaseURL);
const viewer = 'a2600000-0000-4000-8000-000000000001';
const target = 'a2600000-0000-4000-8000-000000000002';
const targetWithoutCity = 'a2600000-0000-4000-8000-000000000003';
const quotaViewer = 'a2600000-0000-4000-8000-000000000004';
const resetViewer = 'a2600000-0000-4000-8000-000000000005';
const concurrentA = 'a2600000-0000-4000-8000-000000000006';
const concurrentB = 'a2600000-0000-4000-8000-000000000007';
const blockedTarget = 'a2600000-0000-4000-8000-000000000008';
const suspendedTarget = 'a2600000-0000-4000-8000-000000000009';
const deletedTarget = 'a2600000-0000-4000-8000-000000000010';
const outsider = 'a2600000-0000-4000-8000-000000000011';
const quotaTargets = Array.from({ length: 17 }, (_, index) => `a2600000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`);
const resetTargets = Array.from({ length: 16 }, (_, index) => `a2600000-0000-4000-8000-${String(200 + index).padStart(12, '0')}`);
const fixtureIDs = [viewer, target, targetWithoutCity, quotaViewer, resetViewer, concurrentA, concurrentB, blockedTarget, suspendedTarget, deletedTarget, outsider, ...quotaTargets, ...resetTargets];
const service = new MatchService(database.client, new UnavailableProfilePhotoStorage(), 'integration-match-cursor-secret');

async function insertUser(id: string, displayName: string, visibleInMatch = true): Promise<void> {
  const timestamp = new Date('2026-09-01T00:00:00.000Z');
  await database.client.$executeRaw`
    INSERT INTO users (id, status, created_at, updated_at)
    VALUES (${id}::uuid, 'ACTIVE', ${timestamp}, ${timestamp})`;
  await database.client.$executeRaw`
    INSERT INTO profiles (user_id, display_name, is_complete, visible_in_match, updated_at)
    VALUES (${id}::uuid, ${displayName}, true, ${visibleInMatch}, ${timestamp})`;
}

beforeAll(async () => {
  await insertUser(viewer, 'Match viewer');
  await insertUser(target, 'Match target');
  await insertUser(targetWithoutCity, 'No city target');
  await insertUser(quotaViewer, 'Quota viewer');
  await insertUser(resetViewer, 'Reset viewer');
  await insertUser(concurrentA, 'Concurrent A');
  await insertUser(concurrentB, 'Concurrent B');
  await insertUser(blockedTarget, 'Blocked target');
  await insertUser(suspendedTarget, 'Suspended target');
  await insertUser(deletedTarget, 'Deleted target');
  await insertUser(outsider, 'Outsider');
  for (const id of [...quotaTargets, ...resetTargets]) await insertUser(id, `Fixture ${id.slice(-4)}`);
});

afterAll(async () => {
  await database.client.user.deleteMany({ where: { id: { in: fixtureIDs } } });
  await database.disconnect();
});

describe('Match PostgreSQL invariants', () => {
  it('paginates candidates whose approximate distance is unavailable without duplicates', async () => {
    const first = await service.candidates(viewer, { limit: 1, gender: undefined, maxDistanceKm: null, sport: undefined });
    expect(first.users).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = await service.candidates(viewer, { limit: 1, cursor: first.nextCursor!, gender: undefined, maxDistanceKm: null, sport: undefined });
    expect(second.users).toHaveLength(1);
    expect(second.users[0]?.id).not.toBe(first.users[0]?.id);
  });

  it('creates one Match for reciprocal Like and keeps retries idempotent', async () => {
    await expect(service.swipe(viewer, target, 'like')).resolves.toMatchObject({ matched: false });
    await expect(service.swipe(viewer, target, 'like')).resolves.toMatchObject({ matched: false });
    expect(await database.client.swipe.count({ where: { actorId: viewer, targetId: target } })).toBe(1);

    const result = await service.swipe(target, viewer, 'like');
    expect(result.matched).toBe(true);
    expect(await database.client.match.count({ where: { lowerUserId: viewer, higherUserId: target } })).toBe(1);
  });

  it('rejects new swipes when the actor leaves the Match pool', async () => {
    await database.client.profile.update({ where: { userId: viewer }, data: { visibleInMatch: false } });
    await expect(service.swipe(viewer, targetWithoutCity, 'like')).rejects.toMatchObject({ code: 'match_not_available' });
    await database.client.profile.update({ where: { userId: viewer }, data: { visibleInMatch: true } });
  });

  it('enforces the 15 Like UTC limit, does not count Pass, and resets by UTC day', async () => {
    await expect(service.swipe(quotaViewer, quotaTargets[0]!, 'pass')).resolves.toMatchObject({ direction: 'pass', matched: false });
    await database.client.swipe.createMany({ data: quotaTargets.slice(1, 15).map(targetId => ({ actorId: quotaViewer, targetId, direction: 'LIKE' as const })) });
    expect(await database.client.swipe.count({ where: { actorId: quotaViewer, direction: 'LIKE' } })).toBe(14);
    await expect(service.swipe(quotaViewer, quotaTargets[15]!, 'like')).resolves.toMatchObject({ matched: false });
    await expect(service.swipe(quotaViewer, quotaTargets[16]!, 'like')).rejects.toMatchObject({ code: 'daily_like_limit', statusCode: 429 });

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await database.client.swipe.createMany({ data: resetTargets.slice(0, 15).map(targetId => ({ actorId: resetViewer, targetId, direction: 'LIKE' as const, createdAt: yesterday, updatedAt: yesterday })) });
    await expect(service.swipe(resetViewer, resetTargets[15]!, 'like')).resolves.toMatchObject({ matched: false });
  });

  it('serializes concurrent reciprocal Likes into one canonical Match', async () => {
    const results = await Promise.all([
      service.swipe(concurrentA, concurrentB, 'like'),
      service.swipe(concurrentB, concurrentA, 'like'),
    ]);
    expect(results.some(result => result.matched)).toBe(true);
    expect(await database.client.match.count({ where: { lowerUserId: concurrentA, higherUserId: concurrentB } })).toBe(1);
  });

  it('rejects blocked, suspended, and deleted targets immediately', async () => {
    await database.client.block.create({ data: { blockerId: viewer, blockedId: blockedTarget } });
    await expect(service.swipe(viewer, blockedTarget, 'like')).rejects.toMatchObject({ code: 'match_blocked' });
    await database.client.user.update({ where: { id: suspendedTarget }, data: { status: 'SUSPENDED' } });
    await expect(service.swipe(viewer, suspendedTarget, 'like')).rejects.toMatchObject({ code: 'match_target_unavailable' });
    await database.client.user.update({ where: { id: deletedTarget }, data: { status: 'DELETED' } });
    await expect(service.swipe(viewer, deletedTarget, 'like')).rejects.toMatchObject({ code: 'match_target_unavailable' });
  });

  it('protects Unmatch from IDOR and prevents the old Match from being listed', async () => {
    const match = await database.client.match.findUniqueOrThrow({ where: { lowerUserId_higherUserId: { lowerUserId: concurrentA, higherUserId: concurrentB } } });
    await expect(service.unmatch(outsider, match.id)).rejects.toMatchObject({ code: 'match_not_found' });
    await service.unmatch(concurrentA, match.id);
    expect(await service.list(concurrentA)).toEqual([]);
    expect(await database.client.match.findUniqueOrThrow({ where: { id: match.id } })).toMatchObject({ unmatchedBy: concurrentA });

    const rematched = await service.swipe(concurrentB, concurrentA, 'like');
    expect(rematched).toMatchObject({ matched: true, matchId: match.id });
    expect(await service.list(concurrentA)).toHaveLength(1);
    await service.unmatch(concurrentA, match.id);
  });
});
