import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { z } from 'zod';
import type { AuthServicing } from './auth.js';
import { authenticated } from './profile-routes.js';
import { InMemoryRateLimiter, RateLimitExceededError } from './rate-limiter.js';
import { hashStravaState, hasReadOnlyScopes, StravaError, type StravaTokenCipher, type StravaProviding, type StravaTokens, type StravaActivity } from './strava-provider.js';
import type { StravaConnectionRecord, StravaRepository, StravaStore } from './strava-repository.js';

export type StravaStatus = {
  status: 'disabled' | 'disconnected' | StravaConnectionRecord['status'];
  athleteName: string | null; lastSyncedAt: string | null; scopes: string[]; activities: StravaActivity[];
};
export type StravaStart = { authorizationURL: string; state: string; expiresIn: number };
export type StravaCallbackResult = 'connected' | 'connected_sync_failed' | 'cancelled' | 'scope_missing' | 'authorization_failed';
export interface StravaServicing {
  start(userID: string): Promise<StravaStart>;
  callback(state: string, code?: string, scope?: string, error?: string): Promise<StravaCallbackResult>;
  status(userID: string): Promise<StravaStatus>;
  sync(userID: string): Promise<StravaStatus>;
  disconnect(userID: string): Promise<StravaStatus>;
}
const blankStatus = (status: StravaStatus['status']): StravaStatus => ({ status, athleteName: null, lastSyncedAt: null, scopes: [], activities: [] });
export class StravaService implements StravaServicing {
  constructor(private readonly repository: StravaRepository, private readonly provider?: StravaProviding, private readonly cipher?: StravaTokenCipher) {}
  private enabled(): { provider: StravaProviding; cipher: StravaTokenCipher } {
    if (!this.provider || !this.cipher) throw new StravaError(503, 'strava_disabled', 'Strava connection is unavailable. Please try again later.');
    return { provider: this.provider, cipher: this.cipher };
  }
  async start(userID: string): Promise<StravaStart> {
    const { provider } = this.enabled();
    return this.repository.locked(userID, async store => {
      if (!await store.active()) throw new StravaError(401, 'invalid_session', 'Sign in again.');
      if (await store.connection()) throw new StravaError(409, 'strava_already_connected', 'Disconnect your existing Strava connection before connecting again.');
      const state = randomBytes(32).toString('base64url');
      await store.createState(hashStravaState(state));
      return { authorizationURL: provider.authorizationURL(state), state, expiresIn: 600 };
    });
  }
  async callback(state: string, code?: string, scope?: string, error?: string): Promise<StravaCallbackResult> {
    const { provider, cipher } = this.enabled(), hash = hashStravaState(state);
    const userID = await this.repository.ownerOfState(hash);
    if (!userID) throw new StravaError(400, 'strava_invalid_state', 'This Strava connection attempt has expired or was already used. Start again in Lauver.');
    return this.repository.locked(userID, async store => {
      if (!await store.consumeState(hash)) throw new StravaError(400, 'strava_invalid_state', 'Start a new Strava connection attempt.');
      if (!await store.active()) throw new StravaError(401, 'invalid_session', 'Sign in again.');
      if (error === 'access_denied') return 'cancelled';
      if (error || !code || await store.connection()) return 'authorization_failed';
      let tokens;
      try { tokens = await provider.exchange(code); }
      catch (error) { if (error instanceof StravaError) return 'authorization_failed'; throw error; }
      // Persist the received credentials before any subsequent provider call.
      const record: StravaConnectionRecord = { user_id: userID, status: 'revocation_pending', athlete_id: tokens.athleteID,
        athlete_name: tokens.athleteName, scopes: scope ?? '', expires_at: tokens.expiresAt, last_synced_at: null,
        access_token_encrypted: cipher.encrypt(tokens.accessToken,userID,'access'), refresh_token_encrypted: cipher.encrypt(tokens.refreshToken,userID,'refresh') };
      await store.saveConnection(record);
      if (!hasReadOnlyScopes(scope ?? '') || (tokens.scopes !== undefined && !hasReadOnlyScopes(tokens.scopes))) {
        try { await provider.revoke(tokens.refreshToken); await store.clearConnection(); }
        catch (error) { if (!(error instanceof StravaError)) throw error; }
        return 'scope_missing';
      }
      await store.setStatus('connected');
      try { await this.syncStore(store, { ...record, status: 'connected' }); return 'connected'; }
      catch (error) { if (error instanceof StravaError) return 'connected_sync_failed'; throw error; }
    });
  }
  async status(userID: string): Promise<StravaStatus> {
    if (!this.provider) return blankStatus('disabled');
    return this.repository.locked(userID, store => this.statusStore(store));
  }
  async sync(userID: string): Promise<StravaStatus> {
    this.enabled();
    return this.repository.locked(userID, async store => {
      if (!await store.active()) throw new StravaError(401, 'invalid_session', 'Sign in again.');
      const record = await store.connection();
      if (!record || record.status !== 'connected') throw new StravaError(409, 'strava_disconnected', 'Strava is not connected. Check Connected Apps.');
      await this.syncStore(store,record);
      return this.statusStore(store);
    });
  }
  private async syncStore(store: StravaStore, initial: StravaConnectionRecord): Promise<void> {
    const { provider, cipher } = this.enabled(); let record = initial;
    const rotate = async () => {
      const tokens = await provider.refresh(cipher.decrypt(record.refresh_token_encrypted,record.user_id,'refresh'));
      record = this.rotated(record,tokens,cipher);
      // Autocommit before the activities request: preserve latest refresh token on HTTP failures.
      await store.saveConnection(record);
      if (tokens.scopes !== undefined && !hasReadOnlyScopes(tokens.scopes)) {
        await store.setStatus('revocation_pending');
        throw new StravaError(409, 'strava_scope_missing', 'Strava read access changed. Disconnect and connect again.');
      }
    };
    try {
      let rotated = false;
      if (record.expires_at <= Math.floor(Date.now()/1000)+60) { await rotate(); rotated = true; }
      let activities;
      try { activities = await provider.activities(cipher.decrypt(record.access_token_encrypted,record.user_id,'access')); }
      catch (error) {
        if (!(error instanceof StravaError) || error.code !== 'strava_reconnect_required' || rotated) throw error;
        await rotate();
        activities = await provider.activities(cipher.decrypt(record.access_token_encrypted,record.user_id,'access'));
      }
      await store.replaceActivities(activities);
    } catch (error) {
      if (error instanceof StravaError && error.code === 'strava_reconnect_required') await store.setStatus('reconnect_required');
      throw error;
    }
  }
  private rotated(record: StravaConnectionRecord, tokens: StravaTokens, cipher: StravaTokenCipher): StravaConnectionRecord {
    return { ...record, expires_at: tokens.expiresAt, scopes: tokens.scopes ?? record.scopes,
      access_token_encrypted: cipher.encrypt(tokens.accessToken,record.user_id,'access'), refresh_token_encrypted: cipher.encrypt(tokens.refreshToken,record.user_id,'refresh') };
  }
  async disconnect(userID: string): Promise<StravaStatus> {
    const { provider, cipher } = this.enabled();
    return this.repository.locked(userID, async store => {
      await store.clearStates();
      const record = await store.connection();
      if (!record) return blankStatus('disconnected');
      await store.setStatus('revocation_pending');
      try { await provider.revoke(cipher.decrypt(record.refresh_token_encrypted,userID,'refresh')); }
      catch (error) { if (error instanceof StravaError) return blankStatus('revocation_pending'); throw error; }
      await store.clearConnection();
      return blankStatus('disconnected');
    });
  }
  async processCleanup(): Promise<void> {
    if (!this.provider) return;
    await this.repository.pruneStates();
    for (const owner of await this.repository.pendingOwners()) {
      try { await this.disconnect(owner); }
      catch (error) { if (!(error instanceof StravaError)) throw error; }
    }
  }
  private async statusStore(store: StravaStore): Promise<StravaStatus> {
    if (!await store.active()) throw new StravaError(401, 'invalid_session', 'Sign in again.');
    const record = await store.connection();
    if (!record) return blankStatus('disconnected');
    if (record.status !== 'connected') return blankStatus(record.status);
    return { status: 'connected', athleteName: record.athlete_name, lastSyncedAt: record.last_synced_at,
      scopes: record.scopes.split(/[ ,]+/).filter(Boolean), activities: await store.activities() };
  }
}

