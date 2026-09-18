import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { AuthError } from '../src/auth.js';
import { InMemoryRateLimiter } from '../src/rate-limiter.js';
import { createAuthServiceStub, createTestApp } from './helpers/test-app.js';

const validBody = { email: 'runner@example.com', password: 'CorrectHorse9' };

describe('email auth routes', () => {
  it('rejects weak passwords before calling registration', async () => {
    const register = vi.fn();
    const response = await request(
      createTestApp({ authService: createAuthServiceStub({ register }) }),
    )
      .post('/v1/auth/register')
      .send({ email: 'runner@example.com', password: 'weak' });

    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe('validation_failed');
    expect(register).not.toHaveBeenCalled();
  });

  it('does not reveal whether registration failed because the email exists', async () => {
    const response = await request(
      createTestApp({
        authService: createAuthServiceStub({
          register: vi.fn().mockRejectedValue(
            new AuthError(409, 'registration_unavailable', 'Registration could not be completed'),
          ),
        }),
      }),
    )
      .post('/v1/auth/register')
      .send(validBody);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      code: 'registration_unavailable',
      message: 'Registration could not be completed',
      requestId: response.headers['x-request-id'],
    });
    expect(JSON.stringify(response.body)).not.toContain('exists');
  });

  it('returns the same generic forgot-password response for every eligible request shape', async () => {
    const forgotPassword = vi.fn().mockResolvedValue(undefined);
    const response = await request(
      createTestApp({ authService: createAuthServiceStub({ forgotPassword }) }),
    )
      .post('/v1/auth/password/forgot')
      .send({ email: 'missing@example.com' });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      message: 'If the account is eligible, reset instructions will be sent',
    });
  });

  it('rate limits repeated login attempts by IP even when the account changes', async () => {
    const login = vi.fn().mockRejectedValue(
      new AuthError(401, 'invalid_credentials', 'Email or password is incorrect'),
    );
    const app = createTestApp({
      authService: createAuthServiceStub({ login }),
      authRateLimiter: new InMemoryRateLimiter(60_000, 1),
    });

    await request(app).post('/v1/auth/login').send(validBody).expect(401);
    const response = await request(app)
      .post('/v1/auth/login')
      .send({ ...validBody, email: 'different@example.com' });

    expect(response.status).toBe(429);
    expect((response.body as { code: string }).code).toBe('rate_limited');
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('rejects unexpected identity fields instead of trusting client-supplied user IDs', async () => {
    const register = vi.fn();
    const response = await request(
      createTestApp({ authService: createAuthServiceStub({ register }) }),
    )
      .post('/v1/auth/register')
      .send({ ...validBody, userId: 'attacker-controlled' });

    expect(response.status).toBe(422);
    expect(register).not.toHaveBeenCalled();
  });

  it('restores identity only from a verified bearer token, never a body user ID', async () => {
    const restore = vi.fn().mockResolvedValue({ id: 'trusted-user', email: 'runner@example.com' });
    const response = await request(
      createTestApp({ authService: createAuthServiceStub({ restore }) }),
    )
      .get('/v1/auth/session')
      .set('Authorization', 'Bearer signed-access-token')
      .send({ userId: 'attacker-controlled' });

    expect(response.status).toBe(200);
    expect((response.body as { user: { id: string } }).user.id).toBe('trusted-user');
    expect(restore).toHaveBeenCalledWith('signed-access-token');
  });
});

describe('Apple auth route', () => {
  const validAppleBody = {
    identityToken: 'signed-apple-identity-token',
    authorizationCode: 'single-use-authorization-code',
    nonce: 'raw-nonce-with-at-least-thirty-two-characters',
    email: 'runner@privaterelay.appleid.com',
    givenName: 'Alex',
    familyName: 'Runner',
  };

  it('passes only the Apple proof and first-login name to the auth service', async () => {
    const signInWithApple = vi.fn().mockResolvedValue({
      user: { id: 'trusted-user', email: 'runner@privaterelay.appleid.com' },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 900,
    });
    const response = await request(createTestApp({
      authService: createAuthServiceStub({ signInWithApple }),
    })).post('/v1/auth/apple').send(validAppleBody);

    expect(response.status).toBe(200);
    expect(signInWithApple).toHaveBeenCalledWith(validAppleBody);
  });

  it('rejects a client-supplied Apple user ID', async () => {
    const signInWithApple = vi.fn();
    const app = createTestApp({ authService: createAuthServiceStub({ signInWithApple }) });

    await request(app).post('/v1/auth/apple').send({ ...validAppleBody, userId: 'unverified' }).expect(422);
    expect(signInWithApple).not.toHaveBeenCalled();
  });
});

describe('Google auth route', () => {
  it('passes the Firebase ID token to the auth service', async () => {
    const signInWithGoogle = vi.fn().mockResolvedValue({
      user: { id: 'trusted-user', email: 'runner@gmail.com' },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 900,
    });
    const response = await request(createTestApp({
      authService: createAuthServiceStub({ signInWithGoogle }),
    })).post('/v1/auth/google').send({ idToken: 'firebase-id-token' });

    expect(response.status).toBe(200);
    expect(signInWithGoogle).toHaveBeenCalledWith('firebase-id-token');
  });

  it('rejects extra client-controlled identity fields', async () => {
    const signInWithGoogle = vi.fn();
    const response = await request(createTestApp({
      authService: createAuthServiceStub({ signInWithGoogle }),
    })).post('/v1/auth/google').send({ idToken: 'firebase-id-token', userId: 'attacker-controlled' });

    expect(response.status).toBe(422);
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });
});
