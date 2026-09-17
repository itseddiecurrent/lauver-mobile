import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

import {
  createRemoteJWKSet,
  importPKCS8,
  jwtVerify,
  SignJWT,
  type JWTVerifyGetKey,
} from 'jose';

const appleIssuer = 'https://appleid.apple.com';
const appleTokenURL = 'https://appleid.apple.com/auth/token';
const appleRevokeURL = 'https://appleid.apple.com/auth/revoke';
const appleJWKSURL = 'https://appleid.apple.com/auth/keys';

export type AppleVerifiedIdentity = {
  subject: string;
  email: string | null;
};

export type AppleAuthorization = AppleVerifiedIdentity & {
  refreshToken: string;
};

export type AppleAuthorizationInput = {
  identityToken: string;
  authorizationCode: string;
  nonce: string;
};

export type AppleAuthorizationFailure = 'invalid_credential' | 'revoked' | 'unavailable';

export class AppleAuthorizationError extends Error {
  readonly reason: AppleAuthorizationFailure;

  constructor(reason: AppleAuthorizationFailure) {
    super(`Apple authorization failed: ${reason}`);
    this.name = 'AppleAuthorizationError';
    this.reason = reason;
  }
}

export interface AppleAuthorizing {
  authorize(input: AppleAuthorizationInput): Promise<AppleAuthorization>;
}

export interface AppleRevoking {
  revoke(refreshToken: string): Promise<void>;
}

export class DisabledAppleAuthorizationProvider implements AppleAuthorizing {
  authorize(_input: AppleAuthorizationInput): Promise<AppleAuthorization> {
    void _input;
    return Promise.reject(new AppleAuthorizationError('unavailable'));
  }
}

export interface AppleIdentityTokenVerifying {
  verify(identityToken: string, rawNonce: string): Promise<AppleVerifiedIdentity>;
}

export class AppleIdentityTokenVerifier implements AppleIdentityTokenVerifying {
  readonly #clientID: string;
  readonly #keyResolver: JWTVerifyGetKey;

  constructor(
    clientID: string,
    keyResolver: JWTVerifyGetKey = createRemoteJWKSet(new URL(appleJWKSURL), {
      cacheMaxAge: 3_600_000,
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    }),
  ) {
    this.#clientID = clientID;
    this.#keyResolver = keyResolver;
  }

  async verify(identityToken: string, rawNonce: string): Promise<AppleVerifiedIdentity> {
    try {
      const { payload } = await jwtVerify(identityToken, this.#keyResolver, {
        algorithms: ['RS256'],
        issuer: appleIssuer,
        audience: this.#clientID,
      });
      const expectedNonce = createHash('sha256').update(rawNonce, 'utf8').digest('hex');
      if (
        typeof payload.sub !== 'string' ||
        payload.sub.length === 0 ||
        payload.nonce !== expectedNonce
      ) {
        throw new Error('Required Apple identity claims are invalid');
      }
      const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null;
      if (email !== null && !isVerifiedEmailClaim(payload.email_verified)) {
        throw new Error('Apple email claim is not verified');
      }
      return { subject: payload.sub, email };
    } catch {
      throw new AppleAuthorizationError('invalid_credential');
    }
  }
}

type AppleTokenResponse = {
  refresh_token?: unknown;
  id_token?: unknown;
  error?: unknown;
};

type Fetching = typeof fetch;

export class AppleAuthorizationProvider implements AppleAuthorizing, AppleRevoking {
  readonly #clientID: string;
  readonly #teamID: string;
  readonly #keyID: string;
  readonly #privateKey: string;
  readonly #verifier: AppleIdentityTokenVerifying;
  readonly #fetch: Fetching;

  constructor(options: {
    clientID: string;
    teamID: string;
    keyID: string;
    privateKey: string;
    verifier?: AppleIdentityTokenVerifying;
    fetch?: Fetching;
  }) {
    this.#clientID = options.clientID;
    this.#teamID = options.teamID;
    this.#keyID = options.keyID;
    this.#privateKey = options.privateKey.replaceAll('\\n', '\n');
    this.#verifier = options.verifier ?? new AppleIdentityTokenVerifier(options.clientID);
    this.#fetch = options.fetch ?? fetch;
  }

  async authorize(input: AppleAuthorizationInput): Promise<AppleAuthorization> {
    const suppliedIdentity = await this.#verifier.verify(input.identityToken, input.nonce);
    let response: Response;
    try {
      response = await this.#fetch(appleTokenURL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.#clientID,
          client_secret: await this.#createClientSecret(),
          code: input.authorizationCode,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new AppleAuthorizationError('unavailable');
    }

    let payload: AppleTokenResponse;
    try {
      payload = await response.json() as AppleTokenResponse;
    } catch {
      throw new AppleAuthorizationError(response.ok ? 'unavailable' : 'invalid_credential');
    }
    if (!response.ok) {
      const reason = payload.error === 'invalid_grant' ? 'invalid_credential' : 'unavailable';
      throw new AppleAuthorizationError(reason);
    }
    if (typeof payload.refresh_token !== 'string' || typeof payload.id_token !== 'string') {
      throw new AppleAuthorizationError('invalid_credential');
    }

    const exchangedIdentity = await this.#verifier.verify(payload.id_token, input.nonce);
    if (exchangedIdentity.subject !== suppliedIdentity.subject) {
      throw new AppleAuthorizationError('invalid_credential');
    }
    return {
      subject: suppliedIdentity.subject,
      email: suppliedIdentity.email ?? exchangedIdentity.email,
      refreshToken: payload.refresh_token,
    };
  }

  async revoke(refreshToken: string): Promise<void> {
    let response: Response;
    try {
      response = await this.#fetch(appleRevokeURL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.#clientID,
          client_secret: await this.#createClientSecret(),
          token: refreshToken,
          token_type_hint: 'refresh_token',
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new AppleAuthorizationError('unavailable');
    }

    if (response.ok) return;
    let payload: AppleTokenResponse = {};
    try { payload = await response.json() as AppleTokenResponse; } catch { /* use unavailable below */ }
    // Deletion is idempotent: Apple already rejecting an invalid/revoked grant
    // means the external authorization is no longer usable.
    if (payload.error === 'invalid_grant') return;
    throw new AppleAuthorizationError('unavailable');
  }

  async #createClientSecret(): Promise<string> {
    try {
      const key = await importPKCS8(this.#privateKey, 'ES256');
      return await new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: this.#keyID })
        .setIssuer(this.#teamID)
        .setSubject(this.#clientID)
        .setAudience(appleIssuer)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(key);
    } catch {
      throw new AppleAuthorizationError('unavailable');
    }
  }
}

export class AppleTokenCipher {
  readonly #key: Buffer;

  constructor(base64Key: string) {
    this.#key = Buffer.from(base64Key, 'base64');
    if (this.#key.length !== 32) {
      throw new Error('Apple token encryption key must decode to exactly 32 bytes');
    }
  }

  encrypt(token: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  decrypt(value: string): string {
    const [version, ivValue, tagValue, ciphertextValue] = value.split('.');
    if (version !== 'v1' || ivValue === undefined || tagValue === undefined || ciphertextValue === undefined) {
      throw new Error('Encrypted Apple token is malformed');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

function isVerifiedEmailClaim(value: unknown): boolean {
  return value === true || value === 'true';
}
