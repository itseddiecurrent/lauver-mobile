import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const stravaScopes = ['read', 'activity:read'] as const;
export class StravaError extends Error {
  constructor(readonly statusCode: number, readonly code: string, readonly publicMessage: string) {
    super(publicMessage);
  }
}
export type StravaActivity = {
  id: string; title: string; sport: string; startedAt: string; durationSeconds: number; distanceMeters: number;
};
export type StravaTokens = { accessToken: string; refreshToken: string; expiresAt: number; scopes?: string };
export type StravaAuthorization = StravaTokens & { athleteID: string; athleteName: string };
export interface StravaProviding {
  authorizationURL(state: string): string;
  exchange(code: string): Promise<StravaAuthorization>;
  refresh(token: string): Promise<StravaTokens>;
  activities(token: string): Promise<StravaActivity[]>;
  revoke(refreshToken: string): Promise<void>;
}
const providerID = z.number().int().positive().safe();
const tokenSchema = z.object({
  access_token: z.string().min(1).max(2048), refresh_token: z.string().min(1).max(2048),
  expires_at: z.number().int().positive().max(32_503_680_000), scope: z.string().max(500).optional(),
});
const authorizationSchema = tokenSchema.extend({ athlete: z.object({
  id: providerID, firstname: z.string().max(100).nullable().optional(), lastname: z.string().max(100).nullable().optional(),
}) });
const activitySchema = z.object({
  id: providerID, name: z.string().min(1).max(500), sport_type: z.string().min(1).max(80).optional(),
  type: z.string().min(1).max(80).optional(), start_date: z.iso.datetime({ offset: true }),
  elapsed_time: z.number().int().nonnegative().max(31_536_000), distance: z.number().finite().nonnegative().max(100_000_000),
});
function invalidProvider(): StravaError {
  return new StravaError(502, 'strava_unavailable', 'Strava could not complete this request. Please try again.');
}
export function hasReadOnlyScopes(value: string): boolean {
  const scopes = value.split(/[ ,]+/).filter(Boolean);
  return stravaScopes.every(scope => scopes.includes(scope)) && scopes.every(scope => stravaScopes.includes(scope as typeof stravaScopes[number]));
}
export class StravaProvider implements StravaProviding {
  constructor(private readonly config: { clientID: string; clientSecret: string; callbackURL: string }, private readonly fetcher: typeof fetch = fetch) {}
  authorizationURL(state: string): string {
    const url = new URL('https://www.strava.com/oauth/mobile/authorize');
    url.search = new URLSearchParams({ client_id: this.config.clientID, redirect_uri: this.config.callbackURL,
      response_type: 'code', approval_prompt: 'force', scope: stravaScopes.join(','), state }).toString();
    return url.toString();
  }
  async exchange(code: string): Promise<StravaAuthorization> {
    const result = authorizationSchema.safeParse(await this.tokenRequest({ grant_type: 'authorization_code', code }));
    if (!result.success) throw invalidProvider();
    const value = result.data;
    return { ...this.tokens(value), athleteID: String(value.athlete.id),
      athleteName: [value.athlete.firstname, value.athlete.lastname].filter(Boolean).join(' ').trim() || 'Strava athlete' };
  }
  async refresh(refreshToken: string): Promise<StravaTokens> {
    const result = tokenSchema.safeParse(await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }));
    if (!result.success) throw invalidProvider();
    return this.tokens(result.data);
  }
  async activities(accessToken: string): Promise<StravaActivity[]> {
    const raw = await this.request('https://www.strava.com/api/v3/athlete/activities?page=1&per_page=20', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const result = z.array(activitySchema).max(20).safeParse(raw);
    if (!result.success) throw invalidProvider();
    // Explicit projection discards routes, start/end pins, HR and all other provider fields.
    return result.data.map(value => ({ id: String(value.id), title: value.name,
      sport: value.sport_type ?? value.type ?? 'Workout', startedAt: new Date(value.start_date).toISOString(),
      durationSeconds: value.elapsed_time, distanceMeters: value.distance }));
  }
  async revoke(refreshToken: string): Promise<void> {
    await this.request('https://www.strava.com/oauth/revoke', { method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${this.config.clientID}:${this.config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token' }).toString(),
    }, true);
  }
  private tokens(value: z.infer<typeof tokenSchema>): StravaTokens {
    return { accessToken: value.access_token, refreshToken: value.refresh_token, expiresAt: value.expires_at, scopes: value.scope };
  }
  private tokenRequest(parameters: Record<string, string>): Promise<unknown> {
    return this.request('https://www.strava.com/oauth/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.config.clientID, client_secret: this.config.clientSecret, ...parameters }).toString(),
    });
  }
  private async request(url: string, options: RequestInit, empty = false): Promise<unknown> {
    try {
      const response = await this.fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15_000) });
      if (response.status === 429) throw new StravaError(429, 'strava_rate_limited', 'Strava is receiving too many requests. Try again later.');
      if ([400, 401, 403].includes(response.status) && !empty) {
        throw new StravaError(409, 'strava_reconnect_required', 'Strava authorization is no longer valid. Disconnect and connect again.');
      }
      if (!response.ok || (empty && response.status !== 200)) throw invalidProvider();
      if (empty) { await response.body?.cancel(); return null; }
      if (Number(response.headers.get('content-length')) > 2_097_152) throw invalidProvider();
      const reader = response.body?.getReader();
      if (!reader) throw invalidProvider();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 2_097_152) { await reader.cancel(); throw invalidProvider(); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch (error) {
      // Never propagate provider bodies, URLs, Basic credentials or token values into logs.
      if (error instanceof StravaError) throw error;
      throw invalidProvider();
    }
  }
}
export const hashStravaState = (state: string): string => createHash('sha256').update(state).digest('hex');
export class StravaTokenCipher {
  private readonly key: Buffer;
  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('Strava encryption key must decode to 32 bytes');
  }
  encrypt(token: string, userID: string, kind: 'access' | 'refresh'): string {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`strava:${userID}:${kind}`));
    const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
  }
  decrypt(value: string, userID: string, kind: 'access' | 'refresh'): string {
    const parts = value.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Invalid encrypted Strava token');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(parts[1]!, 'base64url'));
    decipher.setAAD(Buffer.from(`strava:${userID}:${kind}`));
    decipher.setAuthTag(Buffer.from(parts[2]!, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3]!, 'base64url')), decipher.final()]).toString('utf8');
  }
}
