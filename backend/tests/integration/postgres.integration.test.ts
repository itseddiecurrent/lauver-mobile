import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/database.js';
import { AuthService, type PasswordResetDelivery } from '../../src/auth.js';
import {
  AppleTokenCipher,
  type AppleAuthorization,
  type AppleAuthorizationInput,
  type AppleAuthorizing,
} from '../../src/apple-auth.js';
import { createTestApp } from '../helpers/test-app.js';
import { ProfileService } from '../../src/profile.js';
import {
  UnavailableProfilePhotoStorage,
  type ProfilePhotoStorage,
  type StoredObject,
} from '../../src/object-storage.js';

const testDatabaseURL = process.env.TEST_DATABASE_URL;
if (testDatabaseURL === undefined) {
  throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
}

class CapturingResetDelivery implements PasswordResetDelivery {
  lastToken: string | undefined;

  sendPasswordReset(_email: string, token: string): Promise<void> {
    void _email;
    this.lastToken = token;
    return Promise.resolve();
  }
}

class IntegrationAppleProvider implements AppleAuthorizing {
  authorize(input: AppleAuthorizationInput): Promise<AppleAuthorization> {
    return Promise.resolve({
      subject: 'integration-apple-subject',
      email: input.authorizationCode === 'second-code' ? null : 'integration-apple@example.com',
      refreshToken: `integration-apple-refresh-token-${input.authorizationCode}`,
    });
  }
}

const database = createDatabase(testDatabaseURL);
const sqlClient = new Client({ connectionString: testDatabaseURL });
const resetDelivery = new CapturingResetDelivery();
const authService = new AuthService({
  repository: database.authRepository,
  passwordResetDelivery: resetDelivery,
  accessTokenSecret: 'integration-auth-secret-at-least-32-characters',
  accessTokenTTLSeconds: 900,
  refreshTokenTTLSeconds: 2_592_000,
  passwordResetTTLSeconds: 900,
});
const authApp = createTestApp({ database, authService });
const profileApp = createTestApp({
  database,
  authService,
  profileService: new ProfileService({
    repository: database.profileRepository,
    storage: new UnavailableProfilePhotoStorage(),
  }),
});
const appleAuthApp = createTestApp({
  database,
  authService: new AuthService({
    repository: database.authRepository,
    appleProvider: new IntegrationAppleProvider(),
    appleTokenCipher: new AppleTokenCipher(Buffer.alloc(32, 5).toString('base64')),
    accessTokenSecret: 'integration-auth-secret-at-least-32-characters',
    accessTokenTTLSeconds: 900,
    refreshTokenTTLSeconds: 2_592_000,
    passwordResetTTLSeconds: 900,
  }),
});

beforeAll(async () => {
  await sqlClient.connect();
});

afterAll(async () => {
  // Unlimited Discover must not observe this suite's completed profile fixtures.
  await sqlClient.query(`DELETE FROM users WHERE id IN (
    SELECT user_id FROM auth_identities WHERE
      (provider='EMAIL' AND provider_subject=ANY($1::text[])) OR
      (provider='APPLE' AND provider_subject='integration-apple-subject')
  )`, [['integration-runner@example.com', 'integration-profile@example.com', 'integration-photo-retry@example.com', 'integration-photo-order@example.com']]);
  await database.disconnect();
  await sqlClient.end();
});

