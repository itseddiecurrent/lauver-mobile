import { createHash } from 'node:crypto';
import type { Express } from 'express';
import { StreamChat } from 'stream-chat';
import { z } from 'zod';
import type { AuthServicing } from './auth.js';
import { authenticated } from './profile-routes.js';
import { ProfileError } from './profile.js';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { SafetyServicing } from './safety.js';

export const chatPairKey = (a: string, b: string) => [a, b].sort().join(':');
export const chatChannelId = (a: string, b: string) => `dm-${createHash('sha256').update(chatPairKey(a, b)).digest('hex').slice(0, 40)}`;
const sendSchema = z.object({ id: z.uuid(), text: z.string().trim().min(1).max(2000) }).strict();
const targetSchema = z.object({ targetUserId: z.uuid().transform(id => id.toLowerCase()) }).strict();
const messageReportSchema = z.object({ reason: z.enum(['spam', 'harassment', 'hate_abuse', 'unsafe_event', 'impersonation', 'other']), details: z.string().trim().max(2000).optional() }).strict();

export class StreamService {
  private readonly client: ReturnType<typeof StreamChat.getInstance>;
  constructor(private readonly database: PrismaClient, readonly apiKey: string, apiSecret: string, private readonly tokenTTLSeconds: number) {
    this.client = new StreamChat(apiKey, apiSecret);
  }

  private ready?: Promise<void>;
  private ensurePermissions(): Promise<void> {
    if (!this.ready) this.ready = (async () => {
      await this.client.updateAppSettings({ disable_auth_checks: false, disable_permissions_checks: false });
      await this.client.updateChannelType('messaging', {
        grants: { user: [], guest: [], anonymous: [], channel_member: ['read-channel', 'read-channel-members', 'send-message'] },
        commands: [], reactions: false, replies: false, quotes: false, uploads: false, polls: false,
        typing_events: false, read_events: true, max_message_length: 2000,
      });
    })().catch(() => {
      this.ready = undefined;
      throw new ProfileError(503, 'chat_unavailable', 'Chat is temporarily unavailable. Please try again.');
    });
    return this.ready;
  }

  async token(userId: string, displayName?: string | null): Promise<{ token: string; expiresAt: string }> {
    await this.ensurePermissions();
    const profile = await this.database.profile.findUnique({ where: { userId }, select: { displayName: true } });
    await this.client.upsertUsers([{ id: userId, name: displayName ?? profile?.displayName ?? 'Lauver member', role: 'user' }]);
    const expiresAt = Math.floor(Date.now() / 1000) + this.tokenTTLSeconds;
    return { token: this.client.createToken(userId, expiresAt), expiresAt: new Date(expiresAt * 1000).toISOString() };
  }

