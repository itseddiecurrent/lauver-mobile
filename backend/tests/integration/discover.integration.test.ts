import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/database.js';
import { DiscoverService, discoverQuerySchema } from '../../src/discover.js';
import { UnavailableProfilePhotoStorage } from '../../src/object-storage.js';
import { ProfileService, supportedSports } from '../../src/profile.js';
import { createAuthServiceStub, createTestApp } from '../helpers/test-app.js';

const database = createDatabase(process.env.TEST_DATABASE_URL!);
const sql = new Client({ connectionString: process.env.TEST_DATABASE_URL! });
const id = (n: number) => `d1500000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const viewer = id(0);
const service = new DiscoverService(database.discoverRepository, new UnavailableProfilePhotoStorage(), 'integration-discover-cursor-secret');
const app = createTestApp({ database, discoverService: service,
  authService: createAuthServiceStub({ restore: vi.fn().mockResolvedValue({ id: viewer, email: null }) }),
});

// Fixed cities, timestamps, UUIDs, sports and status make ordering assertions repeatable.
const fixtures = [
  { n: 0, lng: 0, sport: 'running', pace: 5, status: 'ACTIVE', complete: true },
  { n: 1, lng: 0, sport: 'running', pace: 5, status: 'ACTIVE', complete: true },
  { n: 2, lng: 0, sport: 'cycling', pace: 35, status: 'ACTIVE', complete: true },
  { n: 3, lng: 0.02, sport: 'running', pace: null, status: 'ACTIVE', complete: true },
  { n: 4, lng: 0.045, sport: 'running', pace: 4, status: 'ACTIVE', complete: true },
  { n: 5, lng: 0.06, sport: 'running', pace: 8, status: 'ACTIVE', complete: true },
  { n: 6, lng: 1, sport: 'running', pace: 5, status: 'ACTIVE', complete: true },
  { n: 7, lng: 0, sport: 'running', pace: 5, status: 'SUSPENDED', complete: true },
  { n: 8, lng: 0, sport: 'running', pace: 5, status: 'DELETED', complete: true },
  { n: 9, lng: 0, sport: 'running', pace: 5, status: 'ACTIVE', complete: false },
  { n: 10, lng: 0, sport: 'running', pace: 5, status: 'ACTIVE', complete: true },
  { n: 11, lng: 0, sport: 'running', pace: 5, status: 'ACTIVE', complete: true },
  { n: 12, lng: 0, sport: 'running', pace: 5, status: 'ACTIVE', complete: true },
  { n: 13, lng: 0.45, sport: 'running', pace: 5, status: 'ACTIVE', complete: true },
  { n: 14, lng: 0.89, sport: 'running', pace: 5, status: 'ACTIVE', complete: true },
];
beforeAll(async () => {
  await sql.connect();
  for (const f of fixtures) {
    await sql.query('INSERT INTO users(id,status,updated_at) VALUES($1,$2,$3)', [id(f.n), f.status, '2026-09-01']);
    await sql.query(`INSERT INTO profiles(user_id,display_name,city_name,country_code,city_latitude,city_longitude,is_complete,updated_at)
      VALUES($1,$2,'Fixture City','CN',0,$3,$4,$5)`, [id(f.n), `Runner ${f.n}`, f.lng, f.complete, f.n === 12 ? '2026-09-02' : '2026-09-01']);
    await sql.query(`INSERT INTO user_sports(user_id,sport,pace_value,pace_unit,updated_at)
      VALUES($1,$2,$3,$4,'2026-09-01')`, [id(f.n), f.sport, f.pace, f.pace === null ? null : f.sport === 'cycling' ? 'km/h' : 'min/km']);
  }
  await sql.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2),($3,$1)', [viewer, id(10), id(11)]);
});
afterAll(async () => {
  await sql.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [fixtures.map((f) => id(f.n))]);
  await database.disconnect();
  await sql.end();
});

async function get(query: string) {
  const response = await request(app).get(`/v1/discover?${query}`);
  expect(response.status).toBe(200);
  return response.body as Awaited<ReturnType<typeof service.discover>>;
}

describe('Discover deterministic PostgreSQL filters', () => {
  it('repeats the same fixed order ten times and excludes both block directions and unavailable profiles', async () => {
    for (let n = 0; n < 10; n++) {
      const page = await get('radius=10');
      expect(page.users.map((u) => u.id)).toEqual([id(12), id(1), id(2), id(3), id(4), id(5)]);
      expect(JSON.stringify(page)).not.toMatch(/latitude|longitude|photoKey|city_lat|city_lng/);
    }
  });

  it('filters sport, radius and pace independently and in combination', async () => {
    expect((await get('sport=cycling')).users.map((u) => u.id)).toEqual([id(2)]);
    expect((await get('radius=5')).users.map((u) => u.id)).toEqual([id(12), id(1), id(2), id(3)]);
    expect((await get('sport=running&paceMin=5&paceMax=6.5')).users.map((u) => u.id)).toEqual([id(12), id(1)]);
    expect((await get('sport=running&paceMax=4.5&radius=5')).users).toEqual([]);
    expect((await get('sport=running&paceMax=4.5&radius=10')).users.map((u) => u.id)).toEqual([id(4)]);
    expect((await get('sport=running&paceMin=7&radius=10')).users.map((u) => u.id)).toEqual([id(5)]);
  });

  it('paginates across distance, timestamp and UUID ties without duplicates or omissions', async () => {
    const expected = (await get('radius=10')).users.map((u) => u.id);
    for (const limit of [1, 2, 3, 4]) {
      let cursor: string | null = null;
      const seen: string[] = [];
      do {
        const page = await get(`radius=10&limit=${limit}${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`);
        seen.push(...page.users.map((u) => u.id));
        cursor = page.nextCursor;
        expect(seen.length).toBeLessThanOrEqual(expected.length);
      } while (cursor !== null);
      expect(seen).toEqual(expected);
      expect(new Set(seen).size).toBe(seen.length);
    }
  });

  it('includes both precise pace endpoints for every sport, including single-value ranges', async () => {
    const profiles = new ProfileService({ repository: database.profileRepository, storage: new UnavailableProfilePhotoStorage() });
    const temporaryIds: string[] = [];
    try {
      for (const [index, sport] of supportedSports.entries()) {
        const ids = [id(100 + index * 2), id(101 + index * 2)];
        const values = sport === 'cycling' ? [25.5, 26.5] : [5 + 1 / 60, 5 + 2 / 60];
        for (let n = 0; n < 2; n++) {
          temporaryIds.push(ids[n]!);
          await sql.query("INSERT INTO users(id,updated_at) VALUES($1,'2026-09-01')", [ids[n]]);
          const saved = await profiles.updateProfile(ids[n]!, {
            displayName: `Range ${sport} ${n}`, city: { name: 'Range City', regionCode: null, countryCode: 'CN', latitude: 0, longitude: 0.001 },
            sports: [{ sport, paceValue: values[n]! }], trainingTimes: [{ weekday: 1, timeBucket: 'morning' }],
          });
          expect(saved.sports[0]!.paceValue).toBe(Math.round(values[n]! * 1_000_000) / 1_000_000);
          expect(saved.sports[0]).not.toHaveProperty('paceBracket');
        }
        await sql.query("UPDATE profiles SET updated_at='2026-09-01' WHERE user_id=ANY($1::uuid[])", [ids]);
        const range = new URLSearchParams({ sport, paceMin: String(values[0]), paceMax: String(values[1]) });
        expect((await get(range.toString())).users.map((u) => u.id)).toEqual(ids);
        range.set('paceMin', String(values[1]));
        expect((await get(range.toString())).users.map((u) => u.id)).toEqual([ids[1]]);
      }
    } finally { await sql.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [temporaryIds]); }
  });

  it('applies expanded distance limits and paginates unlimited results with the same exclusions', async () => {
    for (const radius of [20, 30, 40, 50, 60, 70, 80, 90, 100]) {
      const ids = (await get(`radius=${radius}`)).users.map((u) => u.id);
      expect(ids).not.toContain(id(6));
      expect(ids.includes(id(13))).toBe(radius >= 60);
      expect(ids.includes(id(14))).toBe(radius === 100);
    }
    const expected = [id(12), id(1), id(2), id(3), id(4), id(5), id(13), id(14), id(6)];
    expect((await get('radius=unlimited')).users.map((u) => u.id)).toEqual(expected);
    expect((await get('radius=unlimited&sport=running&paceMin=5&paceMax=6.5')).users.map((u) => u.id))
      .toEqual([id(12), id(1), id(13), id(14), id(6)]);
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const page = await get(`radius=unlimited&limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`);
      ids.push(...page.users.map((u) => u.id));
      cursor = page.nextCursor;
      expect(ids.length).toBeLessThanOrEqual(expected.length);
    } while (cursor !== null);
    expect(ids).toEqual(expected);
    const limited = await get('radius=100&limit=1');
    await request(app).get(`/v1/discover?radius=unlimited&cursor=${encodeURIComponent(limited.nextCursor!)}`).expect(422);
    const unlimited = await get('radius=unlimited&limit=1');
    await request(app).get(`/v1/discover?radius=100&cursor=${encodeURIComponent(unlimited.nextCursor!)}`).expect(422);
  });

  it('includes the exact radius boundary and excludes the immediately outside point', async () => {
    const origin = (await database.discoverRepository.origin(viewer))!;
    const rows = await database.discoverRepository.search(viewer, origin, discoverQuerySchema.parse({ radius: '10' }), null);
    const boundary = rows.find((r) => r.id === id(4))!.distance;
    const search = (radius: number) => database.discoverRepository.search(viewer, origin, { radius, limit: 20 }, null);
    expect((await search(boundary)).map((r) => r.id)).toContain(id(4));
    expect((await search(boundary - 1e-9)).map((r) => r.id)).not.toContain(id(4));
    expect((await search(boundary + 1e-9)).map((r) => r.id)).toContain(id(4));
  });

  it('enforces new blocks when requesting the next page with an old cursor', async () => {
    const first = await get('radius=10&limit=1');
    await sql.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2)', [id(1), viewer]);
    try {
      const next = await get(`radius=10&cursor=${encodeURIComponent(first.nextCursor!)}`);
      expect(next.users.map((u) => u.id)).not.toContain(id(1));
    } finally { await sql.query('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [id(1), viewer]); }
  });

  it('enforces the no-self-block database constraint', async () => {
    await expect(sql.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$1)', [viewer])).rejects.toMatchObject({ code: '23514' });
  });
});
