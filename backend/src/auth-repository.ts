import { randomUUID } from 'node:crypto';

import { Prisma, type PrismaClient, type UserStatus } from '@prisma/client';

export type EmailAccount = {
  userId: string;
  email: string;
  status: UserStatus;
  passwordHash: string;
};

export type AppleAccount = {
  userId: string;
  email: string;
  status: UserStatus;
};

export type StoredSession = {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  compromisedAt: Date | null;
};

export type SessionRotationResult =
  | { kind: 'rotated'; userId: string }
  | { kind: 'compromised' }
  | { kind: 'invalid' };

export class DuplicateEmailError extends Error {
  constructor() {
    super('Email identity already exists');
    this.name = 'DuplicateEmailError';
  }
}

export interface AuthRepository {
  createEmailAccount(email: string, passwordHash: string): Promise<EmailAccount>;
  findEmailAccount(email: string): Promise<EmailAccount | null>;
  findEmailForUser(userId: string): Promise<string | null>;
  linkOrCreateAppleAccount(input: {
    subject: string;
    email: string | null;
    givenName: string | null;
    familyName: string | null;
    refreshTokenEncrypted: string;
  }): Promise<AppleAccount | null>;
  createSession(session: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findSession(id: string): Promise<StoredSession | null>;
  rotateSession(input: {
    id: string;
    presentedHash: string;
    nextHash: string;
    now: Date;
  }): Promise<SessionRotationResult>;
  revokeSession(id: string, presentedHash: string, now: Date): Promise<void>;
  isSessionActive(id: string, userId: string, now: Date): Promise<boolean>;
  createPasswordResetToken(input: {
    email: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<boolean>;
  resetPassword(input: { tokenHash: string; passwordHash: string; now: Date }): Promise<boolean>;
}

export class PrismaAuthRepository implements AuthRepository {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async createEmailAccount(email: string, passwordHash: string): Promise<EmailAccount> {
    try {
      const user = await this.#client.user.create({
        data: {
          id: randomUUID(),
          identities: {
            create: {
              id: randomUUID(),
              provider: 'EMAIL',
              providerSubject: email,
              passwordCredential: { create: { passwordHash } },
            },
          },
        },
        include: {
          identities: { include: { passwordCredential: true } },
        },
      });
      const identity = user.identities[0];
      if (identity?.passwordCredential === null || identity?.passwordCredential === undefined) {
        throw new Error('Created email identity is missing its password credential');
      }
      return {
        userId: user.id,
        email: identity.providerSubject,
        status: user.status,
        passwordHash: identity.passwordCredential.passwordHash,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DuplicateEmailError();
      }
      throw error;
    }
  }

  async findEmailAccount(email: string): Promise<EmailAccount | null> {
    const identity = await this.#client.authIdentity.findUnique({
      where: { provider_providerSubject: { provider: 'EMAIL', providerSubject: email } },
      include: { user: true, passwordCredential: true },
    });
    if (identity?.passwordCredential === null || identity?.passwordCredential === undefined) {
      return null;
    }
    return {
      userId: identity.userId,
      email: identity.providerSubject,
      status: identity.user.status,
      passwordHash: identity.passwordCredential.passwordHash,
    };
  }

  async findEmailForUser(userId: string): Promise<string | null> {
    const identity = await this.#client.authIdentity.findFirst({
      where: { userId, provider: 'EMAIL' },
      select: { providerSubject: true },
    });
    if (identity !== null) return identity.providerSubject;
    const apple = await this.#client.appleCredential.findFirst({
      where: { identity: { userId, provider: 'APPLE' } },
      select: { email: true },
    });
    return apple?.email ?? null;
  }

  async linkOrCreateAppleAccount(input: {
    subject: string;
    email: string | null;
    givenName: string | null;
    familyName: string | null;
    refreshTokenEncrypted: string;
  }): Promise<AppleAccount | null> {
    return this.#client.$transaction(async (transaction) => {
      const existing = await transaction.authIdentity.findUnique({
        where: { provider_providerSubject: { provider: 'APPLE', providerSubject: input.subject } },
        include: { user: true, appleCredential: true },
      });
      if (existing !== null) {
        const savedEmail = existing.appleCredential?.email ?? input.email;
        if (savedEmail === null) return null;
        await transaction.appleCredential.upsert({
          where: { identityId: existing.id },
          create: {
            identityId: existing.id,
            email: savedEmail,
            givenName: input.givenName,
            familyName: input.familyName,
            refreshTokenEncrypted: input.refreshTokenEncrypted,
          },
          update: {
            refreshTokenEncrypted: input.refreshTokenEncrypted,
            ...(existing.appleCredential?.email === null && input.email !== null
              ? { email: input.email }
              : {}),
            ...(existing.appleCredential?.givenName === null && input.givenName !== null
              ? { givenName: input.givenName }
              : {}),
            ...(existing.appleCredential?.familyName === null && input.familyName !== null
              ? { familyName: input.familyName }
              : {}),
          },
        });
        return { userId: existing.userId, email: savedEmail, status: existing.user.status };
      }

      if (input.email === null) return null;
      const emailIdentity = await transaction.authIdentity.findUnique({
        where: { provider_providerSubject: { provider: 'EMAIL', providerSubject: input.email } },
        include: { user: true },
      });
      const user = emailIdentity?.user ?? await transaction.user.create({ data: { id: randomUUID() } });
      await transaction.authIdentity.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          provider: 'APPLE',
          providerSubject: input.subject,
          appleCredential: {
            create: {
              email: input.email,
              givenName: input.givenName,
              familyName: input.familyName,
              refreshTokenEncrypted: input.refreshTokenEncrypted,
            },
          },
        },
      });
      return { userId: user.id, email: input.email, status: user.status };
    });
  }

  async createSession(session: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.#client.session.create({ data: session });
  }

  async findSession(id: string): Promise<StoredSession | null> {
    return this.#client.session.findUnique({ where: { id } });
  }

  async rotateSession(input: {
    id: string;
    presentedHash: string;
    nextHash: string;
    now: Date;
  }): Promise<SessionRotationResult> {
    return this.#client.$transaction(async (transaction) => {
      const session = await transaction.session.findUnique({
        where: { id: input.id },
        include: { user: true },
      });
      if (
        session === null ||
        session.revokedAt !== null ||
        session.compromisedAt !== null ||
        session.expiresAt <= input.now
      ) {
        return { kind: 'invalid' };
      }
      if (session.user.status !== 'ACTIVE') {
        await transaction.session.update({
          where: { id: input.id },
          data: { revokedAt: input.now },
        });
        return { kind: 'invalid' };
      }
      if (session.refreshTokenHash !== input.presentedHash) {
        await transaction.session.update({
          where: { id: input.id },
          data: { revokedAt: input.now, compromisedAt: input.now },
        });
        return { kind: 'compromised' };
      }
      const updated = await transaction.session.updateMany({
        where: {
          id: input.id,
          refreshTokenHash: input.presentedHash,
          revokedAt: null,
          compromisedAt: null,
        },
        data: { refreshTokenHash: input.nextHash, lastUsedAt: input.now },
      });
      if (updated.count !== 1) {
        await transaction.session.updateMany({
          where: { id: input.id },
          data: { revokedAt: input.now, compromisedAt: input.now },
        });
        return { kind: 'compromised' };
      }
      return { kind: 'rotated', userId: session.userId };
    });
  }

  async revokeSession(id: string, presentedHash: string, now: Date): Promise<void> {
    await this.#client.session.updateMany({
      where: { id, refreshTokenHash: presentedHash, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async isSessionActive(id: string, userId: string, now: Date): Promise<boolean> {
    const count = await this.#client.session.count({
      where: {
        id,
        userId,
        revokedAt: null,
        compromisedAt: null,
        expiresAt: { gt: now },
        user: { status: 'ACTIVE' },
      },
    });
    return count === 1;
  }

  async createPasswordResetToken(input: {
    email: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<boolean> {
    return this.#client.$transaction(async (transaction) => {
      const identity = await transaction.authIdentity.findUnique({
        where: { provider_providerSubject: { provider: 'EMAIL', providerSubject: input.email } },
        include: { user: true },
      });
      if (identity === null || identity.user.status !== 'ACTIVE') {
        return false;
      }
      await transaction.emailToken.updateMany({
        where: { userId: identity.userId, purpose: 'PASSWORD_RESET', usedAt: null },
        data: { usedAt: input.now },
      });
      await transaction.emailToken.create({
        data: {
          id: randomUUID(),
          userId: identity.userId,
          purpose: 'PASSWORD_RESET',
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        },
      });
      return true;
    });
  }

  async resetPassword(input: {
    tokenHash: string;
    passwordHash: string;
    now: Date;
  }): Promise<boolean> {
    return this.#client.$transaction(async (transaction) => {
      const token = await transaction.emailToken.findUnique({
        where: { tokenHash: input.tokenHash },
      });
      if (
        token === null ||
        token.purpose !== 'PASSWORD_RESET' ||
        token.usedAt !== null ||
        token.expiresAt <= input.now
      ) {
        return false;
      }
      const identity = await transaction.authIdentity.findFirst({
        where: { userId: token.userId, provider: 'EMAIL' },
      });
      if (identity === null) {
        return false;
      }
      const claimed = await transaction.emailToken.updateMany({
        where: {
          id: token.id,
          usedAt: null,
          expiresAt: { gt: input.now },
        },
        data: { usedAt: input.now },
      });
      if (claimed.count !== 1) {
        return false;
      }
      await transaction.passwordCredential.update({
        where: { identityId: identity.id },
        data: { passwordHash: input.passwordHash, changedAt: input.now },
      });
      await transaction.session.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: input.now },
      });
      return true;
    });
  }
}
