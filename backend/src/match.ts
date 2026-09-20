import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Express, Response } from 'express';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';

import type { AuthServicing } from './auth.js';
import type { ProfilePhotoStorage } from './object-storage.js';
import { authenticated } from './profile-routes.js';
import { ProfileError, supportedSports } from './profile.js';
import { noBlockSQL } from './block-policy.js';

const gender = z.enum(['male', 'female', 'other', 'prefer_not_to_say']);
const preferenceGender = z.enum(['all', 'male', 'female', 'other']);
const matchDistances = [5, 10, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100] as const;
const distance = z.union(matchDistances.map(value => z.literal(value)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]).nullable();
const sports = z.array(z.enum(supportedSports)).max(supportedSports.length).refine(
  values => new Set(values).size === values.length,
  { message: 'Sports must be unique' },
);

const preferenceSchema = z.object({
  visibleInMatch: z.boolean(),
  gender: gender.nullable(),
  preferredGender: preferenceGender,
  maxDistanceKm: distance,
  sports,
}).strict();
const swipeSchema = z.object({
  targetUserId: z.uuid(),
  direction: z.enum(['like', 'pass']),
}).strict();
const candidateQuerySchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/).default('20').transform(Number),
  gender: preferenceGender.optional(),
  maxDistanceKm: z.enum(['5', '10', '20', '25', '30', '40', '50', '60', '70', '80', '90', '100', 'unlimited']).optional().transform(value => value === undefined ? undefined : value === 'unlimited' ? null : Number(value)),
  sport: z.preprocess(value => value === undefined ? undefined : Array.isArray(value) ? value : [value], sports.optional()),
}).strict();

type CandidateQuery = z.infer<typeof candidateQuerySchema>;
type CandidateCursor = {
  version: 1;
  context: string;
  distance: number | null;
  commonSports: number;
  updatedAt: string;
  id: string;
};

export type MatchCandidate = {
  id: string;
  displayName: string;
  photoURL: string | null;
  photos: Array<{ id: string; url: string; sortOrder: number; isPrimary: boolean }>;
  city: { name: string; regionCode: string | null; countryCode: string } | null;
  approximateDistanceKm: number | null;
  sports: Array<{ sport: string; paceValue: number | null; paceUnit: string | null }>;
  commonSports: string[];
};

export type MatchPage = { users: MatchCandidate[]; nextCursor: string | null };
export type MatchPreferences = {
  visibleInMatch: boolean;
  gender: z.infer<typeof gender> | null;
  preferredGender: z.infer<typeof preferenceGender>;
  maxDistanceKm: number | null;
  sports: string[];
};
export type SwipeResult = { direction: 'like' | 'pass'; matched: boolean; matchId: string | null };
export type MatchSummary = {
  id: string;
  matchedAt: string;
  user: MatchCandidate;
};

type CandidateRow = {
  id: string;
  displayName: string;
  photoKey: string | null;
  photoKeys: string[];
  cityName: string | null;
  regionCode: string | null;
  countryCode: string | null;
  distance: number | null;
  commonSports: string[];
  updatedAt: string;
  sports: Array<{ sport: string; paceValue: number | null; paceUnit: string | null }>;
};

export class MatchService {
  constructor(
    private readonly client: PrismaClient,
    private readonly storage: ProfilePhotoStorage,
    private readonly cursorSecret: string,
  ) {}

  async preferences(userId: string): Promise<MatchPreferences> {
    const profile = await this.client.profile.findUnique({ where: { userId }, select: {
      visibleInMatch: true, gender: true, matchPrefGender: true, matchPrefDistanceKm: true, matchPrefSports: true,
    } });
    if (!profile) throw new ProfileError(404, 'profile_not_found', 'Complete your profile before using Match.');
    return this.toPreferences(profile);
  }

  async updatePreferences(userId: string, input: MatchPreferences): Promise<MatchPreferences> {
    const profile = await this.client.profile.findUnique({ where: { userId }, select: { isComplete: true } });
    if (!profile) throw new ProfileError(404, 'profile_not_found', 'Complete your profile before using Match.');
    if (input.visibleInMatch && !profile.isComplete) {
      throw new ProfileError(422, 'profile_incomplete', 'Complete your profile before joining the Match pool.');
    }
    const updated = await this.client.profile.update({ where: { userId }, data: {
      visibleInMatch: input.visibleInMatch,
      gender: input.gender,
      matchPrefGender: input.preferredGender,
      matchPrefDistanceKm: input.maxDistanceKm,
      matchPrefSports: input.sports,
    }, select: { visibleInMatch: true, gender: true, matchPrefGender: true, matchPrefDistanceKm: true, matchPrefSports: true } });
    return this.toPreferences(updated);
  }

