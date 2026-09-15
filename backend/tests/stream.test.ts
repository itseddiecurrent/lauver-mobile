import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { createAuthServiceStub } from './helpers/test-app.js';

const sdk = vi.hoisted(() => ({ upsertUsers: vi.fn(), createToken: vi.fn(), channel: vi.fn(), create: vi.fn(), addMembers: vi.fn(), updateAppSettings: vi.fn(), updateChannelType: vi.fn(), queryMembers: vi.fn(), sendMessage: vi.fn(), getMessage: vi.fn() }));
vi.mock('stream-chat', () => ({ StreamChat: class {
  upsertUsers = sdk.upsertUsers;
  createToken = sdk.createToken;
  channel = sdk.channel;
  updateAppSettings = sdk.updateAppSettings;
  updateChannelType = sdk.updateChannelType;
  getMessage = sdk.getMessage;
} }));
import { StreamService, installStreamRoutes } from '../src/stream.js';
const a = 'e1800000-0000-4000-8000-000000000001';
const b = 'e1800000-0000-4000-8000-000000000002';
function fixture(blocked = false) {
  const database = { $executeRaw: vi.fn(), $queryRaw: vi.fn(), $transaction: vi.fn(), user: { count: vi.fn().mockResolvedValue(2), findMany: vi.fn().mockResolvedValue([{ id: a, profile: { displayName: 'A' } }, { id: b, profile: null }]) },
    profile: { findUnique: vi.fn().mockResolvedValue({ displayName: 'A' }) },
    block: { findFirst: vi.fn().mockResolvedValue(blocked ? { blockerId: b } : null) } };
  database.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(database));
  return { database, service: new StreamService(database as unknown as PrismaClient, 'key', 'secret', 900) };
}
beforeEach(() => { vi.clearAllMocks(); sdk.channel.mockReturnValue({ create: sdk.create, addMembers: sdk.addMembers, queryMembers: sdk.queryMembers, sendMessage: sdk.sendMessage }); sdk.create.mockResolvedValue({}); sdk.upsertUsers.mockResolvedValue({}); sdk.createToken.mockReturnValue('signed-token'); });
describe('Stream chat ownership and canonical channels', () => {
  it('syncs both members before creating the same channel for either direction', async () => {
    const { service } = fixture();
    const first = await service.direct(a, b), second = await service.direct(b, a);
    expect(first).toEqual(second);
    expect(first.channelId.length).toBeLessThanOrEqual(64);
    expect(sdk.upsertUsers).toHaveBeenCalledWith([{ id: a, name: 'A', role: 'user' }, { id: b, name: 'Lauver member', role: 'user' }]);
    expect(sdk.upsertUsers.mock.invocationCallOrder[0]).toBeLessThan(sdk.create.mock.invocationCallOrder[0]!);
  });
  it('rejects self and either-direction blocks before contacting Stream', async () => {
    const { service, database } = fixture(true);
    await expect(service.direct(a, a)).rejects.toMatchObject({ statusCode: 422 });
    await expect(service.direct(a, b)).rejects.toMatchObject({ statusCode: 403 });
    expect(database.block.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } }));
    expect(sdk.create).not.toHaveBeenCalled();
    expect(sdk.upsertUsers).not.toHaveBeenCalled();
  });
  it('allows only server-mediated sends and protects channel membership', async () => {
    const { service } = fixture();
    await service.token(a);
    expect(sdk.updateAppSettings).toHaveBeenCalledWith({ disable_auth_checks: false, disable_permissions_checks: false });
    expect(sdk.updateChannelType).toHaveBeenCalledWith('messaging', expect.objectContaining({ grants: { user: [], guest: [], anonymous: [], channel_member: ['read-channel', 'read-channel-members'] } }));
    sdk.queryMembers.mockResolvedValue({ members: [{ user_id: b }] });
    await expect(service.send(a, 'dm-' + 'a'.repeat(40), { id: a, text: 'hello' })).rejects.toMatchObject({ statusCode: 403 });
    expect(sdk.sendMessage).not.toHaveBeenCalled();
  });
  it('checks a new block on every send and gives retries the same message id', async () => {
    const { service, database } = fixture();
    const { channelId } = await service.direct(a, b);
    sdk.queryMembers.mockResolvedValue({ members: [{ user_id: a }, { user_id: b }] });
    const first = await service.send(a, channelId, { id: a, text: 'hello' });
    const second = await service.send(a, channelId, { id: a, text: 'hello' });
    expect(first).toEqual(second);
    database.block.findFirst.mockResolvedValue({ blockerId: b });
    await expect(service.send(a, channelId, { id: b, text: 'blocked' })).rejects.toMatchObject({ statusCode: 403 });
    expect(sdk.sendMessage).toHaveBeenCalledTimes(2);
  });
  it('rejects missing or inactive users', async () => {
    const { service, database } = fixture(); database.user.count.mockResolvedValue(1);
    await expect(service.direct(a, b)).rejects.toMatchObject({ statusCode: 404 });
    expect(sdk.create).not.toHaveBeenCalled();
  });
  it('recovers a duplicate send only when the stored message matches and still checks blocks', async () => {
    const { service, database } = fixture();
    const { channelId } = await service.direct(a, b);
    sdk.queryMembers.mockResolvedValue({ members: [{ user_id: a }, { user_id: b }] });
    sdk.sendMessage.mockRejectedValue(new Error('Message already exists'));
    sdk.getMessage.mockResolvedValue({ message: { cid: `messaging:${channelId}`, user: { id: a }, text: 'hello' } });
    const result = await service.send(a, channelId, { id: a, text: 'hello' });
    expect(sdk.getMessage).toHaveBeenCalledWith(result.id);
    await expect(service.send(a, channelId, { id: a, text: 'changed' })).rejects.toMatchObject({ statusCode: 409 });
    database.block.findFirst.mockResolvedValue({ blockerId: b });
    await expect(service.send(a, channelId, { id: a, text: 'hello' })).rejects.toMatchObject({ statusCode: 403 });
    expect(sdk.sendMessage).toHaveBeenCalledTimes(2);
    sdk.sendMessage.mockResolvedValue({});
  });
  it('returns a retryable error when a failed send cannot be verified in Stream', async () => {
    const { service } = fixture();
    const { channelId } = await service.direct(a, b);
    sdk.queryMembers.mockResolvedValue({ members: [{ user_id: a }, { user_id: b }] });
    sdk.sendMessage.mockRejectedValue(new Error('Provider unavailable'));
    sdk.getMessage.mockRejectedValue(new Error('Message not found'));
    await expect(service.send(a, channelId, { id: a, text: 'hello' })).rejects.toMatchObject({ statusCode: 503 });
    sdk.sendMessage.mockResolvedValue({});
  });
  it('signs an expiring token for the authenticated identity', async () => {
    const { service } = fixture(); const now = Math.floor(Date.now() / 1000);
    const result = await service.token(a);
    expect(sdk.createToken).toHaveBeenCalledWith(a, expect.any(Number));
    expect(Date.parse(result.expiresAt) / 1000).toBeGreaterThanOrEqual(now + 900);
    expect(Date.parse(result.expiresAt) / 1000).toBeLessThanOrEqual(now + 901);
  });
  it('only creates message evidence for a member message in the canonical channel', async () => {
    const { service } = fixture();
    const channelId = (await service.direct(a, b)).channelId;
    sdk.queryMembers.mockResolvedValue({ members: [{ user_id: a }, { user_id: b }] });
    sdk.getMessage.mockResolvedValue({ message: { cid: `messaging:${channelId}`, user: { id: b }, text: 'unsafe text' } });
    await expect(service.messageEvidence(a, channelId, 'message-1')).resolves.toEqual({
      targetUserId: b, messageId: 'message-1', messageText: 'unsafe text', messageSenderId: b,
    });
    sdk.getMessage.mockResolvedValue({ message: { cid: 'messaging:other', user: { id: b }, text: 'spoof' } });
    await expect(service.messageEvidence(a, channelId, 'message-2')).rejects.toMatchObject({ statusCode: 404 });
  });
  it('refuses token owner injection and disables token response caching', async () => {
    const { service } = fixture(); const app = express(); app.use(express.json());
    installStreamRoutes(app, { service, authService: createAuthServiceStub({ restore: vi.fn().mockResolvedValue({ id: a, email: 'test@example.com' }) }) });
    app.use((error: { statusCode: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => { void _next; res.sendStatus(error.statusCode); });
    await request(app).post('/v1/chat/token').send({ userId: b }).expect(403);
    await request(app).post('/v1/chat/token').query({ userId: b }).expect(403);
    expect(sdk.createToken).not.toHaveBeenCalled();
    const response = await request(app).post('/v1/chat/token').expect(200);
    expect((response.body as { userId: string }).userId).toBe(a);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
