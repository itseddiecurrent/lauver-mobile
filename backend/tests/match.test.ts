/* eslint-disable @typescript-eslint/unbound-method */
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { MatchService } from '../src/match.js';
import { createAuthServiceStub, createTestApp } from './helpers/test-app.js';

const viewer = 'a1500000-0000-4000-8000-000000000001';
const target = 'a1500000-0000-4000-8000-000000000002';

function app() {
  const service = {
    preferences: vi.fn().mockResolvedValue({ visibleInMatch: false, gender: null, preferredGender: 'all', maxDistanceKm: 25, sports: [] }),
    updatePreferences: vi.fn().mockResolvedValue({ visibleInMatch: true, gender: 'female', preferredGender: 'all', maxDistanceKm: null, sports: ['running'] }),
    candidates: vi.fn().mockResolvedValue({ users: [], nextCursor: null }),
    swipe: vi.fn().mockResolvedValue({ direction: 'like', matched: false, matchId: null }),
    list: vi.fn().mockResolvedValue({ matches: [] }),
    unmatch: vi.fn().mockResolvedValue(undefined),
    reportMatch: vi.fn().mockResolvedValue({ referenceId: 'c1500000-0000-4000-8000-000000000001' }),
    reportLike: vi.fn().mockResolvedValue({ referenceId: 'c1500000-0000-4000-8000-000000000002' }),
  } as unknown as MatchService;
  return { service, app: createTestApp({ matchService: service, authService: createAuthServiceStub({ restore: vi.fn().mockResolvedValue({ id: viewer, email: null }) }) }) };
}

describe('Match API contract', () => {
  it('derives the actor from auth and persists explicit preferences', async () => {
    const { app: testApp, service } = app();
    const response = await request(testApp).patch('/v1/match/preferences').send({
      visibleInMatch: true, gender: 'female', preferredGender: 'all', maxDistanceKm: null, sports: ['running'],
    });
    expect(response.status).toBe(200);
    expect(vi.mocked(service.updatePreferences)).toHaveBeenCalledWith(viewer, { visibleInMatch: true, gender: 'female', preferredGender: 'all', maxDistanceKm: null, sports: ['running'] });
  });

  it('rejects invalid filters and invalid swipe payloads before the service', async () => {
    const { app: testApp, service } = app();
    await request(testApp).get('/v1/match/candidates?limit=51').expect(422);
    await request(testApp).post('/v1/match/swipes').send({ targetUserId: target, direction: 'love' }).expect(422);
    expect(vi.mocked(service.candidates)).not.toHaveBeenCalled();
    expect(vi.mocked(service.swipe)).not.toHaveBeenCalled();
  });

  it('accepts every documented Match distance and unlimited filtering', async () => {
    const { app: testApp, service } = app();
    for (const value of [5, 10, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 'unlimited']) {
      await request(testApp).get(`/v1/match/candidates?maxDistanceKm=${value}`).expect(200);
    }
    expect(vi.mocked(service.candidates)).toHaveBeenLastCalledWith(viewer, expect.objectContaining({ maxDistanceKm: null }));
  });

  it('passes an opaque candidate query and swipe target without trusting userId input', async () => {
    const { app: testApp, service } = app();
    await request(testApp).get('/v1/match/candidates?sport=running&limit=10').expect(200);
    await request(testApp).post('/v1/match/swipes').send({ targetUserId: target, direction: 'like', userId: 'forged' }).expect(422);
    expect(vi.mocked(service.candidates)).toHaveBeenCalledWith(viewer, expect.objectContaining({ limit: 10, sport: ['running'] }));
    expect(vi.mocked(service.swipe)).not.toHaveBeenCalled();
  });

  it('reports Match and Like evidence using the authenticated actor', async () => {
    const { app: testApp, service } = app();
    const matchId = 'b1500000-0000-4000-8000-000000000001';
    await request(testApp).post(`/v1/matches/${matchId}/report`).send({ reason: 'harassment', context: 'unmatch', details: 'after unmatching' }).expect(201);
    expect(vi.mocked(service.reportMatch)).toHaveBeenCalledWith(viewer, matchId, { reason: 'harassment', context: 'unmatch', details: 'after unmatching' }, expect.any(String));
    await request(testApp).post(`/v1/match/likes/${target}/report`).send({ reason: 'spam' }).expect(201);
    expect(vi.mocked(service.reportLike)).toHaveBeenCalledWith(viewer, target, { reason: 'spam' }, expect.any(String));
  });
});
