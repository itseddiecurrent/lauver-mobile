import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import { z } from 'zod';

import type { AuthServicing } from './auth.js';
import type { ProfilePhotoStorage } from './object-storage.js';
import { normalizedPaceValue, paceDefinitions, ProfileError, supportedSports, type Sport } from './profile.js';
import type { StoredSport } from './profile-repository.js';
import { noBlockSQL } from './block-policy.js';

const paceBound = z.string().regex(/^\d+(?:\.\d{1,17})?$/).max(20)
  .transform(Number).pipe(z.number().finite().positive())
  .transform(normalizedPaceValue);
export const discoverQuerySchema = z.object({
  sport: z.enum(supportedSports).optional(),
  radius: z.enum(['5', '10', '20', '25', '30', '40', '50', '60', '70', '80', '90', '100', 'unlimited'])
    .default('25').transform((value) => value === 'unlimited' ? null : Number(value)),
  paceMin: paceBound.optional(),
  paceMax: paceBound.optional(),
  limit: z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/).default('20').transform(Number),
  cursor: z.string().min(1).max(2048).optional(),
}).strict().refine((query) => (query.paceMin === undefined && query.paceMax === undefined) || query.sport !== undefined, {
  message: 'Choose a sport before filtering pace',
}).refine((query) => query.paceMin === undefined || query.paceMax === undefined || query.paceMin <= query.paceMax, {
  message: 'Pace range must be in ascending numeric order',
}).refine((query) => query.sport === undefined || [query.paceMin, query.paceMax].every((bound) =>
  bound === undefined || (bound >= paceDefinitions[query.sport!].minimum && bound <= paceDefinitions[query.sport!].maximum)), {
  message: 'Pace range must use the selected sport’s units and supported bounds',
});
export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;
export type DiscoverUser = {
  id: string;
  displayName: string;
  photoURL: string | null;
  city: { name: string; regionCode: string | null; countryCode: string };
  approximateDistanceKm: number;
  sports: StoredSport[];
  commonSports: string[];
};
export type DiscoverPage = { users: DiscoverUser[]; nextCursor: string | null };
export interface DiscoverServicing {
  discover(userId: string, query: DiscoverQuery): Promise<DiscoverPage>;
}
const cursorSchema = z.object({
  version: z.literal(1),
  context: z.string(),
  distance: z.number().finite().nonnegative(),
  updatedAt: z.iso.datetime(),
  id: z.uuid(),
}).strict();
type Cursor = z.infer<typeof cursorSchema>;
type Origin = { latitude: number; longitude: number; sports: string[] };
type DiscoverRow = {
  id: string; displayName: string; photoKey: string | null;
  cityName: string; regionCode: string | null; countryCode: string;
  distance: number; updatedAt: string; sports: StoredSport[];
};
export interface DiscoverRepository {
  origin(userId: string): Promise<Origin | null>;
  search(userId: string, origin: Origin, query: DiscoverQuery, cursor: Cursor | null): Promise<DiscoverRow[]>;
}

export class DiscoverService implements DiscoverServicing {
  constructor(
    private readonly repository: DiscoverRepository,
    private readonly storage: ProfilePhotoStorage,
    private readonly cursorSecret: string,
  ) {}

  async discover(userId: string, query: DiscoverQuery): Promise<DiscoverPage> {
    const origin = await this.repository.origin(userId);
    if (origin === null) {
      throw new ProfileError(422, 'discover_city_required', 'Choose a city in your profile to discover nearby workout partners.');
    }
    const context = createHash('sha256').update(JSON.stringify([
      userId, origin.latitude, origin.longitude, query.sport ?? null, query.radius,
      query.paceMin ?? null, query.paceMax ?? null,
    ])).digest('hex');
    const cursor = query.cursor === undefined ? null : this.decodeCursor(query.cursor, context);
    const rows = await this.repository.search(userId, origin, query, cursor);
    const visible = rows.slice(0, query.limit);
    const last = visible.at(-1);
    return {
      users: visible.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        photoURL: row.photoKey === null ? null : this.storage.publicURL(row.photoKey),
        city: { name: row.cityName, regionCode: row.regionCode, countryCode: row.countryCode },
        // Whole kilometres are an approximation between city centres, never GPS proximity.
        approximateDistanceKm: Math.round(row.distance),
        sports: row.sports,
        commonSports: row.sports.filter((item) => origin.sports.includes(item.sport)).map((item) => item.sport),
      })),
      nextCursor: rows.length > query.limit && last !== undefined
        ? this.encodeCursor({ version: 1, context, distance: last.distance, updatedAt: last.updatedAt, id: last.id })
        : null,
    };
  }

  private encodeCursor(cursor: Cursor): string {
    const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url');
    return `${payload}.${this.signature(payload).toString('base64url')}`;
  }

  private signature(payload: string): Buffer {
    return createHmac('sha256', this.cursorSecret).update(`discover:v1:${payload}`).digest();
  }

  private decodeCursor(value: string, context: string): Cursor {
    try {
      const parts = value.split('.');
      if (parts.length !== 2) throw new Error('Malformed cursor');
      const payload = parts[0]!;
      const supplied = Buffer.from(parts[1]!, 'base64url');
      const expected = this.signature(payload);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('Invalid signature');
      const cursor = cursorSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
      if (cursor.context !== context) throw new Error('Cursor context changed');
      return cursor;
    } catch {
      throw new ProfileError(422, 'invalid_discover_cursor', 'The discovery filters or city changed. Refresh the list.');
    }
  }
}

