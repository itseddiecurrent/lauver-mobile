import type { Express } from 'express';
import { type Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AuthServicing } from './auth.js';
import { authenticated } from './profile-routes.js';

export const eventSports = ['running', 'trail_running', 'cycling', 'swimming', 'walking', 'hiking', 'rowing'] as const;
const idSchema = z.uuid();
const createSchema = z.object({
  title: z.string().trim().min(1).max(120), description: z.string().trim().max(2000).nullable().optional(),
  sport: z.enum(eventSports), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(),
  capacity: z.number().int().min(2).max(1000), venueName: z.string().trim().min(1).max(200),
  venueAddress: z.string().trim().max(500).nullable().optional(),
  venueLatitude: z.number().finite().min(-90).max(90), venueLongitude: z.number().finite().min(-180).max(180),
}).strict();
const patchSchema = createSchema.partial().strict();
const listSchema = z.object({ sport: z.enum(eventSports).optional(), from: z.iso.datetime().optional(), city: z.string().trim().min(1).max(120).optional(), radius: z.coerce.number().int().min(1).max(500).optional(), limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().min(1).max(200).optional() }).strict();

export class EventError extends Error {
  constructor(readonly statusCode: number, readonly code: string, readonly publicMessage: string) { super(publicMessage); this.name = 'EventError'; }
}
type Input = z.infer<typeof createSchema>;
type EventRow = Prisma.EventGetPayload<{ include: { attendees: true; creator: { include: { profile: true } } } }>;

export class EventService {
  constructor(private readonly client: PrismaClient) {}

