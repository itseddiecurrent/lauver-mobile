import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createAuthServiceStub, createProfileServiceStub, createTestApp } from './helpers/test-app.js';
import { AuthError } from '../src/auth.js';

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

  it('uses an authenticated user-scoped upload contract', async () => {
    const createPhotoUpload = vi.fn().mockResolvedValue({
      objectKey: 'profile-photos/trusted-user-id/photo.png',
      uploadURL: 'https://upload.example/signed',
      expiresIn: 600,
      requiredHeaders: { 'Content-Type': 'image/png' },
    });
    const response = await request(createTestApp({
      authService: authenticated,
      profileService: createProfileServiceStub({ createPhotoUpload }),
    }))
      .post('/v1/me/photo/upload-url')
      .set('Authorization', 'Bearer verified-access-token')
      .send({ fileName: 'avatar.png', contentType: 'image/png', byteSize: 1000 });

    expect(response.status).toBe(201);
    expect(createPhotoUpload).toHaveBeenCalledWith({
      userId: 'trusted-user-id',
      fileName: 'avatar.png',
      contentType: 'image/png',
      byteSize: 1000,
    });
  });
});
