import { describe, expect, it } from 'vitest';

import {
  Argon2idPasswordHasher,
  AuthService,
  type PasswordHasher,
  type PasswordResetDelivery,
} from '../src/auth.js';
import {
  DuplicateEmailError,
  type AuthRepository,
  type EmailAccount,
  type SessionRotationResult,
  type StoredSession,
} from '../src/auth-repository.js';

const now = new Date('2026-09-02T00:00:00.000Z');
const password = 'CorrectHorse9';
const replacementPassword = 'NewCorrectHorse8';

describe('AuthService', () => {
  it('registers a normalized email and stores only password and refresh-token hashes', async () => {
    const repository = new MemoryAuthRepository();
    const service = makeService(repository);

    const session = await service.register(' Runner@Example.COM ', password);

    expect(session.user.email).toBe('runner@example.com');
    expect(session.accessToken).not.toBe('');
    expect(session.refreshToken).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    expect(repository.accounts.get('runner@example.com')?.passwordHash).toBe(`hash:${password}`);
    expect([...repository.sessions.values()][0]?.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(repository)).not.toContain(session.refreshToken);
  });

  it('returns the same login failure for unknown, wrong-password, and suspended accounts', async () => {
    const repository = new MemoryAuthRepository();
    const service = makeService(repository);
    await service.register('runner@example.com', password);
    repository.accounts.get('runner@example.com')!.status = 'SUSPENDED';

    for (const attempt of [
      () => service.login('missing@example.com', password),
      () => service.login('runner@example.com', 'WrongPassword7'),
      () => service.login('runner@example.com', password),
    ]) {
      await expect(attempt()).rejects.toMatchObject({
        statusCode: 401,
        code: 'invalid_credentials',
        publicMessage: 'Email or password is incorrect',
      });
    }
  });

  it('rotates refresh tokens and marks the session compromised when an old token is reused', async () => {
    const repository = new MemoryAuthRepository();
    const service = makeService(repository);
    const initial = await service.register('runner@example.com', password);

    const rotated = await service.refresh(initial.refreshToken);
    expect(rotated.refreshToken).not.toBe(initial.refreshToken);

    await expect(service.refresh(initial.refreshToken)).rejects.toMatchObject({
      code: 'invalid_session',
    });
    const stored = [...repository.sessions.values()][0];
    expect(stored?.revokedAt).toEqual(now);
    expect(stored?.compromisedAt).toEqual(now);
    await expect(service.refresh(rotated.refreshToken)).rejects.toMatchObject({
      code: 'invalid_session',
    });
  });

  it('does not rotate a suspended user session', async () => {
    const repository = new MemoryAuthRepository();
    const service = makeService(repository);
    const session = await service.register('runner@example.com', password);
    repository.accounts.get('runner@example.com')!.status = 'SUSPENDED';

    await expect(service.refresh(session.refreshToken)).rejects.toMatchObject({
      code: 'invalid_session',
    });
    expect([...repository.sessions.values()][0]?.revokedAt).toEqual(now);
  });

  it('uses a single-use reset token, revokes sessions, and accepts only the new password', async () => {
    const repository = new MemoryAuthRepository();
    const delivery = new CapturingResetDelivery();
    const service = makeService(repository, delivery);
    const initial = await service.register('runner@example.com', password);

    await service.forgotPassword('runner@example.com');
    const resetToken = delivery.lastToken;
    expect(resetToken).toBeDefined();
    expect(JSON.stringify(repository)).not.toContain(resetToken);

    await service.resetPassword(resetToken!, replacementPassword);
    await expect(service.restore(initial.accessToken)).rejects.toMatchObject({ code: 'invalid_session' });
    await expect(service.login('runner@example.com', password)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    await expect(service.login('runner@example.com', replacementPassword)).resolves.toMatchObject({
      user: { email: 'runner@example.com' },
    });
    await expect(service.resetPassword(resetToken!, replacementPassword)).rejects.toMatchObject({
      code: 'invalid_reset_token',
    });
  });

  it('keeps forgot-password behavior generic for an unknown account', async () => {
    const repository = new MemoryAuthRepository();
    const delivery = new CapturingResetDelivery();
    const service = makeService(repository, delivery);

    await expect(service.forgotPassword('missing@example.com')).resolves.toBeUndefined();
    expect(delivery.lastToken).toBeUndefined();
  });

  it('keeps delivery failures generic while reporting them for operational handling', async () => {
    const repository = new MemoryAuthRepository();
    const deliveryError = new Error('provider unavailable');
    const failures: unknown[] = [];
    const service = new AuthService({
      repository,
      passwordHasher: new FastPasswordHasher(),
      passwordResetDelivery: {
        sendPasswordReset: () => Promise.reject(deliveryError),
      },
      onPasswordResetDeliveryFailure: (error) => failures.push(error),
      accessTokenSecret: 'test-auth-secret-at-least-32-characters',
      accessTokenTTLSeconds: 900,
      refreshTokenTTLSeconds: 2_592_000,
      passwordResetTTLSeconds: 900,
      now: () => now,
    });
    await service.register('runner@example.com', password);

    await expect(service.forgotPassword('runner@example.com')).resolves.toBeUndefined();
    expect(failures).toEqual([deliveryError]);
  });

  it('restores only a signed access token backed by an active server-side session', async () => {
    const repository = new MemoryAuthRepository();
    const service = makeService(repository);
    const session = await service.register('runner@example.com', password);

    await expect(service.restore(session.accessToken)).resolves.toEqual(session.user);
    await service.logout(session.refreshToken);
    await expect(service.restore(session.accessToken)).rejects.toMatchObject({ code: 'invalid_session' });
    await expect(service.restore('forged-token')).rejects.toMatchObject({ code: 'invalid_session' });
  });
});

describe('Argon2idPasswordHasher', () => {
  it('creates an Argon2id hash and verifies without retaining the raw password', async () => {
    const hasher = new Argon2idPasswordHasher();
    const passwordHash = await hasher.hash(password);

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    await expect(hasher.verify(passwordHash, password)).resolves.toBe(true);
    await expect(hasher.verify(passwordHash, 'WrongPassword7')).resolves.toBe(false);
    expect(passwordHash).not.toContain(password);
  });
});

class FastPasswordHasher implements PasswordHasher {
  hash(value: string): Promise<string> {
    return Promise.resolve(`hash:${value}`);
  }

  verify(passwordHash: string, value: string): Promise<boolean> {
    return Promise.resolve(passwordHash === `hash:${value}`);
  }
}

class CapturingResetDelivery implements PasswordResetDelivery {
  lastToken: string | undefined;

  sendPasswordReset(_email: string, token: string): Promise<void> {
    void _email;
    this.lastToken = token;
    return Promise.resolve();
  }
}

function makeService(
  repository: MemoryAuthRepository,
  passwordResetDelivery: PasswordResetDelivery = new CapturingResetDelivery(),
): AuthService {
  return new AuthService({
    repository,
    passwordHasher: new FastPasswordHasher(),
    passwordResetDelivery,
    accessTokenSecret: 'test-auth-secret-at-least-32-characters',
    accessTokenTTLSeconds: 900,
    refreshTokenTTLSeconds: 2_592_000,
    passwordResetTTLSeconds: 900,
    now: () => now,
  });
}

type MutableAccount = EmailAccount & { status: EmailAccount['status'] };
type ResetRecord = { userId: string; expiresAt: Date; usedAt: Date | null };

class MemoryAuthRepository implements AuthRepository {
  readonly accounts = new Map<string, MutableAccount>();
  readonly sessions = new Map<string, StoredSession>();
  readonly resetTokens = new Map<string, ResetRecord>();

  createEmailAccount(email: string, passwordHash: string): Promise<EmailAccount> {
    if (this.accounts.has(email)) throw new DuplicateEmailError();
    const account: MutableAccount = {
      userId: crypto.randomUUID(),
      email,
      status: 'ACTIVE',
      passwordHash,
    };
    this.accounts.set(email, account);
    return Promise.resolve(account);
  }

  findEmailAccount(email: string): Promise<EmailAccount | null> {
    return Promise.resolve(this.accounts.get(email) ?? null);
  }

  findEmailForUser(userId: string): Promise<string | null> {
    return Promise.resolve(
      [...this.accounts.values()].find((account) => account.userId === userId)?.email ?? null,
    );
  }

  createSession(session: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    this.sessions.set(session.id, { ...session, revokedAt: null, compromisedAt: null });
    return Promise.resolve();
  }

  findSession(id: string): Promise<StoredSession | null> {
    return Promise.resolve(this.sessions.get(id) ?? null);
  }

  rotateSession(input: {
    id: string;
    presentedHash: string;
    nextHash: string;
    now: Date;
  }): Promise<SessionRotationResult> {
    const session = this.sessions.get(input.id);
    if (
      session === undefined ||
      session.revokedAt !== null ||
      session.compromisedAt !== null ||
      session.expiresAt <= input.now
    ) {
      return Promise.resolve({ kind: 'invalid' });
    }
    const account = [...this.accounts.values()].find(
      (candidate) => candidate.userId === session.userId,
    );
    if (account?.status !== 'ACTIVE') {
      session.revokedAt = input.now;
      return Promise.resolve({ kind: 'invalid' });
    }
    if (session.refreshTokenHash !== input.presentedHash) {
      session.revokedAt = input.now;
      session.compromisedAt = input.now;
      return Promise.resolve({ kind: 'compromised' });
    }
    session.refreshTokenHash = input.nextHash;
    return Promise.resolve({ kind: 'rotated', userId: session.userId });
  }

  revokeSession(id: string, presentedHash: string, date: Date): Promise<void> {
    const session = this.sessions.get(id);
    if (session?.refreshTokenHash === presentedHash) session.revokedAt = date;
    return Promise.resolve();
  }

  isSessionActive(id: string, userId: string, date: Date): Promise<boolean> {
    const session = this.sessions.get(id);
    const account = [...this.accounts.values()].find((candidate) => candidate.userId === userId);
    return Promise.resolve(
      session?.userId === userId &&
      session.revokedAt === null &&
      session.compromisedAt === null &&
      session.expiresAt > date &&
      account?.status === 'ACTIVE',
    );
  }

  createPasswordResetToken(input: {
    email: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<boolean> {
    const account = this.accounts.get(input.email);
    if (account === undefined || account.status !== 'ACTIVE') return Promise.resolve(false);
    for (const record of this.resetTokens.values()) {
      if (record.userId === account.userId && record.usedAt === null) record.usedAt = input.now;
    }
    this.resetTokens.set(input.tokenHash, {
      userId: account.userId,
      expiresAt: input.expiresAt,
      usedAt: null,
    });
    return Promise.resolve(true);
  }

  resetPassword(input: {
    tokenHash: string;
    passwordHash: string;
    now: Date;
  }): Promise<boolean> {
    const record = this.resetTokens.get(input.tokenHash);
    if (record === undefined || record.usedAt !== null || record.expiresAt <= input.now) {
      return Promise.resolve(false);
    }
    const account = [...this.accounts.values()].find((candidate) => candidate.userId === record.userId);
    if (account === undefined) return Promise.resolve(false);
    account.passwordHash = input.passwordHash;
    record.usedAt = input.now;
    for (const session of this.sessions.values()) {
      if (session.userId === account.userId && session.revokedAt === null) session.revokedAt = input.now;
    }
    return Promise.resolve(true);
  }
}
