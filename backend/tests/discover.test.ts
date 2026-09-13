import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AuthError } from '../src/auth.js';
import { DiscoverService, discoverQuerySchema, type DiscoverRepository } from '../src/discover.js';
import { UnavailableProfilePhotoStorage } from '../src/object-storage.js';
import { createAuthServiceStub, createTestApp } from './helpers/test-app.js';

const origin = { latitude: 0, longitude: 0, sports: ['running'] };
const rows = [1, 2].map((n) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, displayName: `Runner ${n}`,
  photoKey: null, cityName: 'City', regionCode: null, countryCode: 'CN',
  distance: n * 1.234567, updatedAt: '2026-09-13T00:00:00.000Z',
  sports: [{ sport: 'running', paceValue: 5, paceUnit: 'min/km' }],
}));
function fixture() {
  const repository = {
    origin: vi.fn<DiscoverRepository['origin']>().mockResolvedValue(origin),
    search: vi.fn<DiscoverRepository['search']>().mockResolvedValue(rows),
  } satisfies DiscoverRepository;
  return { repository, service: new DiscoverService(repository, new UnavailableProfilePhotoStorage(), 'test-cursor-secret') };
}

describe('Discover validation and cursor privacy', () => {
  it('accepts the expanded radius options and an explicit unlimited radius', () => {
    for (const radius of [20, 30, 40, 50, 60, 70, 80, 90, 100]) {
      expect(discoverQuerySchema.parse({ radius: String(radius) }).radius).toBe(radius);
    }
    expect(discoverQuerySchema.parse({ radius: 'unlimited' }).radius).toBeNull();
    expect(discoverQuerySchema.parse({}).radius).toBe(25);
  });
  it.each([
    { sport: 'invalid' }, { radius: '0' }, { radius: '26' }, { radius: ['5', '10'] },
    { paceBracket: 'fast' }, { paceMin: '5' }, { paceMax: '6' },
    { sport: 'running', paceMin: '6', paceMax: '5' },
    { sport: 'running', paceMin: 'NaN' }, { sport: 'running', paceMax: 'Infinity' },
    { sport: 'running', paceMin: '5:00' }, { sport: 'cycling', paceMin: '-1' },
    { sport: 'cycling', paceMax: '81' }, { sport: 'swimming', paceMin: '0.4' },
    { sport: 'running', paceMin: '0' }, { sport: 'running', paceMax: '' },
    { sport: 'running', paceMin: ['5', '6'] },
    { limit: '51' }, { limit: '0' }, { limit: '1.5' }, { cursor: '' }, { userId: 'forged' },
  ])('rejects invalid query %j', (query) => {
    expect(discoverQuerySchema.safeParse(query).success).toBe(false);
  });

  it('accepts numeric ranges and either open end in the sport’s units', () => {
    expect(discoverQuerySchema.parse({ sport: 'running', paceMin: String(5 + 1 / 60), paceMax: String(6 + 1 / 60) }))
      .toMatchObject({ paceMin: 5.016667, paceMax: 6.016667 });
    expect(discoverQuerySchema.parse({ sport: 'cycling', paceMin: '20', paceMax: '30' }))
      .toMatchObject({ paceMin: 20, paceMax: 30 });
    expect(discoverQuerySchema.parse({ sport: 'swimming', paceMax: '2.5' }).paceMin).toBeUndefined();
    expect(discoverQuerySchema.parse({ sport: 'rowing', paceMin: '1.8' }).paceMax).toBeUndefined();
  });

  it('returns approximate distance, shared sports, and an opaque signed cursor', async () => {
    const { service } = fixture();
    const page = await service.discover('viewer', discoverQuerySchema.parse({ limit: '1' }));
    expect(page.users[0]).toMatchObject({ approximateDistanceKm: 1, commonSports: ['running'] });
    expect(JSON.stringify(page)).not.toMatch(/latitude|longitude|photoKey|updatedAt/);
    expect(page.nextCursor).not.toBeNull();
  });

  it('uses the unrounded distance for pagination and rejects reuse with a different context or signature', async () => {
    const { service, repository } = fixture();
    const query = discoverQuerySchema.parse({ limit: '1', sport: 'running' });
    const page = await service.discover('viewer', query);
    const cursor = page.nextCursor!;
    await service.discover('viewer', { ...query, cursor });
    expect(repository.search).toHaveBeenLastCalledWith('viewer', origin, { ...query, cursor }, expect.objectContaining({ distance: rows[0]!.distance }));
    for (const changed of [
      { ...query, cursor: `${cursor}x` }, { ...query, cursor, radius: 50 },
      { ...query, cursor, radius: null },
      { ...query, cursor, paceMin: 5 },
      { ...query, cursor, paceMax: 6 },
    ]) await expect(service.discover('viewer', changed)).rejects.toMatchObject({ code: 'invalid_discover_cursor' });
    await expect(service.discover('other-viewer', { ...query, cursor })).rejects.toMatchObject({ code: 'invalid_discover_cursor' });
    vi.mocked(repository.origin).mockResolvedValue({ ...origin, longitude: 1 });
    await expect(service.discover('viewer', { ...query, cursor })).rejects.toMatchObject({ code: 'invalid_discover_cursor' });
  });

  it('requires a saved city and stops pagination at the last page', async () => {
    const { repository, service } = fixture();
    expect((await service.discover('viewer', discoverQuerySchema.parse({}))).nextCursor).toBeNull();
    vi.mocked(repository.origin).mockResolvedValue(null);
    await expect(service.discover('viewer', discoverQuerySchema.parse({}))).rejects.toMatchObject({ code: 'discover_city_required' });
  });
});

describe('Discover route authorization', () => {
  it('uses the authenticated identity and validates parameters before querying', async () => {
    const discover = vi.fn().mockResolvedValue({ users: [], nextCursor: null });
    const app = createTestApp({
      authService: createAuthServiceStub({ restore: vi.fn().mockResolvedValue({ id: 'trusted-viewer', email: null }) }),
      discoverService: { discover },
    });
    const response = await request(app).get('/v1/discover?sport=running&radius=10&paceMin=4&paceMax=5').set('Authorization', 'Bearer valid');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(discover).toHaveBeenCalledWith('trusted-viewer', { sport: 'running', radius: 10, paceMin: 4, paceMax: 5, limit: 20 });
    discover.mockClear();
    await request(app).get('/v1/discover?userId=forged').expect(422);
    expect(discover).not.toHaveBeenCalled();
  });

  it('does not query for an invalid session', async () => {
    const discover = vi.fn();
    const app = createTestApp({
      authService: createAuthServiceStub({ restore: vi.fn().mockRejectedValue(new AuthError(401, 'invalid_session', 'Invalid session')) }),
      discoverService: { discover },
    });
    await request(app).get('/v1/discover').expect(401);
    expect(discover).not.toHaveBeenCalled();
  });
});