const callbackSchema = z.object({ state: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code: z.string().min(1).max(2048).optional(),
  scope: z.string().max(500).optional(), error: z.string().max(100).optional() }).strict();
export function installStravaRoutes(app: Express, dependencies: { authService: AuthServicing; stravaService: StravaServicing }): void {
  const limiter = new InMemoryRateLimiter(60_000,10), callbackLimiter = new InMemoryRateLimiter(60_000,30);
  const empty = z.object({}).strict();
  const base = '/v1/integrations/strava';
  app.get(`${base}/callback`, async (request,response,next) => {
    response.setHeader('Cache-Control','no-store'); response.setHeader('Referrer-Policy','no-referrer');
    try { callbackLimiter.consume(`callback:${request.ip ?? 'unknown'}`); }
    catch (error) {
      if (!(error instanceof RateLimitExceededError)) return next(error);
      response.status(429).json({ code:'rate_limited',message:'Try again later.',requestId:response.getHeader('x-request-id') }); return;
    }
    const parsed = callbackSchema.safeParse(request.query);
    if (!parsed.success) { response.status(400).json({ code:'strava_invalid_callback',message:'Start a new connection in Lauver.',requestId:response.getHeader('x-request-id') }); return; }
    try {
      const value = parsed.data;
      const result = await dependencies.stravaService.callback(value.state,value.code,value.scope,value.error);
      const url = new URL('lauver://oauth/strava'); url.search = new URLSearchParams({ state:value.state,result }).toString();
      response.redirect(303,url.toString());
    } catch (error) { next(error); }
  });
  for (const action of ['start','status','sync','disconnect'] as const) {
    const handler = authenticated(dependencies.authService, async (user,request,response) => {
      response.setHeader('Cache-Control','no-store');
      if (!empty.safeParse(request.query).success || (action !== 'status' && !empty.safeParse(request.body ?? {}).success)) {
        response.status(422).json({ code:'validation_error',message:'Do not include account IDs or provider tokens.',requestId:response.getHeader('x-request-id') }); return;
      }
      if (action !== 'status') {
        try { limiter.consume(`${action}:user:${user.id}`); limiter.consume(`${action}:ip:${request.ip ?? 'unknown'}`); }
        catch (error) {
          if (!(error instanceof RateLimitExceededError)) throw error;
          response.status(429).json({ code:'rate_limited',message:'Try again later.',requestId:response.getHeader('x-request-id') }); return;
        }
      }
      response.status(200).json(await dependencies.stravaService[action](user.id));
    });
    if (action === 'status') app.get(`${base}/status`,handler);
    else app.post(`${base}/${action}`,handler);
  }
}