  async candidates(userId: string, query: CandidateQuery): Promise<MatchPage> {
    const viewer = await this.client.profile.findUnique({ where: { userId }, select: {
      isComplete: true, visibleInMatch: true, cityLatitude: true, cityLongitude: true,
      matchPrefGender: true, matchPrefDistanceKm: true, matchPrefSports: true,
    } });
    if (!viewer) throw new ProfileError(404, 'profile_not_found', 'Complete your profile before using Match.');
    if (!viewer.isComplete || !viewer.visibleInMatch) {
      throw new ProfileError(403, 'match_not_available', 'Join the Match pool before browsing candidates.');
    }
    const selectedGender = query.gender ?? viewer.matchPrefGender;
    const selectedDistance = query.maxDistanceKm === undefined ? viewer.matchPrefDistanceKm : query.maxDistanceKm;
    const selectedSports = query.sport ?? viewer.matchPrefSports;
    const context = createHash('sha256').update(JSON.stringify([
      userId, viewer.cityLatitude?.toString() ?? null, viewer.cityLongitude?.toString() ?? null,
      selectedGender, selectedDistance, selectedSports,
    ])).digest('hex');
    const cursor = query.cursor === undefined ? null : this.decodeCursor(query.cursor, context);
    const cursorDistance = cursor?.distance === null ? null : cursor?.distance?.toString();
    const cursorCondition = cursor === null ? Prisma.sql`TRUE` : cursorDistance === null ? Prisma.sql`
      c.distance IS NULL AND (
        cardinality(c."commonSports") < ${cursor.commonSports} OR
        (cardinality(c."commonSports") = ${cursor.commonSports} AND c."updatedAt" < ${cursor.updatedAt}::timestamp) OR
        (cardinality(c."commonSports") = ${cursor.commonSports} AND c."updatedAt" = ${cursor.updatedAt}::timestamp AND c.id > ${cursor.id}::uuid)
      )
    ` : Prisma.sql`
      (
        c.distance IS NULL OR
        c.distance < ${cursorDistance}::double precision OR
        (c.distance = ${cursorDistance}::double precision AND cardinality(c."commonSports") < ${cursor.commonSports}) OR
        (c.distance = ${cursorDistance}::double precision AND cardinality(c."commonSports") = ${cursor.commonSports} AND c."updatedAt" < ${cursor.updatedAt}::timestamp) OR
        (c.distance = ${cursorDistance}::double precision AND cardinality(c."commonSports") = ${cursor.commonSports} AND c."updatedAt" = ${cursor.updatedAt}::timestamp AND c.id > ${cursor.id}::uuid)
      )
    `;
    const sportFilter = selectedSports.length === 0 ? Prisma.empty : Prisma.sql`AND EXISTS (
      SELECT 1 FROM user_sports us WHERE us.user_id = p.user_id AND us.sport = ANY(${selectedSports}::text[])
    )`;
    const distanceExpression = viewer.cityLatitude === null || viewer.cityLongitude === null
      ? Prisma.sql`NULL::double precision`
      : Prisma.sql`6371.0088 * 2 * asin(sqrt(LEAST(1.0, GREATEST(0.0,
          power(sin(radians(p.city_latitude::double precision - ${Number(viewer.cityLatitude)}) / 2), 2)
          + cos(radians(${Number(viewer.cityLatitude)})) * cos(radians(p.city_latitude::double precision))
          * power(sin(radians(p.city_longitude::double precision - ${Number(viewer.cityLongitude)}) / 2), 2)
        ))))`;
    const candidateQuery = Prisma.sql`
      WITH candidates AS (
        SELECT p.user_id AS id, p.display_name AS "displayName", p.photo_key AS "photoKey",
          COALESCE(ARRAY(SELECT pp.object_key FROM profile_photos pp WHERE pp.user_id = p.user_id ORDER BY pp.sort_order), ARRAY[]::text[]) AS "photoKeys",
          p.city_name AS "cityName", p.region_code AS "regionCode", p.country_code AS "countryCode",
          p.updated_at AS "updatedAt", ${distanceExpression} AS distance,
          COALESCE(ARRAY(SELECT us.sport FROM user_sports us
            WHERE us.user_id = p.user_id AND us.sport = ANY(${selectedSports}::text[]) ORDER BY us.sport), ARRAY[]::text[]) AS "commonSports"
        FROM profiles p JOIN users u ON u.id = p.user_id
        WHERE p.user_id <> ${userId}::uuid AND u.status = 'ACTIVE' AND p.is_complete AND p.visible_in_match
          AND p.display_name IS NOT NULL AND btrim(p.display_name) <> ''
          AND (${selectedGender} = 'all' OR p.gender = ${selectedGender})
          AND ${noBlockSQL(userId, Prisma.sql`p.user_id`)}
          AND NOT EXISTS (SELECT 1 FROM swipes s WHERE s.actor_id = ${userId}::uuid AND s.target_id = p.user_id)
          AND (${selectedDistance === null || viewer.cityLatitude === null || viewer.cityLongitude === null ? Prisma.sql`TRUE` : Prisma.sql`(${distanceExpression}) <= ${selectedDistance}::double precision`})
          ${sportFilter}
      )
      SELECT c.id, c."displayName", c."photoKey", c."photoKeys", c."cityName", c."regionCode", c."countryCode", c.distance,
        c."commonSports", to_char(c."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt",
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('sport', us.sport, 'paceValue', us.pace_value::double precision, 'paceUnit', us.pace_unit)), '[]'::jsonb)
          FROM user_sports us WHERE us.user_id = c.id) AS sports
      FROM candidates c
      WHERE ${cursorCondition}
      ORDER BY c.distance ASC NULLS LAST, cardinality(c."commonSports") DESC, c."updatedAt" DESC, c.id ASC
      LIMIT ${query.limit + 1}
      `;
    const rows = await this.client.$queryRaw<CandidateRow[]>(candidateQuery);
    const visible = rows.slice(0, query.limit);
    const last = visible.at(-1);
    return { users: visible.map(row => this.toCandidate(row, selectedSports)), nextCursor: rows.length > query.limit && last ? this.encodeCursor({
      version: 1, context, distance: last.distance, commonSports: last.commonSports.length,
      updatedAt: last.updatedAt, id: last.id,
    }) : null };
  }