export class PrismaDiscoverRepository implements DiscoverRepository {
  constructor(private readonly client: PrismaClient) {}

  async origin(userId: string): Promise<Origin | null> {
    const profile = await this.client.profile.findUnique({
      where: { userId }, include: { user: { include: { sports: true } } },
    });
    if (profile?.cityLatitude == null || profile.cityLongitude === null) return null;
    return {
      latitude: Number(profile.cityLatitude), longitude: Number(profile.cityLongitude),
      sports: profile.user.sports.map((item) => item.sport),
    };
  }

  async search(userId: string, origin: Origin, query: DiscoverQuery, cursor: Cursor | null): Promise<DiscoverRow[]> {
    const sport: Sport | undefined = query.sport;
    const sportFilter = sport === undefined ? Prisma.empty : Prisma.sql`AND EXISTS (
      SELECT 1 FROM user_sports s WHERE s.user_id = p.user_id AND s.sport = ${sport}
      ${query.paceMin === undefined ? Prisma.empty : Prisma.sql`AND s.pace_value >= ${query.paceMin.toString()}::numeric`}
      ${query.paceMax === undefined ? Prisma.empty : Prisma.sql`AND s.pace_value <= ${query.paceMax.toString()}::numeric`}
    )`;
    // Bind the round-trip decimal text: Prisma's numeric parameter transport can
    // round a float and make the previous page's final row appear again.
    const cursorDistance = cursor?.distance.toString();
    return this.client.$queryRaw<DiscoverRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT p.user_id AS id, p.display_name AS "displayName", p.photo_key AS "photoKey",
          p.city_name AS "cityName", p.region_code AS "regionCode", p.country_code AS "countryCode",
          p.updated_at,
          6371.0088 * 2 * asin(sqrt(LEAST(1.0, GREATEST(0.0,
            power(sin(radians(p.city_latitude::double precision - ${origin.latitude}::double precision) / 2), 2)
            + cos(radians(${origin.latitude}::double precision)) * cos(radians(p.city_latitude::double precision))
            * power(sin(radians(p.city_longitude::double precision - ${origin.longitude}::double precision) / 2), 2)
          )))) AS distance
        FROM profiles p JOIN users u ON u.id = p.user_id
        WHERE p.user_id <> ${userId}::uuid AND u.status = 'ACTIVE' AND p.is_complete
          AND p.city_latitude IS NOT NULL AND p.city_longitude IS NOT NULL
          AND ${noBlockSQL(userId, Prisma.sql`p.user_id`)}
          ${sportFilter}
      )
      SELECT id, "displayName", "photoKey", "cityName", "regionCode", "countryCode", distance,
        to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt",
        (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'sport', s.sport, 'paceValue', s.pace_value::double precision,
          'paceUnit', s.pace_unit
        ) ORDER BY s.sport), '[]'::jsonb) FROM user_sports s WHERE s.user_id = c.id) AS sports
      FROM candidates c
      WHERE TRUE
      ${query.radius === null ? Prisma.empty : Prisma.sql`AND distance <= ${query.radius}::double precision`}
      ${cursor === null ? Prisma.empty : Prisma.sql`AND (
        distance > ${cursorDistance}::double precision OR
        (distance = ${cursorDistance}::double precision AND updated_at < ${cursor.updatedAt}::timestamp) OR
        (distance = ${cursorDistance}::double precision AND updated_at = ${cursor.updatedAt}::timestamp AND id > ${cursor.id}::uuid)
      )`}
      ORDER BY distance ASC, updated_at DESC, id ASC LIMIT ${query.limit + 1}
    `);
  }
}

export function installDiscoverRoutes(app: Express, dependencies: {
  authService: AuthServicing; discoverService: DiscoverServicing;
}): void {
  app.get('/v1/discover', async (request, response) => {
    const authorization = request.get('authorization');
    const user = await dependencies.authService.restore(authorization?.startsWith('Bearer ') ? authorization.slice(7) : '');
    const query = discoverQuerySchema.safeParse(request.query);
    if (!query.success) {
      response.status(422).json({ code: 'validation_failed', message: 'Choose a valid sport, radius, and numeric pace range in that sport’s units.', requestId: response.getHeader('x-request-id') });
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json(await dependencies.discoverService.discover(user.id, query.data));
  });
}
