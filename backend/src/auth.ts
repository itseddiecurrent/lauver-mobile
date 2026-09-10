import { createHash, randomBytes, randomUUID } from 'node:crypto';

import argon2 from 'argon2';
import { jwtVerify, SignJWT } from 'jose';

import {
  DuplicateEmailError,
  type AuthRepository,
  type EmailAccount,
} from './auth-repository.js';
import {
  AppleAuthorizationError,
  type AppleAuthorizing,
  type AppleTokenCipher,
} from './apple-auth.js';

const accessTokenIssuer = 'lauver-api';
const accessTokenAudience = 'lauver-ios';
const refreshTokenPattern = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

export type AuthUser = {
  id: string;
  email: string;
};

export type AuthSession = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export class AuthError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly publicMessage: string;

  constructor(statusCode: number, code: string, publicMessage: string) {
    super(publicMessage);
    this.name = 'AuthError';
    this.statusCode = statusCode;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

export class Argon2idPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}

export interface PasswordResetDelivery {
  sendPasswordReset(email: string, token: string): Promise<void>;
}

export class NoopPasswordResetDelivery implements PasswordResetDelivery {
  sendPasswordReset(_email: string, _token: string): Promise<void> {
    void _email;
    void _token;
    return Promise.resolve();
  }
}

type AccessTokenClaims = {
  userId: string;
  sessionId: string;
  email: string;
};

class AccessTokenCodec {
  readonly #key: Uint8Array;
  readonly #ttlSeconds: number;

  constructor(secret: string, ttlSeconds: number) {
    this.#key = new TextEncoder().encode(secret);
    this.#ttlSeconds = ttlSeconds;
  }

  async issue(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ sid: claims.sessionId, email: claims.email })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(accessTokenIssuer)
      .setAudience(accessTokenAudience)
      .setIssuedAt()
      .setExpirationTime(`${this.#ttlSeconds}s`)
      .sign(this.#key);
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.#key, {
        issuer: accessTokenIssuer,
        audience: accessTokenAudience,
        algorithms: ['HS256'],
      });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string' ||
        typeof payload.email !== 'string'
      ) {
        throw new Error('Required access-token claims are missing');
      }
      return { userId: payload.sub, sessionId: payload.sid, email: payload.email };
    } catch {
      throw invalidSessionError();
    }
  }
}

export type AuthServiceOptions = {
  repository: AuthRepository;
  appleProvider?: AppleAuthorizing;
  appleTokenCipher?: AppleTokenCipher;
  passwordHasher?: PasswordHasher;
  passwordResetDelivery?: PasswordResetDelivery;
  onPasswordResetDeliveryFailure?: (error: unknown) => void;
  accessTokenSecret: string;
  accessTokenTTLSeconds: number;
  refreshTokenTTLSeconds: number;
  passwordResetTTLSeconds: number;
  now?: () => Date;
};

export interface AuthServicing {
  register(email: string, password: string): Promise<AuthSession>;
  login(email: string, password: string): Promise<AuthSession>;
  signInWithApple(input: {
    identityToken: string;
    authorizationCode: string;
    nonce: string;
    email: string | null;
    givenName: string | null;
    familyName: string | null;
  }): Promise<AuthSession>;
  refresh(refreshToken: string): Promise<AuthSession>;
  logout(refreshToken: string): Promise<void>;
  forgotPassword(email: string): Promise<void>;
  resetPassword(token: string, password: string): Promise<void>;
  restore(accessToken: string): Promise<AuthUser>;
}

export class AuthService implements AuthServicing {
  readonly #repository: AuthRepository;
  readonly #appleProvider: AppleAuthorizing | undefined;
  readonly #appleTokenCipher: AppleTokenCipher | undefined;
  readonly #passwordHasher: PasswordHasher;
  readonly #passwordResetDelivery: PasswordResetDelivery;
  readonly #onPasswordResetDeliveryFailure: (error: unknown) => void;
  readonly #accessTokens: AccessTokenCodec;
  readonly #accessTokenTTLSeconds: number;
  readonly #refreshTokenTTLSeconds: number;
  readonly #passwordResetTTLSeconds: number;
  readonly #now: () => Date;