  async swipe(userId: string, targetId: string, direction: 'like' | 'pass'): Promise<SwipeResult> {
    if (userId === targetId) throw new ProfileError(422, 'invalid_match_target', 'You cannot Match with yourself.');
    return this.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${[userId, targetId].sort().join(':')}, 0))`;
      const actor = await tx.profile.findFirst({ where: { userId, isComplete: true, visibleInMatch: true, user: { status: 'ACTIVE' } }, select: { userId: true } });
      if (!actor) throw new ProfileError(403, 'match_not_available', 'Join the Match pool before sending Likes or Passes.');
      const target = await tx.profile.findFirst({ where: { userId: targetId, isComplete: true, visibleInMatch: true, user: { status: 'ACTIVE' } }, select: { userId: true } });
      if (!target) throw new ProfileError(404, 'match_target_unavailable', 'This Match candidate is no longer available.');
      const blocked = await tx.block.findFirst({ where: { OR: [{ blockerId: userId, blockedId: targetId }, { blockerId: targetId, blockedId: userId }] } });
      if (blocked) throw new ProfileError(403, 'match_blocked', 'This Match candidate is unavailable.');
      const existing = await tx.swipe.findUnique({ where: { actorId_targetId: { actorId: userId, targetId } } });
      const nextDirection = direction === 'like' ? 'LIKE' : 'PASS';
      if (existing?.direction === nextDirection) {
        const activeMatch = await this.activeMatch(tx, userId, targetId);
        if (direction === 'like' && activeMatch === null) {
          const lowerUserId = userId < targetId ? userId : targetId;
          const higherUserId = userId < targetId ? targetId : userId;
          const previous = await tx.match.findUnique({ where: { lowerUserId_higherUserId: { lowerUserId, higherUserId } }, select: { id: true, unmatchedAt: true } });
          if (previous?.unmatchedAt) {
            await tx.match.update({ where: { id: previous.id }, data: { unmatchedBy: null, unmatchedAt: null, matchedAt: new Date() } });
            return this.swipeResult(direction, previous.id);
          }
        }
        return this.swipeResult(direction, activeMatch);
      }
      if (direction === 'like') {
        const likesToday = await tx.swipe.count({ where: { actorId: userId, direction: 'LIKE', createdAt: { gte: utcDayStart() } } });
        if (likesToday >= 15) throw new ProfileError(429, 'daily_like_limit', 'You have used today’s 15 Like limit. Try again after 00:00 UTC.');
      }
      await tx.swipe.upsert({ where: { actorId_targetId: { actorId: userId, targetId } }, update: { direction: nextDirection }, create: { actorId: userId, targetId, direction: nextDirection } });
      if (direction === 'pass') return this.swipeResult(direction, null);
      const reciprocal = await tx.swipe.findUnique({ where: { actorId_targetId: { actorId: targetId, targetId: userId } } });
      if (reciprocal?.direction !== 'LIKE') return this.swipeResult(direction, null);
      const lowerUserId = userId < targetId ? userId : targetId;
      const higherUserId = userId < targetId ? targetId : userId;
      const previous = await tx.match.findUnique({ where: { lowerUserId_higherUserId: { lowerUserId, higherUserId } } });
      if (previous?.unmatchedAt) {
        const restored = await tx.match.update({ where: { id: previous.id }, data: { unmatchedBy: null, unmatchedAt: null, matchedAt: new Date() } });
        return this.swipeResult(direction, restored.id);
      }
      const match = previous ?? await tx.match.create({ data: { lowerUserId, higherUserId } });
      return this.swipeResult(direction, match.id);
    }, { timeout: 15_000 });
  }

  async list(userId: string): Promise<MatchSummary[]> {
    const matches = await this.client.match.findMany({ where: { OR: [{ lowerUserId: userId }, { higherUserId: userId }], unmatchedAt: null }, orderBy: { matchedAt: 'desc' } });
    const otherIDs = matches.map(match => match.lowerUserId === userId ? match.higherUserId : match.lowerUserId);
    const profiles = await this.client.profile.findMany({ where: { userId: { in: otherIDs } }, include: { photos: { orderBy: { sortOrder: 'asc' } }, user: { select: { status: true, sports: true } } } });
    const byID = new Map(profiles.map(profile => [profile.userId, profile]));
    return matches.flatMap(match => {
      const profile = byID.get(match.lowerUserId === userId ? match.higherUserId : match.lowerUserId);
      if (!profile || profile.user.status !== 'ACTIVE') return [];
      return [{ id: match.id, matchedAt: match.matchedAt.toISOString(), user: this.toCandidate({
        id: profile.userId, displayName: profile.displayName ?? 'Lauver member', photoKey: profile.photoKey,
        photoKeys: profile.photos.map(photo => photo.objectKey),
        cityName: profile.cityName, regionCode: profile.regionCode, countryCode: profile.countryCode,
        distance: null, commonSports: [], updatedAt: profile.updatedAt.toISOString(),
        sports: profile.user.sports.map(sport => ({ sport: sport.sport, paceValue: sport.paceValue === null ? null : Number(sport.paceValue), paceUnit: sport.paceUnit })),
      }, []) }];
    });
  }

  async unmatch(userId: string, matchId: string): Promise<void> {
    const match = await this.client.match.findUnique({ where: { id: matchId } });
    if (!match || (match.lowerUserId !== userId && match.higherUserId !== userId)) throw new ProfileError(404, 'match_not_found', 'Match not found.');
    if (match.unmatchedAt) return;
    await this.client.match.update({ where: { id: matchId }, data: { unmatchedBy: userId, unmatchedAt: new Date() } });
  }

  private toPreferences(profile: { visibleInMatch: boolean; gender: string | null; matchPrefGender: string; matchPrefDistanceKm: number | null; matchPrefSports: string[] }): MatchPreferences {
    return { visibleInMatch: profile.visibleInMatch, gender: profile.gender as MatchPreferences['gender'], preferredGender: profile.matchPrefGender as MatchPreferences['preferredGender'], maxDistanceKm: profile.matchPrefDistanceKm, sports: profile.matchPrefSports };
  }

  private toCandidate(row: CandidateRow, selectedSports: string[]): MatchCandidate {
    const photos = row.photoKeys.map((objectKey, index) => ({
      id: `${row.id}-photo-${index}`,
      url: this.storage.publicURL(objectKey),
      sortOrder: index,
      isPrimary: index === 0,
    }));
    return { id: row.id, displayName: row.displayName, photoURL: row.photoKey === null ? null : this.storage.publicURL(row.photoKey), photos, city: row.cityName === null || row.countryCode === null ? null : { name: row.cityName, regionCode: row.regionCode, countryCode: row.countryCode }, approximateDistanceKm: row.distance === null ? null : Math.round(row.distance), sports: row.sports, commonSports: row.commonSports.filter(sport => selectedSports.includes(sport)) };
  }

  private swipeResult(direction: 'like' | 'pass', matchId: string | null): SwipeResult { return { direction, matched: matchId !== null, matchId }; }

  private async activeMatch(tx: Prisma.TransactionClient, userId: string, targetId: string): Promise<string | null> {
    const lowerUserId = userId < targetId ? userId : targetId;
    const higherUserId = userId < targetId ? targetId : userId;
    const match = await tx.match.findUnique({ where: { lowerUserId_higherUserId: { lowerUserId, higherUserId } }, select: { id: true, unmatchedAt: true } });
    return match?.unmatchedAt ? null : match?.id ?? null;
  }

  private encodeCursor(cursor: CandidateCursor): string {
    const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url');
    const signature = createHmac('sha256', this.cursorSecret).update(`match:v1:${payload}`).digest('base64url');
    return `${payload}.${signature}`;
  }

  private decodeCursor(value: string, context: string): CandidateCursor {
    try {
      const [payload, signature] = value.split('.');
      if (!payload || !signature) throw new Error('Malformed cursor');
      const supplied = Buffer.from(signature, 'base64url');
      const expected = createHmac('sha256', this.cursorSecret).update(`match:v1:${payload}`).digest();
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('Invalid signature');
      const cursor = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as CandidateCursor;
      if (cursor.version !== 1 || cursor.context !== context) throw new Error('Changed context');
      return cursor;
    } catch { throw new ProfileError(422, 'invalid_match_cursor', 'The Match filters changed. Refresh the candidates.'); }
  }
}

export function installMatchRoutes(app: Express, dependencies: { authService: AuthServicing; matchService: MatchService }): void {
  app.get('/v1/match/preferences', authenticated(dependencies.authService, async (user, _request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({ preferences: await dependencies.matchService.preferences(user.id) });
  }));
  app.patch('/v1/match/preferences', authenticated(dependencies.authService, async (user, request, response) => {
    const body = preferenceSchema.safeParse(request.body);
    if (!body.success) { validationResponse(response); return; }
    response.status(200).json({ preferences: await dependencies.matchService.updatePreferences(user.id, body.data) });
  }));
  app.get('/v1/match/candidates', authenticated(dependencies.authService, async (user, request, response) => {
    const query = candidateQuerySchema.safeParse(request.query);
    if (!query.success) { validationResponse(response); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json(await dependencies.matchService.candidates(user.id, query.data));
  }));
  app.post('/v1/match/swipes', authenticated(dependencies.authService, async (user, request, response) => {
    const body = swipeSchema.safeParse(request.body);
    if (!body.success) { validationResponse(response); return; }
    response.status(200).json(await dependencies.matchService.swipe(user.id, body.data.targetUserId, body.data.direction));
  }));
  app.get('/v1/matches', authenticated(dependencies.authService, async (user, _request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({ matches: await dependencies.matchService.list(user.id) });
  }));
  app.post('/v1/matches/:matchId/unmatch', authenticated(dependencies.authService, async (user, request, response) => {
    const matchId = z.uuid().safeParse(request.params.matchId);
    if (!matchId.success) { validationResponse(response); return; }
    await dependencies.matchService.unmatch(user.id, matchId.data);
    response.status(204).send();
  }));
}

function validationResponse(response: Response): void {
  response.status(422).json({ code: 'validation_failed', message: 'The Match request could not be validated.', requestId: response.getHeader('x-request-id') });
}

function utcDayStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
