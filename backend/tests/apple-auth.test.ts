import { createHash } from 'node:crypto';

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  AppleAuthorizationProvider,
  AppleIdentityTokenVerifier,
  AppleTokenCipher,
  type AppleIdentityTokenVerifying,
  type AppleVerifiedIdentity,
} from '../src/apple-auth.js';

const clientID = 'ai.lauver.app.staging';
const rawNonce = 'test-raw-nonce-with-at-least-thirty-two-characters';
let privateKey: CryptoKey;
let verifier: AppleIdentityTokenVerifier;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const publicJWK = await exportJWK(pair.publicKey);
  verifier = new AppleIdentityTokenVerifier(
    clientID,
    createLocalJWKSet({ keys: [{ ...publicJWK, kid: 'apple-test-key', alg: 'RS256', use: 'sig' }] }),
  );
});

describe('AppleIdentityTokenVerifier', () => {
  it('accepts a signed token with the required issuer, audience, expiry, and hashed nonce', async () => {
    const token = await identityToken();

    await expect(verifier.verify(token, rawNonce)).resolves.toEqual({
      subject: 'apple-user-subject',
      email: 'runner@privaterelay.appleid.com',
    });
  });

  it.each([
    ['expired', { expiresIn: -60 }],
    ['wrong audience', { audience: 'attacker.example' }],
    ['wrong nonce', { nonce: 'not-the-requested-nonce' }],
  ])('rejects a token with %s claims', async (_label, overrides) => {
    const token = await identityToken(overrides);

    await expect(verifier.verify(token, rawNonce)).rejects.toMatchObject({
      reason: 'invalid_credential',
    });
  });

  it('rejects an unverified email claim', async () => {
    const token = await identityToken({ emailVerified: false });

    await expect(verifier.verify(token, rawNonce)).rejects.toMatchObject({
      reason: 'invalid_credential',
    });
  });
});

describe('AppleAuthorizationProvider', () => {
  it('fails a stalled Apple code exchange without retrying the single-use code', async () => {
    const signingPair = await generateKeyPair('ES256', { extractable: true });
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', signingPair.privateKey);
    const fetchStub = vi.fn<typeof fetch>().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const provider = new AppleAuthorizationProvider({
      clientID, teamID: 'TEAM123456', keyID: 'KEY1234567', privateKey: pem('PRIVATE KEY', pkcs8),
      verifier: new StubIdentityTokenVerifier(), fetch: fetchStub,
    });

    await expect(provider.authorize({ identityToken: 'identity', authorizationCode: 'single-use-code', nonce: rawNonce }))
      .rejects.toMatchObject({ reason: 'unavailable' });
    expect(fetchStub).toHaveBeenCalledOnce();
  });

  it('validates both identity tokens and exchanges the one-time code without a redirect URI', async () => {
    const tokenVerifier = new StubIdentityTokenVerifier();
    const fetchStub = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      if (!(init?.body instanceof URLSearchParams)) throw new Error('Expected form body');
      const body = init.body;
      expect(body.get('client_id')).toBe(clientID);
      expect(body.get('code')).toBe('single-use-code');
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('redirect_uri')).toBeNull();
      expect(body.get('client_secret')).not.toBeNull();
      return Promise.resolve(new Response(JSON.stringify({
        refresh_token: 'apple-refresh-token',
        id_token: 'server-identity-token',
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    });
    const signingPair = await generateKeyPair('ES256', { extractable: true });
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', signingPair.privateKey);
    const provider = new AppleAuthorizationProvider({
      clientID,
      teamID: 'TEAM123456',
      keyID: 'KEY1234567',
      privateKey: pem('PRIVATE KEY', pkcs8),
      verifier: tokenVerifier,
      fetch: fetchStub,
    });

    await expect(provider.authorize({
      identityToken: 'device-identity-token',
      authorizationCode: 'single-use-code',
      nonce: rawNonce,
    })).resolves.toEqual({
      subject: 'apple-user-subject',
      email: 'runner@privaterelay.appleid.com',
      refreshToken: 'apple-refresh-token',
    });
    expect(tokenVerifier.tokens).toEqual(['device-identity-token', 'server-identity-token']);
  });

  it('revokes a stored refresh token with a signed client secret', async () => {
    const fetchStub = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      if (!(init?.body instanceof URLSearchParams)) throw new Error('Expected form body');
      const body = init.body;
      expect(body.get('client_id')).toBe(clientID);
      expect(body.get('token')).toBe('apple-refresh-token');
      expect(body.get('token_type_hint')).toBe('refresh_token');
      expect(body.get('client_secret')).not.toBeNull();
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    const signingPair = await generateKeyPair('ES256', { extractable: true });
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', signingPair.privateKey);
    const provider = new AppleAuthorizationProvider({
      clientID,
      teamID: 'TEAM123456',
      keyID: 'KEY1234567',
      privateKey: pem('PRIVATE KEY', pkcs8),
      verifier: new StubIdentityTokenVerifier(),
      fetch: fetchStub,
    });

    await expect(provider.revoke('apple-refresh-token')).resolves.toBeUndefined();
    expect(fetchStub).toHaveBeenCalledOnce();
  });

  it('treats an already revoked Apple grant as successful', async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );
    const signingPair = await generateKeyPair('ES256', { extractable: true });
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', signingPair.privateKey);
    const provider = new AppleAuthorizationProvider({
      clientID,
      teamID: 'TEAM123456',
      keyID: 'KEY1234567',
      privateKey: pem('PRIVATE KEY', pkcs8),
      verifier: new StubIdentityTokenVerifier(),
      fetch: fetchStub,
    });

    await expect(provider.revoke('already-revoked-token')).resolves.toBeUndefined();
  });
});

describe('AppleTokenCipher', () => {
  it('encrypts refresh tokens with authenticated encryption', () => {
    const cipher = new AppleTokenCipher(Buffer.alloc(32, 9).toString('base64'));
    const encrypted = cipher.encrypt('sensitive-apple-refresh-token');

    expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(encrypted).not.toContain('sensitive-apple-refresh-token');
    expect(cipher.decrypt(encrypted)).toBe('sensitive-apple-refresh-token');
  });
});

async function identityToken(overrides: {
  audience?: string;
  expiresIn?: number;
  nonce?: string;
  emailVerified?: boolean;
} = {}): Promise<string> {
  const nonce = overrides.nonce ?? createHash('sha256').update(rawNonce).digest('hex');
  return new SignJWT({
    nonce,
    email: 'runner@privaterelay.appleid.com',
    email_verified: overrides.emailVerified ?? true,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'apple-test-key' })
    .setIssuer('https://appleid.apple.com')
    .setAudience(overrides.audience ?? clientID)
    .setSubject('apple-user-subject')
    .setIssuedAt()
    .setExpirationTime(`${overrides.expiresIn ?? 300}s`)
    .sign(privateKey);
}

class StubIdentityTokenVerifier implements AppleIdentityTokenVerifying {
  readonly tokens: string[] = [];

  verify(identityToken: string, _rawNonce: string): Promise<AppleVerifiedIdentity> {
    void _rawNonce;
    this.tokens.push(identityToken);
    return Promise.resolve({
      subject: 'apple-user-subject',
      email: 'runner@privaterelay.appleid.com',
    });
  }
}

function pem(label: string, data: ArrayBuffer): string {
  const base64 = Buffer.from(data).toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----`;
}