  async list(query: z.infer<typeof listSchema>, viewerId?: string) {
    const where: Prisma.EventWhereInput = { status: 'UPCOMING', startsAt: { gte: query.from ? new Date(query.from) : new Date() }, ...(query.sport ? { sport: query.sport } : {}), ...(query.city ? { venueName: { contains: query.city, mode: 'insensitive' } } : {}) };
    let rows = await this.client.event.findMany({ where, include: { attendees: true, creator: { include: { profile: true } } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: query.radius ? 500 : query.limit + 1, ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}) });
    if (query.radius !== undefined && viewerId) {
      const origin = await this.client.profile.findUnique({ where: { userId: viewerId }, select: { cityLatitude: true, cityLongitude: true } });
      if (origin?.cityLatitude != null && origin.cityLongitude != null) {
        const lat = Number(origin.cityLatitude), lon = Number(origin.cityLongitude);
        rows = rows.filter((event) => {
          const p = Math.PI / 180, a = 0.5 - Math.cos((Number(event.venueLatitude) - lat) * p) / 2 + Math.cos(lat * p) * Math.cos(Number(event.venueLatitude) * p) * (1 - Math.cos((Number(event.venueLongitude) - lon) * p)) / 2;
          return 12742 * Math.asin(Math.sqrt(a)) <= query.radius!;
        });
      }
      rows = rows.slice(0, query.limit + 1);
    }
    const next = rows.length > query.limit ? rows[query.limit - 1]?.id ?? null : null;
    return { events: rows.slice(0, query.limit).map((row) => this.response(row, viewerId)), nextCursor: next };
  }

  async get(id: string, viewerId?: string) { const row = await this.client.event.findUnique({ where: { id }, include: { attendees: true, creator: { include: { profile: true } } } }); if (!row) throw new EventError(404, 'event_not_found', 'Event not found'); return this.response(row, viewerId); }

  async create(userId: string, input: Input) {
    this.validateTimes(input);
    const row = await this.client.$transaction(async (tx) => {
      const event = await tx.event.create({ data: { creatorId: userId, title: input.title, description: input.description ?? null, sport: input.sport, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), capacity: input.capacity, venueName: input.venueName, venueAddress: input.venueAddress ?? null, venueLatitude: input.venueLatitude, venueLongitude: input.venueLongitude } });
      await tx.eventAttendee.create({ data: { eventId: event.id, userId } });
      return tx.event.findUniqueOrThrow({ where: { id: event.id }, include: { attendees: true, creator: { include: { profile: true } } } });
    });
    return this.response(row, userId);
  }

  async update(userId: string, id: string, input: z.infer<typeof patchSchema>) {
    const row = await this.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${id}::uuid FOR UPDATE`;
      const existing = await tx.event.findUnique({ where: { id }, include: { attendees: true } });
      if (!existing) throw new EventError(404, 'event_not_found', 'Event not found');
      if (existing.creatorId !== userId) throw new EventError(403, 'event_forbidden', 'Only the event creator can edit this event');
      if (existing.status !== 'UPCOMING') throw new EventError(409, 'event_cancelled', 'Cancelled events cannot be edited');
      if (input.capacity !== undefined && input.capacity < existing.attendees.length) throw new EventError(409, 'capacity_below_attendance', 'Capacity cannot be lower than the current attendance');
      const startsAt = input.startsAt ? new Date(input.startsAt) : existing.startsAt;
      const endsAt = input.endsAt ? new Date(input.endsAt) : existing.endsAt;
      if (startsAt <= new Date() || endsAt <= startsAt) throw new EventError(422, 'invalid_event_time', 'Event times are invalid');
      return tx.event.update({ where: { id }, data: { ...input, startsAt, endsAt, description: input.description === undefined ? undefined : input.description, venueAddress: input.venueAddress === undefined ? undefined : input.venueAddress }, include: { attendees: true, creator: { include: { profile: true } } } });
    });
    return this.response(row, userId);
  }

  async cancel(userId: string, id: string) { const existing = await this.client.event.findUnique({ where: { id } }); if (!existing) throw new EventError(404, 'event_not_found', 'Event not found'); if (existing.creatorId !== userId) throw new EventError(403, 'event_forbidden', 'Only the event creator can cancel this event'); const row = await this.client.event.update({ where: { id }, data: { status: 'CANCELLED' }, include: { attendees: true, creator: { include: { profile: true } } } }); return this.response(row, userId); }

  async join(userId: string, id: string) {
    const row = await this.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${id}::uuid FOR UPDATE`;
      const event = await tx.event.findUnique({ where: { id }, include: { attendees: true, creator: { include: { profile: true } } } });
      if (!event) throw new EventError(404, 'event_not_found', 'Event not found');
      if (event.status !== 'UPCOMING') throw new EventError(409, 'event_cancelled', 'This event is cancelled');
      if (event.attendees.some((item) => item.userId === userId)) return event;
      if (event.attendees.length >= event.capacity) throw new EventError(409, 'event_full', 'This event is full');
      await tx.eventAttendee.create({ data: { eventId: id, userId } });
      return tx.event.findUniqueOrThrow({ where: { id }, include: { attendees: true, creator: { include: { profile: true } } } });
    });
    return this.response(row, userId);
  }

  async leave(userId: string, id: string) { const event = await this.client.event.findUnique({ where: { id } }); if (!event) throw new EventError(404, 'event_not_found', 'Event not found'); if (event.creatorId === userId) throw new EventError(409, 'creator_cannot_leave', 'The event creator cannot leave their event'); await this.client.eventAttendee.deleteMany({ where: { eventId: id, userId } }); return this.get(id, userId); }

  async report(userId: string, id: string, reason: string, details: string | undefined, requestId: string, targetType: 'event' | 'user' = 'event') {
    const event = await this.client.event.findUnique({ where: { id }, include: { attendees: true, creator: { include: { profile: true } } } });
    if (!event) throw new EventError(404, 'event_not_found', 'Event not found');
    if (event.creatorId === userId) throw new EventError(422, 'self_report', 'You cannot report your own event or yourself');
    const snapshot = { id: event.id, title: event.title, sport: event.sport, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(), capacity: event.capacity, venue: { name: event.venueName, address: event.venueAddress, latitude: Number(event.venueLatitude), longitude: Number(event.venueLongitude) }, creator: { id: event.creatorId, displayName: event.creator.profile?.displayName ?? 'Lauver member' } } satisfies Prisma.InputJsonObject;
    const report = await this.client.$transaction(async (tx) => {
      const saved = await tx.report.create({ data: { reporterId: userId, targetUserId: event.creatorId, targetType, source: 'event', reason, details: details ?? null, snapshot, requestId } });
      await tx.safetyAuditEvent.create({ data: { actorId: userId, targetId: event.creatorId, action: 'report', requestId, reportId: saved.id } });
      return saved;
    });
    return { referenceId: report.id };
  }

  private validateTimes(input: Input) { const starts = new Date(input.startsAt), ends = new Date(input.endsAt); if (starts <= new Date() || ends <= starts) throw new EventError(422, 'invalid_event_time', 'Event times are invalid'); }
  private response(row: EventRow, viewerId?: string) { return { id: row.id, title: row.title, description: row.description, sport: row.sport, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), capacity: row.capacity, venue: { name: row.venueName, address: row.venueAddress, latitude: Number(row.venueLatitude), longitude: Number(row.venueLongitude) }, status: row.status.toLowerCase(), creator: { id: row.creatorId, displayName: row.creator.profile?.displayName ?? 'Lauver member' }, attendeeCount: row.attendees.length, isAttendee: viewerId === undefined ? undefined : row.attendees.some((item) => item.userId === viewerId), isCreator: viewerId === undefined ? undefined : row.creatorId === viewerId }; }
}