  async direct(userId: string, targetUserId: string): Promise<{ channelType: 'messaging'; channelId: string; members: string[] }> {
    await this.ensurePermissions();
    if (userId === targetUserId) throw new ProfileError(422, 'invalid_chat_target', 'You cannot message yourself.');
    return this.database.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chatPairKey(userId, targetUserId)}, 0))`;
      await this.checkPair(tx, userId, targetUserId);
      const users = await tx.user.findMany({ where: { id: { in: [userId, targetUserId] }, status: 'ACTIVE' }, select: { id: true, profile: { select: { displayName: true } } } });
      const members = [userId, targetUserId].sort();
      const channelId = chatChannelId(userId, targetUserId);
      try {
        await this.client.upsertUsers(users.map(user => ({ id: user.id, name: user.profile?.displayName ?? 'Lauver member', role: 'user' })));
        const channel = this.client.channel('messaging', channelId, { members, created_by_id: userId });
        await channel.create();
      } catch {
        throw new ProfileError(503, 'chat_unavailable', 'Chat is temporarily unavailable. Please try again.');
      }
      return { channelType: 'messaging' as const, channelId, members };
    }, { timeout: 15000 });
  }

  private async checkPair(tx: Prisma.TransactionClient, userId: string, targetUserId: string) {
    if (await tx.user.count({ where: { id: { in: [userId, targetUserId] }, status: 'ACTIVE' } }) !== 2)
      throw new ProfileError(404, 'user_not_found', 'User not found.');
    const blocked = await tx.block.findFirst({ where: { OR: [{ blockerId: userId, blockedId: targetUserId }, { blockerId: targetUserId, blockedId: userId }] }, select: { blockerId: true } });
    if (blocked) throw new ProfileError(403, 'chat_blocked', 'This conversation is unavailable.');
  }

  async send(userId: string, channelId: string, input: z.infer<typeof sendSchema>) {
    await this.ensurePermissions();
    const channel = this.client.channel('messaging', channelId);
    const { members } = await channel.queryMembers({}, {}, { limit: 3 });
    const ids = members.map(member => member.user_id ?? member.user?.id ?? '');
    if (ids.length !== 2 || !ids.includes(userId) || ids.some(id => !z.uuid().safeParse(id).success))
      throw new ProfileError(403, 'chat_forbidden', 'This conversation is unavailable.');
    const target = ids.find(id => id !== userId)!;
    if (chatChannelId(userId, target) !== channelId) throw new ProfileError(403, 'chat_forbidden', 'This conversation is unavailable.');
    return this.database.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chatPairKey(userId, target)}, 0))`;
      await this.checkPair(tx, userId, target);
      const id = createHash('sha256').update(`${userId}:${channelId}:${input.id}`).digest('hex');
      await channel.sendMessage({ id, text: input.text, user_id: userId });
      return { id };
    }, { timeout: 15000 });
  }

  async messageEvidence(userId: string, channelId: string, messageId: string) {
    await this.ensurePermissions();
    const channel = this.client.channel('messaging', channelId);
    const { members } = await channel.queryMembers({}, {}, { limit: 3 });
    const ids = members.map(member => member.user_id ?? member.user?.id ?? '');
    if (ids.length !== 2 || !ids.includes(userId) || chatChannelId(ids[0]!, ids[1]!) !== channelId) {
      throw new ProfileError(403, 'chat_forbidden', 'This conversation is unavailable.');
    }
    const message = await this.client.getMessage(messageId);
    if (message.message.cid !== `messaging:${channelId}` || !message.message.user?.id || message.message.user.id === userId) {
      throw new ProfileError(404, 'message_not_found', 'Message not found.');
    }
    return { targetUserId: message.message.user.id, messageId, messageText: message.message.text ?? '', messageSenderId: message.message.user.id };
  }

  async blockPair(userId: string, target: string) {
    const id = chatChannelId(userId, target);
    const channels = await this.client.queryChannels({ cid: `messaging:${id}` }, [], { limit: 1 });
    if (channels.length) await this.client.channel('messaging', id).removeMembers([userId, target]);
  }

}

export function installStreamRoutes(app: Express, dependencies: { authService: AuthServicing; service: StreamService; safetyService?: SafetyServicing }): void {
  app.post('/v1/chat/token', authenticated(dependencies.authService, async (user, request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (Object.keys(request.query).length || !z.object({}).strict().safeParse(request.body ?? {}).success) {
      throw new ProfileError(403, 'chat_token_owner', 'Chat tokens are issued only for the signed-in user.');
    }
    response.status(200).json({ apiKey: dependencies.service.apiKey, userId: user.id, ...(await dependencies.service.token(user.id)) });
  }));
  app.post('/v1/chat/channels/:channelId/messages', authenticated(dependencies.authService, async (user, request, response) => {
    const parsed = sendSchema.safeParse(request.body);
    const channelId = z.string().regex(/^dm-[a-f0-9]{40}$/).safeParse(request.params.channelId);
    if (!parsed.success || !channelId.success) throw new ProfileError(422, 'validation_failed', 'Enter a message of at most 2000 characters.');
    response.status(200).json(await dependencies.service.send(user.id, channelId.data, parsed.data));
  }));
  app.post('/v1/chat/direct', authenticated(dependencies.authService, async (user, request, response) => {
    const parsed = targetSchema.safeParse(request.body);
    if (!parsed.success) throw new ProfileError(422, 'validation_failed', 'Choose a valid chat participant.');
    response.status(200).json(await dependencies.service.direct(user.id, parsed.data.targetUserId));
  }));
  app.post('/v1/chat/channels/:channelId/messages/:messageId/report', authenticated(dependencies.authService, async (user, request, response) => {
    const channelId = z.string().regex(/^dm-[a-f0-9]{40}$/).safeParse(request.params.channelId);
    const messageId = z.string().min(1).max(128).safeParse(request.params.messageId);
    const input = messageReportSchema.safeParse(request.body);
    if (!channelId.success || !messageId.success || !input.success) throw new ProfileError(422, 'validation_failed', 'Choose a valid message report and note.');
    if (!dependencies.safetyService?.reportChatMessage) throw new ProfileError(503, 'chat_unavailable', 'Chat reporting is unavailable.');
    const evidence = await dependencies.service.messageEvidence(user.id, channelId.data, messageId.data);
    response.status(201).json(await dependencies.safetyService.reportChatMessage(user.id, evidence.targetUserId, channelId.data,
      evidence.messageId, evidence.messageText, evidence.messageSenderId, input.data.reason, input.data.details,
      String(response.getHeader('x-request-id'))));
  }));
}