  constructor(options: AuthServiceOptions) {
    this.#repository = options.repository;
    this.#appleProvider = options.appleProvider;
    this.#appleTokenCipher = options.appleTokenCipher;
    this.#passwordHasher = options.passwordHasher ?? new Argon2idPasswordHasher();
    this.#passwordResetDelivery = options.passwordResetDelivery ?? new NoopPasswordResetDelivery();
    this.#onPasswordResetDeliveryFailure = options.onPasswordResetDeliveryFailure ?? (() => {});
    this.#accessTokens = new AccessTokenCodec(
      options.accessTokenSecret,
      options.accessTokenTTLSeconds,
    );
    this.#accessTokenTTLSeconds = options.accessTokenTTLSeconds;
    this.#refreshTokenTTLSeconds = options.refreshTokenTTLSeconds;
    this.#passwordResetTTLSeconds = options.passwordResetTTLSeconds;
    this.#now = options.now ?? (() => new Date());
  }

  async register(email: string, password: string): Promise<AuthSession> {
    const normalizedEmail = normalizeEmail(email);
    const passwordHash = await this.#passwordHasher.hash(password);
    let account: EmailAccount;
    try {
      account = await this.#repository.createEmailAccount(normalizedEmail, passwordHash);
    } catch (error) {
      if (error instanceof DuplicateEmailError) {
        throw new AuthError(409, 'registration_unavailable', 'Registration could not be completed');
      }
      throw error;
    }
    return this.#createSession(account.userId, account.email);
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const account = await this.#repository.findEmailAccount(normalizeEmail(email));
    if (account === null) {
      await this.#passwordHasher.hash(password);
      throw invalidCredentialsError();
    }
    const passwordMatches = await this.#passwordHasher.verify(account.passwordHash, password);
    if (!passwordMatches || account.status !== 'ACTIVE') {
      throw invalidCredentialsError();
    }
    return this.#createSession(account.userId, account.email);
  }

  async signInWithApple(input: {
    identityToken: string;
    authorizationCode: string;
    nonce: string;
    email: string | null;
    givenName: string | null;
    familyName: string | null;
  }): Promise<AuthSession> {
    if (this.#appleProvider === undefined || this.#appleTokenCipher === undefined) {
      throw new AuthError(503, 'apple_sign_in_unavailable', 'Sign in with Apple is unavailable');
    }
    try {
      const authorization = await this.#appleProvider.authorize(input);
      if (input.email !== null && normalizeEmail(input.email) !== authorization.email) {
        throw invalidAppleCredentialError();
      }
      const account = await this.#repository.linkOrCreateAppleAccount({
        subject: authorization.subject,
        email: authorization.email,
        givenName: input.givenName,
        familyName: input.familyName,
        refreshTokenEncrypted: this.#appleTokenCipher.encrypt(authorization.refreshToken),
      });
      if (account === null || account.status !== 'ACTIVE') {
        throw invalidAppleCredentialError();
      }
      return await this.#createSession(account.userId, account.email);
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (error instanceof AppleAuthorizationError) {
        if (error.reason === 'unavailable') {
          throw new AuthError(503, 'apple_sign_in_unavailable', 'Sign in with Apple is unavailable');
        }
        throw invalidAppleCredentialError();
      }
      throw error;
    }
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const parsed = parseRefreshToken(refreshToken);
    if (parsed === null) {
      throw invalidSessionError();
    }
    const nextRefreshToken = createRefreshToken(parsed.sessionId);
    const rotation = await this.#repository.rotateSession({
      id: parsed.sessionId,
      presentedHash: hashToken(refreshToken),
      nextHash: hashToken(nextRefreshToken),
      now: this.#now(),
    });
    if (rotation.kind !== 'rotated') {
      throw invalidSessionError();
    }
    const email = await this.#repository.findEmailForUser(rotation.userId);
    if (email === null) {
      throw invalidSessionError();
    }
    return this.#sessionResponse(rotation.userId, email, parsed.sessionId, nextRefreshToken);
  }

  async logout(refreshToken: string): Promise<void> {
    const parsed = parseRefreshToken(refreshToken);
    if (parsed === null) {
      return;
    }
    await this.#repository.revokeSession(
      parsed.sessionId,
      hashToken(refreshToken),
      this.#now(),
    );
  }

  async forgotPassword(email: string): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    const token = randomBytes(32).toString('base64url');
    const now = this.#now();
    const created = await this.#repository.createPasswordResetToken({
      email: normalizedEmail,
      tokenHash: hashToken(token),
      expiresAt: addSeconds(now, this.#passwordResetTTLSeconds),
      now,
    });
    if (created) {
      try {
        await this.#passwordResetDelivery.sendPasswordReset(normalizedEmail, token);
      } catch (error) {
        // Keep the public response identical so delivery failures cannot enumerate accounts.
        this.#onPasswordResetDeliveryFailure(error);
      }
    }
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const passwordHash = await this.#passwordHasher.hash(password);
    const reset = await this.#repository.resetPassword({
      tokenHash: hashToken(token),
      passwordHash,
      now: this.#now(),
    });
    if (!reset) {
      throw new AuthError(401, 'invalid_reset_token', 'The reset request is invalid or expired');
    }
  }

  async restore(accessToken: string): Promise<AuthUser> {
    const claims = await this.#accessTokens.verify(accessToken);
    const active = await this.#repository.isSessionActive(
      claims.sessionId,
      claims.userId,
      this.#now(),
    );
    if (!active) {
      throw invalidSessionError();
    }
    return { id: claims.userId, email: claims.email };
  }

  async #createSession(userId: string, email: string): Promise<AuthSession> {
    const id = randomUUID();
    const refreshToken = createRefreshToken(id);
    const now = this.#now();
    await this.#repository.createSession({
      id,
      userId,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: addSeconds(now, this.#refreshTokenTTLSeconds),
    });
    return this.#sessionResponse(userId, email, id, refreshToken);
  }

  async #sessionResponse(
    userId: string,
    email: string,
    sessionId: string,
    refreshToken: string,
  ): Promise<AuthSession> {
    return {
      user: { id: userId, email },
      accessToken: await this.#accessTokens.issue({ userId, sessionId, email }),
      refreshToken,
      expiresIn: this.#accessTokenTTLSeconds,
    };
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function createRefreshToken(sessionId: string): string {
  return `${sessionId}.${randomBytes(32).toString('base64url')}`;
}

function parseRefreshToken(token: string): { sessionId: string } | null {
  const match = refreshTokenPattern.exec(token);
  return match?.[1] === undefined ? null : { sessionId: match[1] };
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
}

function invalidCredentialsError(): AuthError {
  return new AuthError(401, 'invalid_credentials', 'Email or password is incorrect');
}

function invalidSessionError(): AuthError {
  return new AuthError(401, 'invalid_session', 'The session is invalid or expired');
}

function invalidAppleCredentialError(): AuthError {
  return new AuthError(401, 'invalid_apple_credential', 'The Apple credential is invalid or expired');
}