export function installEventRoutes(app: Express, authService: AuthServicing, service: EventService): void {
  function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new EventError(422, 'validation_failed', 'The request could not be validated');
    return result.data;
  }
  app.get('/v1/events', authenticated(authService, async (user, request, response) => { const parsed = listSchema.safeParse(request.query); if (!parsed.success) { response.status(422).json({ code: 'validation_failed', message: 'The request could not be validated', requestId: response.getHeader('x-request-id') }); return; } response.status(200).json(await service.list(parsed.data, user.id)); }));
  app.get('/v1/events/:eventId', authenticated(authService, async (user, request, response) => { const id = idSchema.safeParse(request.params.eventId); if (!id.success) throw new EventError(422, 'validation_failed', 'Invalid event ID'); response.status(200).json({ event: await service.get(id.data, user.id) }); }));
  app.post('/v1/events', authenticated(authService, async (user, request, response) => { const body = createSchema.safeParse(request.body); if (!body.success) throw new EventError(422, 'validation_failed', 'The request could not be validated'); response.status(201).json({ event: await service.create(user.id, body.data) }); }));
  app.patch('/v1/events/:eventId', authenticated(authService, async (user, request, response) => { const id = parse(idSchema, request.params.eventId); const body = parse(patchSchema, request.body); response.status(200).json({ event: await service.update(user.id, id, body) }); }));
  app.post('/v1/events/:eventId/cancel', authenticated(authService, async (user, request, response) => { response.status(200).json({ event: await service.cancel(user.id, parse(idSchema, request.params.eventId)) }); }));
  app.post('/v1/events/:eventId/join', authenticated(authService, async (user, request, response) => { response.status(200).json({ event: await service.join(user.id, parse(idSchema, request.params.eventId)) }); }));
  app.delete('/v1/events/:eventId/join', authenticated(authService, async (user, request, response) => { response.status(200).json({ event: await service.leave(user.id, parse(idSchema, request.params.eventId)) }); }));
  app.post('/v1/events/:eventId/report', authenticated(authService, async (user, request, response) => {
    const id = parse(idSchema, request.params.eventId);
    const body = parse(z.object({ reason: z.enum(['spam', 'harassment', 'hate_abuse', 'unsafe_event', 'impersonation', 'other']), details: z.string().trim().max(2000).optional(), targetType: z.enum(['event', 'user']).default('event') }).strict(), request.body);
    response.status(201).json(await service.report(user.id, id, body.reason, body.details, String(response.getHeader('x-request-id')), body.targetType));
  }));
}
