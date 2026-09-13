import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/database.js';
import { DiscoverService, discoverQuerySchema } from '../../src/discover.js';
import { UnavailableProfilePhotoStorage } from '../../src/object-storage.js';
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
  { n: 0, lng: 0, sport: 'running', pace: 5, bracket: 'moderate', status: 'ACTIVE', complete: true },
  { n: 1, lng: 0, sport: 'running', pace: 5, bracket: 'moderate', status: 'ACTIVE', complete: true },
  { n: 2, lng: 0, sport: 'cycling', pace: 35, bracket: 'fast', status: 'ACTIVE', complete: true },
  { n: 3, lng: 0.02, sport: 'running', pace: null, bracket: null, status: 'ACTIVE', complete: true },
  { n: 4, lng: 0.045, sport: 'running', pace: 4, bracket: 'fast', status: 'ACTIVE', complete: true },
  { n: 5, lng: 0.06, sport: 'running', pace: 8, bracket: 'easy', status: 'ACTIVE', complete: true },
  { n: 6, lng: 1, sport: 'running', pace: 5, bracket: 'moderate', status: 'ACTIVE', complete: true },
  { n: 7, lng: 0, sport: 'running', pace: 5, bracket: 'moderate', status: 'SUSPENDED', complete: true },
  { n: 8, lng: 0, sport: 'running', pace: 5, bracket: 'moderate', status: 'DELETED', complete: true },
  { n: 9, lng: 0, sport: 'running', pace: 5, bracket: 'moderate', status: 'ACTIVE', complete: false },
  { n: 10, lng: 0, sport: 'running', pace: 5, bracket: 'moderate', status: 'ACTIVE', complete: true },
  { n: 11, lng: 0, sport: 'running', pace: 5, bracket: 'moderate', status: 'ACTIVE', complete: true },
  { n: 12, lng: 0, sport: 'running', pace: 5, bracket: 'moderate', status: 'ACTIVE', complete: true },
];
beforeAll(async () => {
  await sql.connect();
  for (const f of fixtures) {
    await sql.query('INSERT INTO users(id,status,updated_at) VALUES($1,$2,$3)', [id(f.n), f.status, '2026-09-01']);
    await sql.query(`INSERT INTO profiles(user_id,display_name,city_name,country_code,city_latitude,city_longitude,is_complete,updated_at)
      VALUES($1,$2,'Fixture City','CN',0,$3,$4,$5)`, [id(f.n), `Runner ${f.n}`, f.lng, f.complete, f.n === 12 ? '2026-09-02' : '2026-09-01']);
    await sql.query(`INSERT INTO user_sports(user_id,sport,pace_value,pace_unit,pace_bracket,updated_at)
      VALUES($1,$2,$3,$4,$5,'2026-09-01')`, [id(f.n), f.sport, f.pace, f.pace === null ? null : f.sport === 'cycling' ? 'km/h' : 'min/km', f.bracket]);
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
    expect((await get('sport=running&paceBracket=moderate')).users.map((u) => u.id)).toEqual([id(12), id(1)]);
    expect((await get('sport=running&paceBracket=fast&radius=5')).users).toEqual([]);
    expect((await get('sport=running&paceBracket=fast&radius=10')).users.map((u) => u.id)).toEqual([id(4)]);
    expect((await get('sport=running&paceBracket=easy&radius=10')).users.map((u) => u.id)).toEqual([id(5)]);
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
