import { createHash } from 'node:crypto';
import type { Express } from 'express';
import { StreamChat } from 'stream-chat';
import { z } from 'zod';
import type { AuthServicing } from './auth.js';
import { authenticated } from './profile-routes.js';
import { ProfileError } from './profile.js';
import type { PrismaClient } from '@prisma/client';

const targetSchema = z.object({ targetUserId: z.uuid() }).strict();

export class StreamService {
  private readonly client: ReturnType<typeof StreamChat.getInstance>;
  constructor(private readonly database: PrismaClient, readonly apiKey: string, apiSecret: string, private readonly tokenTTLSeconds: number) {
    this.client = StreamChat.getInstance(apiKey, apiSecret);
  }

  async token(userId: string, displayName?: string | null): Promise<{ token: string; expiresAt: string }> {
    await this.client.upsertUsers([{ id: userId, ...(displayName ? { name: displayName } : {}) }]);
    const expiresAt = Math.floor(Date.now() / 1000) + this.tokenTTLSeconds;
    return { token: this.client.createToken(userId, expiresAt), expiresAt: new Date(expiresAt * 1000).toISOString() };
  }

  async direct(userId: string, targetUserId: string): Promise<{ channelType: 'messaging'; channelId: string; members: string[] }> {
    if (userId === targetUserId) throw new ProfileError(422, 'invalid_chat_target', 'You cannot message yourself.');
    const users = await this.database.user.findMany({ where: { id: { in: [userId, targetUserId] }, status: 'ACTIVE' }, select: { id: true } });
    if (users.length !== 2) throw new ProfileError(404, 'user_not_found', 'User not found.');
    const blocked = await this.database.block.findFirst({ where: { OR: [{ blockerId: userId, blockedId: targetUserId }, { blockerId: targetUserId, blockedId: userId }] }, select: { blockerId: true } });
    if (blocked) throw new ProfileError(403, 'chat_blocked', 'This conversation is unavailable.');
    const members = [userId, targetUserId].sort();
    const channelId = `dm-${createHash('sha256').update(members.join(':')).digest('hex').slice(0, 40)}`;
    const channel = this.client.channel('messaging', channelId, { members });
    await channel.create({ created_by_id: userId });
    return { channelType: 'messaging', channelId, members };
  }
}

export function installStreamRoutes(app: Express, dependencies: { authService: AuthServicing; service: StreamService }): void {
  app.post('/v1/chat/token', authenticated(dependencies.authService, async (user, _request, response) => {
    response.status(200).json({ apiKey: dependencies.service.apiKey, userId: user.id, ...(await dependencies.service.token(user.id)) });
  }));
  app.post('/v1/chat/direct', authenticated(dependencies.authService, async (user, request, response) => {
    const parsed = targetSchema.safeParse(request.body);
    if (!parsed.success) throw new ProfileError(422, 'validation_failed', 'Choose a valid chat participant.');
    response.status(200).json(await dependencies.service.direct(user.id, parsed.data.targetUserId));
  }));
}
