import type { Prisma, PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import { z } from 'zod';
import type { AuthServicing } from './auth.js';
import { chatPairKey } from './stream.js';
import { ProfileError } from './profile.js';
import { type InMemoryRateLimiter, RateLimitExceededError } from './rate-limiter.js';

export const reportReasons = ['spam', 'harassment', 'hate_abuse', 'unsafe_event', 'impersonation', 'other'] as const;
export const reportSchema = z.object({
  targetType: z.literal('user'), targetId: z.uuid().transform(id => id.toLowerCase()), reason: z.enum(reportReasons),
  details: z.string().trim().max(2000).optional(), blockUser: z.boolean().default(false),
}).strict();
export type ReportInput = z.infer<typeof reportSchema>;
export type BlockedUser = { id: string; displayName: string | null; cityName: string | null };
export type BlockedPage = { users: BlockedUser[]; nextCursor: string | null };
export interface SafetyServicing {
  block(actorId: string, targetId: string, requestId: string): Promise<void>;
  unblock(actorId: string, targetId: string, requestId: string): Promise<void>;
  blockedUsers(actorId: string, cursor?: string): Promise<BlockedPage>;
  report(actorId: string, input: ReportInput, requestId: string): Promise<{ referenceId: string; blockedUser: boolean }>;
  reportChatMessage?(actorId: string, targetUserId: string, channelId: string, messageId: string,
    messageText: string, messageSenderId: string, reason: ReportInput['reason'], details: string | undefined,
    requestId: string): Promise<{ referenceId: string; blockedUser: boolean }>;
}

export class SafetyService implements SafetyServicing {
  onBlocking?: (actorId: string, targetId: string) => Promise<void>;
  constructor(private readonly client: PrismaClient) {}

  private async lockChat(tx: Prisma.TransactionClient, actorId: string, targetId: string) {
    if (this.onBlocking) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chatPairKey(actorId, targetId)}, 0))`;
      await this.onBlocking(actorId, targetId);
    }
  }

  private validatePair(actorId: string, targetId: string): void {
    if (actorId.toLowerCase() === targetId.toLowerCase()) throw new ProfileError(422, 'invalid_safety_target', 'You cannot report or block yourself.');
  }

  async block(actorId: string, targetId: string, requestId: string): Promise<void> {
    this.validatePair(actorId, targetId);
    await this.client.$transaction(async (tx) => {
      await this.lockChat(tx, actorId, targetId);
      if (!await tx.user.findFirst({ where: { id: targetId, status: 'ACTIVE' }, select: { id: true } })) {
        throw new ProfileError(404, 'user_not_found', 'User not found.');
      }
      await tx.block.upsert({ where: { blockerId_blockedId: { blockerId: actorId, blockedId: targetId } },
        create: { blockerId: actorId, blockedId: targetId }, update: {} });
      await tx.safetyAuditEvent.create({ data: { actorId, targetId, action: 'block', requestId } });
    });
  }

  async unblock(actorId: string, targetId: string, requestId: string): Promise<void> {
    this.validatePair(actorId, targetId);
    await this.client.$transaction(async (tx) => {
      await tx.block.deleteMany({ where: { blockerId: actorId, blockedId: targetId } });
      const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true } });
      await tx.safetyAuditEvent.create({ data: { actorId, targetId: target?.id ?? null, action: 'unblock', requestId } });
    });
  }

  async blockedUsers(actorId: string, cursor?: string): Promise<BlockedPage> {
    const rows = await this.client.block.findMany({ where: { blockerId: actorId,
      ...(cursor ? { blockedId: { gt: cursor } } : {}) }, orderBy: { blockedId: 'asc' }, take: 51,
      include: { blocked: { select: { status: true, profile: { select: { displayName: true, cityName: true } } } } } });
    const users = rows.slice(0, 50).map(row => ({ id: row.blockedId,
      displayName: row.blocked.status === 'ACTIVE' ? row.blocked.profile?.displayName ?? null : null,
      cityName: row.blocked.status === 'ACTIVE' ? row.blocked.profile?.cityName ?? null : null }));
    return { users, nextCursor: rows.length > 50 ? users.at(-1)!.id : null };
  }

  async report(actorId: string, input: ReportInput, requestId: string): Promise<{ referenceId: string; blockedUser: boolean }> {
    this.validatePair(actorId, input.targetId);
    return this.client.$transaction(async tx => {
      if (input.blockUser) await this.lockChat(tx, actorId, input.targetId);
      const profile = await tx.profile.findFirst({ where: { userId: input.targetId, isComplete: true, user: { status: 'ACTIVE' } },
        select: { userId: true, displayName: true, bio: true, cityName: true, countryCode: true,
          user: { select: { sports: { select: { sport: true, paceValue: true, paceUnit: true }, orderBy: { sport: 'asc' } } } } } });
      if (!profile) throw new ProfileError(404, 'user_not_found', 'User not found.');
      const snapshot: Prisma.InputJsonObject = { id: profile.userId, displayName: profile.displayName,
        bio: profile.bio, city: { name: profile.cityName, countryCode: profile.countryCode },
        sports: profile.user.sports.map(s => ({ sport: s.sport, paceValue: s.paceValue?.toNumber() ?? null, paceUnit: s.paceUnit })) };
      const report = await tx.report.create({ data: { reporterId: actorId, targetUserId: input.targetId,
        targetType: 'user', source: 'profile', reason: input.reason, details: input.details ?? null, snapshot, requestId } });
      if (input.blockUser) await tx.block.upsert({ where: { blockerId_blockedId: { blockerId: actorId, blockedId: input.targetId } },
        create: { blockerId: actorId, blockedId: input.targetId }, update: {} });
      await tx.safetyAuditEvent.create({ data: { actorId, targetId: input.targetId,
        action: input.blockUser ? 'report_and_block' : 'report', requestId, reportId: report.id } });
      return { referenceId: report.id, blockedUser: input.blockUser };
    });
  }

  async reportChatMessage(actorId: string, targetUserId: string, channelId: string, messageId: string,
    messageText: string, messageSenderId: string, reason: ReportInput['reason'], details: string | undefined,
    requestId: string): Promise<{ referenceId: string; blockedUser: boolean }> {
    this.validatePair(actorId, targetUserId);
    if (messageSenderId !== targetUserId) throw new ProfileError(422, 'invalid_report_target', 'The message sender is not the reported user.');
    const profile = await this.client.profile.findFirst({ where: { userId: targetUserId, isComplete: true, user: { status: 'ACTIVE' } }, select: { userId: true } });
    if (!profile) throw new ProfileError(404, 'user_not_found', 'User not found.');
    const snapshot: Prisma.InputJsonObject = { channelId, messageId, senderId: messageSenderId, text: messageText.slice(0, 500) };
    const report = await this.client.report.create({ data: {
      reporterId: actorId, targetUserId, targetType: 'user', source: 'chat', reason,
      details: details ?? null, snapshot, requestId,
    } });
    await this.client.safetyAuditEvent.create({ data: { actorId, targetId: targetUserId, action: 'report_message', requestId, reportId: report.id } });
    return { referenceId: report.id, blockedUser: false };
  }
}

export function installSafetyRoutes(app: Express, dependencies: {
  authService: AuthServicing; safetyService: SafetyServicing; safetyRateLimiter: InMemoryRateLimiter;
}): void {
  const actor = async (authorization: string | undefined) => dependencies.authService.restore(
    authorization?.startsWith('Bearer ') ? authorization.slice(7) : '');
  const consume = (userId: string, ip: string | undefined, operation: string) => {
    try {
      dependencies.safetyRateLimiter.consume(`${operation}:user:${userId}`);
      dependencies.safetyRateLimiter.consume(`${operation}:ip:${ip}`);
    } catch (error) {
      if (error instanceof RateLimitExceededError) throw new ProfileError(429, 'rate_limited', 'Too many requests. Try again later.');
      throw error;
    }
  };
  const target = (id: unknown) => {
    const value = z.uuid().safeParse(id);
    if (!value.success) throw new ProfileError(422, 'validation_failed', 'Choose a valid user.');
    return value.data.toLowerCase();
  };
  const emptyBody = (body: unknown) => {
    if (body !== undefined && !z.object({}).strict().safeParse(body).success) {
      throw new ProfileError(422, 'validation_failed', 'Block requests accept no body fields.');
    }
  };
  app.get('/v1/blocks', async (request, response) => {
    const user = await actor(request.get('authorization'));
    const query = z.object({ cursor: z.uuid().optional() }).strict().safeParse(request.query);
    if (!query.success) throw new ProfileError(422, 'validation_failed', 'Invalid blocked users cursor.');
    response.setHeader('Cache-Control', 'no-store');
    response.json(await dependencies.safetyService.blockedUsers(user.id, query.data.cursor));
  });
  app.post('/v1/blocks/:userId', async (request, response) => {
    const user = await actor(request.get('authorization'));
    const id = target(request.params.userId);
    emptyBody(request.body);
    consume(user.id, request.ip, 'block');
    await dependencies.safetyService.block(user.id, id, String(response.getHeader('x-request-id')));
    response.status(204).send();
  });
  app.delete('/v1/blocks/:userId', async (request, response) => {
    const user = await actor(request.get('authorization'));
    const id = target(request.params.userId);
    emptyBody(request.body);
    consume(user.id, request.ip, 'unblock');
    await dependencies.safetyService.unblock(user.id, id, String(response.getHeader('x-request-id')));
    response.status(204).send();
  });
  app.post('/v1/reports', async (request, response) => {
    const user = await actor(request.get('authorization'));
    const input = reportSchema.safeParse(request.body);
    if (!input.success) throw new ProfileError(422, 'validation_failed', 'Choose a valid user, reason and a note of at most 2000 characters.');
    consume(user.id, request.ip, 'report');
    response.setHeader('Cache-Control', 'no-store');
    response.status(201).json(await dependencies.safetyService.report(user.id, input.data, String(response.getHeader('x-request-id'))));
  });
}
