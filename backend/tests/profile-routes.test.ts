import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createAuthServiceStub, createProfileServiceStub, createTestApp } from './helpers/test-app.js';
import { AuthError } from '../src/auth.js';
import { InMemoryRateLimiter } from '../src/rate-limiter.js';

const authenticated = createAuthServiceStub({
  restore: vi.fn().mockResolvedValue({ id: 'trusted-user-id', email: 'runner@example.com' }),
});

describe('profile routes', () => {
  it('derives the owner only from the bearer token', async () => {
    const updateProfile = vi.fn().mockResolvedValue({ id: 'trusted-user-id' });
    const response = await request(createTestApp({
      authService: authenticated,
      profileService: createProfileServiceStub({ updateProfile }),
    }))
      .patch('/v1/me')
      .set('Authorization', 'Bearer verified-access-token')
      .send({ displayName: 'Alex' });

    expect(response.status).toBe(200);
    expect(updateProfile).toHaveBeenCalledWith('trusted-user-id', { displayName: 'Alex' });
  });

  it('rejects client-supplied identity and unknown profile fields', async () => {
    const updateProfile = vi.fn();
    const response = await request(createTestApp({
      authService: authenticated,
      profileService: createProfileServiceStub({ updateProfile }),
    }))
      .patch('/v1/me')
      .set('Authorization', 'Bearer verified-access-token')
      .send({ displayName: 'Alex', userId: 'attacker-controlled' });

    expect(response.status).toBe(422);
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('rejects duplicate sports and malformed city metadata', async () => {
    const updateProfile = vi.fn();
    const app = createTestApp({
      authService: authenticated,
      profileService: createProfileServiceStub({ updateProfile }),
    });
    await request(app)
      .patch('/v1/me')
      .set('Authorization', 'Bearer verified-access-token')
      .send({ sports: [{ sport: 'running', paceValue: 5 }, { sport: 'running', paceValue: 6 }] })
      .expect(422);
    await request(app)
      .patch('/v1/me')
      .set('Authorization', 'Bearer verified-access-token')
      .send({ city: { name: 'Shanghai', regionCode: 'SH', countryCode: 'China', latitude: 31, longitude: 121 } })
      .expect(422);
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('requires authentication for other-user profiles', async () => {
    const restore = vi.fn().mockRejectedValue(
      new AuthError(401, 'invalid_session', 'The session is invalid or expired'),
    );
    const getPublicProfile = vi.fn();
    const response = await request(createTestApp({
      authService: createAuthServiceStub({ restore }),
      profileService: createProfileServiceStub({ getPublicProfile }),
    })).get('/v1/users/591f812c-a3ab-4273-8b6f-90d7f629a401');

    expect(response.status).toBe(401);
    expect(getPublicProfile).not.toHaveBeenCalled();
  });

  it('accepts an authenticated multipart photo stream and returns its published id', async () => {
    const uploadPhotoStream = vi.fn().mockResolvedValue({
      profile: { id: 'trusted-user-id', photos: [] },
      photo: { id: 'photo-id', photoId: 'photo-id', photoOrder: 1, photoFormat: 'jpg' },
    });
    const response = await request(createTestApp({
      authService: authenticated,
      profileService: createProfileServiceStub({ uploadPhotoStream }),
    }))
      .post('/v1/me/photos')
      .set('Authorization', 'Bearer verified-access-token')
      .field('photoOrder', '1')
      .attach('photo', Buffer.from([0xff, 0xd8, 0xff]), { filename: 'avatar.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(201);
    expect(response.body.photo.photoId).toBe('photo-id');
    expect(uploadPhotoStream).toHaveBeenCalledWith('trusted-user-id', expect.any(Uint8Array), 'image/jpeg', 1);
  });

  it('rejects malformed multipart photo input before the service is called', async () => {
    const uploadPhotoStream = vi.fn();
    const response = await request(createTestApp({
      authService: authenticated,
      profileService: createProfileServiceStub({ uploadPhotoStream }),
    }))
      .post('/v1/me/photos')
      .set('Authorization', 'Bearer verified-access-token')
      .field('photoOrder', '10')
      .attach('photo', Buffer.from([1]), { filename: 'avatar.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(422);
    expect(uploadPhotoStream).not.toHaveBeenCalled();
  });

  it('rate limits multipart uploads and returns Retry-After', async () => {
    const rateLimiter = new InMemoryRateLimiter(60_000, 1);
    const app = createTestApp({
      authService: authenticated,
      profileRateLimiter: rateLimiter,
      profileService: createProfileServiceStub({
        uploadPhotoStream: vi.fn().mockResolvedValue({ profile: {}, photo: {} }),
      }),
    });
    await request(app)
      .post('/v1/me/photos')
      .set('Authorization', 'Bearer verified-access-token')
      .field('photoOrder', '1')
      .attach('photo', Buffer.from([1]), { filename: 'one.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const response = await request(app)
      .post('/v1/me/photos')
      .set('Authorization', 'Bearer verified-access-token')
      .field('photoOrder', '2')
      .attach('photo', Buffer.from([1]), { filename: 'two.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toMatch(/^\d+$/);
    const body = response.body as { retryAfter: number };
    expect(body.retryAfter).toBe(Number(response.headers['retry-after']));
  });
});