describe('PostgreSQL integration', () => {
  it('reports ready through the real Prisma/PostgreSQL connection', async () => {
    const response = await request(createTestApp({ database })).get('/readyz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ready',
      service: 'lauver-api',
      database: 'ok',
    });
  });

  it('applied the Step 01 migration to an initially empty schema', async () => {
    const result = await sqlClient.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.service_metadata')::text AS table_name",
    );

    expect(result.rows[0]?.table_name).toBe('service_metadata');
  });

  it('applied all Step 03 authentication tables to the initially empty schema', async () => {
    const result = await sqlClient.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('users', 'auth_identities', 'password_credentials', 'sessions', 'email_tokens')
       ORDER BY table_name`,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      'auth_identities',
      'email_tokens',
      'password_credentials',
      'sessions',
      'users',
    ]);
  });

  it('applied the Step 04 Apple credential table and provider enum value', async () => {
    const table = await sqlClient.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.apple_credentials')::text AS table_name",
    );
    const provider = await sqlClient.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum
       JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
       WHERE pg_type.typname = 'AuthProvider' AND enumlabel = 'APPLE'`,
    );

    expect(table.rows[0]?.table_name).toBe('apple_credentials');
    expect(provider.rows.map((row) => row.enumlabel)).toEqual(['APPLE']);
  });

  it('applied all Step 05 profile and photo lifecycle tables', async () => {
    const result = await sqlClient.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('profiles', 'user_sports', 'training_times', 'profile_photo_uploads', 'photo_cleanup_jobs')
       ORDER BY table_name`,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      'photo_cleanup_jobs',
      'profile_photo_uploads',
      'profiles',
      'training_times',
      'user_sports',
    ]);
  });

  it('registers, logs out, logs in, and never persists raw credentials', async () => {
    const email = 'integration-runner@example.com';
    const password = 'IntegrationHorse9';
    const registration = await request(authApp)
      .post('/v1/auth/register')
      .send({ email, password });

    expect(registration.status).toBe(201);
    const registrationBody = registration.body as {
      user: { email: string };
      refreshToken: string;
    };
    expect(registrationBody.user.email).toBe(email);

    const duplicate = await request(authApp)
      .post('/v1/auth/register')
      .send({ email, password });
    expect(duplicate.status).toBe(409);
    expect((duplicate.body as { code: string }).code).toBe('registration_unavailable');

    await request(authApp)
      .post('/v1/auth/logout')
      .send({ refreshToken: registrationBody.refreshToken })
      .expect(204);
    await request(authApp)
      .post('/v1/auth/login')
      .send({ email, password: 'WrongPassword7' })
      .expect(401);
    const login = await request(authApp).post('/v1/auth/login').send({ email, password });
    expect(login.status).toBe(200);

    const stored = await sqlClient.query<{
      password_hash: string;
      refresh_token_hash: string;
    }>(
      `SELECT pc.password_hash, s.refresh_token_hash
       FROM password_credentials pc
       JOIN auth_identities ai ON ai.id = pc.identity_id
       JOIN sessions s ON s.user_id = ai.user_id
       WHERE ai.provider_subject = $1
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [email],
    );
    expect(stored.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(stored.rows[0]?.password_hash).not.toContain(password);
    expect(stored.rows[0]?.refresh_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.rows[0]?.refresh_token_hash).not.toBe(
      (login.body as { refreshToken: string }).refreshToken,
    );
  });

  it('uses identical login errors for wrong passwords and suspended accounts', async () => {
    const email = 'integration-runner@example.com';
    const wrongPassword = await request(authApp)
      .post('/v1/auth/login')
      .send({ email, password: 'WrongPassword7' });
    await sqlClient.query(
      `UPDATE users SET status = 'SUSPENDED'
       WHERE id = (SELECT user_id FROM auth_identities WHERE provider_subject = $1)`,
      [email],
    );
    const suspended = await request(authApp)
      .post('/v1/auth/login')
      .send({ email, password: 'IntegrationHorse9' });
    expect(suspended.status).toBe(401);
    expect(suspended.body as { code: string; message: string }).toMatchObject({
      code: (wrongPassword.body as { code: string }).code,
      message: (wrongPassword.body as { message: string }).message,
    });
    await sqlClient.query(
      `UPDATE users SET status = 'ACTIVE'
       WHERE id = (SELECT user_id FROM auth_identities WHERE provider_subject = $1)`,
      [email],
    );
  });

  it('detects refresh-token reuse and revokes the compromised session', async () => {
    const login = await request(authApp)
      .post('/v1/auth/login')
      .send({ email: 'integration-runner@example.com', password: 'IntegrationHorse9' });
    const initialRefreshToken = (login.body as { refreshToken: string }).refreshToken;
    const rotated = await request(authApp)
      .post('/v1/auth/refresh')
      .send({ refreshToken: initialRefreshToken });
    expect(rotated.status).toBe(200);
    const rotatedRefreshToken = (rotated.body as { refreshToken: string }).refreshToken;
    expect(rotatedRefreshToken).not.toBe(initialRefreshToken);

    await request(authApp)
      .post('/v1/auth/refresh')
      .send({ refreshToken: initialRefreshToken })
      .expect(401);
    await request(authApp)
      .post('/v1/auth/refresh')
      .send({ refreshToken: rotatedRefreshToken })
      .expect(401);

    const sessionId = initialRefreshToken.split('.')[0];
    const result = await sqlClient.query<{ revoked_at: Date | null; compromised_at: Date | null }>(
      'SELECT revoked_at, compromised_at FROM sessions WHERE id = $1',
      [sessionId],
    );
    expect(result.rows[0]?.revoked_at).not.toBeNull();
    expect(result.rows[0]?.compromised_at).not.toBeNull();
  });

  it('resets the password with a single-use token and revokes existing sessions', async () => {
    const email = 'integration-runner@example.com';
    const forgot = await request(authApp).post('/v1/auth/password/forgot').send({ email });
    expect(forgot.status).toBe(202);
    const resetToken = resetDelivery.lastToken;
    expect(resetToken).toBeDefined();

    await request(authApp)
      .post('/v1/auth/password/reset')
      .send({ token: resetToken, password: 'ReplacementHorse8' })
      .expect(200);
    await request(authApp)
      .post('/v1/auth/password/reset')
      .send({ token: resetToken, password: 'ReplacementHorse8' })
      .expect(401);
    await request(authApp)
      .post('/v1/auth/login')
      .send({ email, password: 'IntegrationHorse9' })
      .expect(401);
    await request(authApp)
      .post('/v1/auth/login')
      .send({ email, password: 'ReplacementHorse8' })
      .expect(200);

    const persisted = await sqlClient.query<{ token_hash: string }>(
      `SELECT token_hash FROM email_tokens
       WHERE user_id = (SELECT user_id FROM auth_identities WHERE provider_subject = $1)`,
      [email],
    );
    expect(persisted.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(persisted.rows[0]?.token_hash).not.toBe(resetToken);
  });

  it('persists one Apple identity and only an encrypted provider refresh token', async () => {
    const first = await request(appleAuthApp).post('/v1/auth/apple').send({
      identityToken: 'integration-identity-token',
      authorizationCode: 'first-code',
      nonce: 'integration-nonce-with-at-least-thirty-two-characters',
      email: 'integration-apple@example.com',
      givenName: 'Apple',
      familyName: 'Runner',
    });
    const second = await request(appleAuthApp).post('/v1/auth/apple').send({
      identityToken: 'integration-identity-token-2',
      authorizationCode: 'second-code',
      nonce: 'another-integration-nonce-over-thirty-two-characters',
      email: null,
      givenName: null,
      familyName: null,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((second.body as { user: { id: string } }).user.id)
      .toBe((first.body as { user: { id: string } }).user.id);
    const stored = await sqlClient.query<{
      provider_subject: string;
      refresh_token_encrypted: string;
      given_name: string;
    }>(
      `SELECT ai.provider_subject, ac.refresh_token_encrypted, ac.given_name
       FROM auth_identities ai
       JOIN apple_credentials ac ON ac.identity_id = ai.id
       WHERE ai.provider_subject = 'integration-apple-subject'`,
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.refresh_token_encrypted).toMatch(/^v1\./);
    expect(stored.rows[0]?.refresh_token_encrypted).not.toContain('integration-apple-refresh-token');
    expect(stored.rows[0]?.given_name).toBe('Apple');
  });

  it('persists a complete workout profile and omits city coordinates from the public contract', async () => {
    const registration = await request(profileApp)
      .post('/v1/auth/register')
      .send({ email: 'integration-profile@example.com', password: 'IntegrationProfile9' });
    const accessToken = (registration.body as { accessToken: string }).accessToken;
    const update = await request(profileApp)
      .patch('/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        displayName: 'Integration Runner',
        bio: 'Morning miles',
        city: {
          name: 'Shanghai',
          regionCode: 'SH',
          countryCode: 'CN',
          latitude: 31.2304,
          longitude: 121.4737,
        },
        sports: [{ sport: 'running', paceValue: 5.2 }],
        trainingTimes: [{ weekday: 1, timeBucket: 'morning' }],
      });
    expect(update.status).toBe(200);
    const profile = (update.body as { profile: { id: string; isComplete: boolean } }).profile;
    expect(profile.isComplete).toBe(true);

    const reread = await request(profileApp)
      .get('/v1/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(reread.status).toBe(200);
    expect((reread.body as { profile: { displayName: string } }).profile.displayName)
      .toBe('Integration Runner');

    const publicResponse = await request(profileApp)
      .get(`/v1/users/${profile.id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(publicResponse.status).toBe(200);
    expect(JSON.stringify(publicResponse.body)).not.toContain('latitude');
    expect(JSON.stringify(publicResponse.body)).not.toContain('longitude');
    expect(JSON.stringify(publicResponse.body)).not.toContain('photoKey');
  });

  it('persists concurrent photo completion and safely replays a lost success response', async () => {
    const objects = new Map<string, StoredObject>();
    const storage: ProfilePhotoStorage = {
      createUploadURL: ({ objectKey }) => Promise.resolve(`https://uploads.example.test/${objectKey}`),
      readObject: (objectKey) => Promise.resolve(objects.get(objectKey) ?? null),
      writeObject: (objectKey, bytes, contentType) => {
        objects.set(objectKey, { bytes, contentType });
        return Promise.resolve();
      },
      deleteObject: (objectKey) => {
        objects.delete(objectKey);
        return Promise.resolve();
      },
      publicURL: (objectKey) => `https://photos.example.test/${objectKey}`,
    };
    const app = createTestApp({
      database, authService,
      profileService: new ProfileService({ repository: database.profileRepository, storage }),
    });
    const registration = await request(app).post('/v1/auth/register').send({
      email: 'integration-photo-retry@example.com', password: 'IntegrationPhotoRetry9',
    });
    expect(registration.status).toBe(201);
    const accessToken = (registration.body as { accessToken: string }).accessToken;
    const image = await sharp({ create: {
      width: 256, height: 256, channels: 3, background: { r: 30, g: 120, b: 60 },
    } }).png().toBuffer();
    const upload = await request(app).post('/v1/me/photo/upload-url')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ fileName: 'avatar.png', contentType: 'image/png', byteSize: image.length });
    expect(upload.status).toBe(201);
    const objectKey = (upload.body as { objectKey: string }).objectKey;
    objects.set(objectKey, { bytes: image, contentType: 'image/png' });
    const complete = () => request(app).post('/v1/me/photo/complete')
      .set('Authorization', `Bearer ${accessToken}`).send({ objectKey });

    const [first, overlapping] = await Promise.all([complete(), complete()]);
    expect(first.status).toBe(200);
    expect(overlapping.status).toBe(200);
    const photoURL = (first.body as { profile: { photoURL: string } }).profile.photoURL;
    expect((overlapping.body as { profile: { photoURL: string } }).profile.photoURL).toBe(photoURL);
    const replay = await complete();
    expect(replay.status).toBe(200);
    expect((replay.body as { profile: { photoURL: string } }).profile.photoURL).toBe(photoURL);
    expect(objects.size).toBe(1);
    const pending = await sqlClient.query('SELECT object_key FROM profile_photo_uploads WHERE object_key = $1', [objectKey]);
    expect(pending.rows).toHaveLength(0);

    const deleted = await request(app).delete('/v1/me/photo')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(deleted.status).toBe(204);
    expect((await complete()).status).toBe(422);
    expect(objects.size).toBe(0);
  });

  it('reorders profile photos without violating the per-user sort order constraint', async () => {
    const orderStorage: ProfilePhotoStorage = {
      createUploadURL: () => Promise.resolve('https://uploads.example.test/order'),
      readObject: () => Promise.resolve(null),
      writeObject: () => Promise.resolve(),
      deleteObject: () => Promise.resolve(),
      publicURL: (objectKey) => `https://photos.example.test/${objectKey}`,
    };
    const orderApp = createTestApp({
      database,
      authService,
      profileService: new ProfileService({ repository: database.profileRepository, storage: orderStorage }),
    });
    const registration = await request(orderApp).post('/v1/auth/register').send({
      email: 'integration-photo-order@example.com', password: 'IntegrationPhotoOrder9',
    });
    expect(registration.status).toBe(201);
    const accessToken = (registration.body as { accessToken: string }).accessToken;
    const user = await sqlClient.query<{ id: string }>(
      `SELECT u.id
       FROM users u
       JOIN auth_identities ai ON ai.user_id = u.id
       WHERE ai.provider = 'EMAIL' AND ai.provider_subject = $1`,
      ['integration-photo-order@example.com'],
    );
    const userID = user.rows[0]?.id;
    expect(userID).toBeDefined();

    await sqlClient.query(
      `INSERT INTO profiles(user_id, photo_key, updated_at) VALUES($1, $2, CURRENT_TIMESTAMP)`,
      [userID, 'profile-photos/order-first.jpg'],
    );
    const firstID = randomUUID();
    const secondID = randomUUID();
    await sqlClient.query(
      `INSERT INTO profile_photos(id, user_id, object_key, sort_order, is_primary, updated_at)
       VALUES
         ($1, $3, 'profile-photos/order-first.jpg', 0, true, CURRENT_TIMESTAMP),
         ($2, $3, 'profile-photos/order-second.jpg', 1, false, CURRENT_TIMESTAMP)`,
      [firstID, secondID, userID],
    );

    const response = await request(orderApp)
      .patch('/v1/me/photos/order')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ photoIds: [secondID, firstID] });

    expect(response.status).toBe(200);
    const saved = await sqlClient.query<{ id: string; sort_order: number; is_primary: boolean }>(
      `SELECT id, sort_order, is_primary FROM profile_photos WHERE user_id = $1 ORDER BY sort_order`,
      [userID],
    );
    expect(saved.rows).toEqual([
      { id: secondID, sort_order: 0, is_primary: true },
      { id: firstID, sort_order: 1, is_primary: false },
    ]);
  });
});
