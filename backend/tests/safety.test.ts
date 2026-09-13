import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AuthError } from '../src/auth.js';
import { InMemoryRateLimiter } from '../src/rate-limiter.js';
import { reportReasons } from '../src/safety.js';
import { createAuthServiceStub, createTestApp } from './helpers/test-app.js';

const actorId = 'e1700000-0000-4000-8000-000000000001';
const targetId = 'e1700000-0000-4000-8000-000000000002';
const authService = createAuthServiceStub({ restore: vi.fn().mockResolvedValue({ id: actorId, email: null }) });
const stub = () => ({ block: vi.fn(), unblock: vi.fn(),
  blockedUsers: vi.fn().mockResolvedValue({ users: [], nextCursor: null }),
  report: vi.fn().mockResolvedValue({ referenceId: targetId, blockedUser: false }) });
const reportBody = { targetType: 'user', targetId, reason: 'harassment' };

describe('authenticated safety routes', () => {
  it('requires a valid session on all safety endpoints', async () => {
    const safetyService = stub();
    const app = createTestApp({ safetyService, authService: createAuthServiceStub({ restore: vi.fn().mockRejectedValue(new AuthError(401, 'invalid_session', 'Sign in again.')) }) });
    await request(app).get('/v1/blocks').expect(401);
    await request(app).post(`/v1/blocks/${targetId}`).expect(401);
    await request(app).delete(`/v1/blocks/${targetId}`).expect(401);
    await request(app).post('/v1/reports').send(reportBody).expect(401);
    expect(safetyService.report).not.toHaveBeenCalled();
    expect(safetyService.block).not.toHaveBeenCalled();
  });
  it('derives block, unblock and list owners only from the authenticated session', async () => {
    const safetyService = stub();
    const app = createTestApp({ authService, safetyService });
    const response = await request(app).post(`/v1/blocks/${targetId}`).expect(204);
    expect(safetyService.block).toHaveBeenCalledWith(actorId, targetId, response.headers['x-request-id']);
    await request(app).delete(`/v1/blocks/${targetId}`).expect(204);
    expect(safetyService.unblock).toHaveBeenCalledWith(actorId, targetId, expect.any(String));
    const list = await request(app).get('/v1/blocks').expect(200);
    expect(list.headers['cache-control']).toBe('no-store');
    expect(safetyService.blockedUsers).toHaveBeenCalledWith(actorId, undefined);
    await request(app).post(`/v1/blocks/${targetId}`).send({ userId: targetId }).expect(422);
    await request(app).delete(`/v1/blocks/${targetId}`).send({ userId: targetId }).expect(422);
    await request(app).get('/v1/blocks?userId=forged').expect(422);
  });
  it('supports every reason, preserves new evidence on repeat targets, and returns a reference', async () => {
    const safetyService = stub();
    const app = createTestApp({ authService, safetyService });
    for (const reason of reportReasons) {
      const response = await request(app).post('/v1/reports').send({ ...reportBody, reason, details: ' New evidence ' }).expect(201);
      expect(response.body as { referenceId: string }).toMatchObject({ referenceId: targetId });
      expect(safetyService.report).toHaveBeenLastCalledWith(actorId, { ...reportBody, reason, details: 'New evidence', blockUser: false }, response.headers['x-request-id']);
    }
    expect(safetyService.report).toHaveBeenCalledTimes(6);
  });
  it('validates IDs, target type, reason, note length and rejects forged snapshot/actor', async () => {
    const safetyService = stub();
    const app = createTestApp({ authService, safetyService });
    for (const invalid of [{ ...reportBody, targetId: 'missing' }, { ...reportBody, targetType: 'event' },
      { ...reportBody, reason: 'invalid' }, { ...reportBody, details: 'x'.repeat(2001) },
      { ...reportBody, reporterId: targetId }, { ...reportBody, snapshot: {} }]) {
      await request(app).post('/v1/reports').send(invalid).expect(422);
    }
    await request(app).post('/v1/blocks/not-a-uuid').expect(422);
    expect(safetyService.report).not.toHaveBeenCalled();
  });
  it('passes explicit report-and-block to one atomic service operation', async () => {
    const safetyService = stub();
    await request(createTestApp({ authService, safetyService })).post('/v1/reports').send({ ...reportBody, blockUser: true }).expect(201);
    expect(safetyService.report).toHaveBeenCalledWith(actorId, { ...reportBody, blockUser: true }, expect.any(String));
    expect(safetyService.block).not.toHaveBeenCalled();
  });
  it('rate limits authenticated writes with correlation metadata', async () => {
    const safetyService = stub();
    const app = createTestApp({ authService, safetyService, safetyRateLimiter: new InMemoryRateLimiter(60_000, 1) });
    await request(app).post('/v1/reports').send(reportBody).expect(201);
    const response = await request(app).post('/v1/reports').send(reportBody).expect(429);
    expect(response.body as { requestId: string }).toMatchObject({ requestId: response.headers['x-request-id'] });
    expect(safetyService.report).toHaveBeenCalledTimes(1);
    await request(app).post(`/v1/blocks/${targetId}`).expect(204);
    await request(app).post(`/v1/blocks/${targetId}`).expect(429);
  });
});
