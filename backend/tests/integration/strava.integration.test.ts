import { Client } from 'pg';
import request from 'supertest';
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { PgStravaRepository } from '../../src/strava-repository.js';
import { StravaService } from '../../src/strava.js';
import { hashStravaState,StravaError,StravaTokenCipher,type StravaProviding } from '../../src/strava-provider.js';
import { createAuthServiceStub,createTestApp } from '../helpers/test-app.js';
const a='e1800000-0000-4000-8000-000000000001',b='e1800000-0000-4000-8000-000000000002';
const sql=new Client({connectionString:process.env.TEST_DATABASE_URL!});
const repository=new PgStravaRepository(process.env.TEST_DATABASE_URL!);
const cipher=new StravaTokenCipher(Buffer.alloc(32,18).toString('base64'));
const authorization={accessToken:'test-access',refreshToken:'test-refresh',expiresAt:2_000_000_000,athleteID:'42',athleteName:'Test Runner'};
const activity={id:'123',title:'Morning run',sport:'Run',startedAt:'2026-09-14T01:00:00.000Z',durationSeconds:3600,distanceMeters:10000};
const provider={authorizationURL:vi.fn((state:string)=>`https://www.strava.com/oauth/mobile/authorize?state=${state}`),
  exchange:vi.fn<StravaProviding['exchange']>(),refresh:vi.fn<StravaProviding['refresh']>(),activities:vi.fn<StravaProviding['activities']>(),revoke:vi.fn<StravaProviding['revoke']>()};
const service=new StravaService(repository,provider,cipher);
const connect=async(owner=a)=>{const flow=await service.start(owner);expect(await service.callback(flow.state,'test-code','read,activity:read')).toBe('connected');return flow;};
beforeAll(async()=>{await sql.connect();await sql.query('INSERT INTO users(id,updated_at) VALUES($1,now()),($2,now())',[a,b]);});
beforeEach(async()=>{
  await sql.query('DELETE FROM strava_connections WHERE user_id=ANY($1::uuid[])',[[a,b]]);
  await sql.query('DELETE FROM strava_oauth_states WHERE user_id=ANY($1::uuid[])',[[a,b]]);
  await sql.query("UPDATE users SET status='ACTIVE' WHERE id=ANY($1::uuid[])",[[a,b]]);
  vi.clearAllMocks();provider.exchange.mockReset().mockResolvedValue(authorization);
  provider.refresh.mockReset().mockResolvedValue({...authorization,accessToken:'new-access',refreshToken:'new-refresh'});
  provider.activities.mockReset().mockResolvedValue([activity]);provider.revoke.mockReset().mockResolvedValue(undefined);
});
afterAll(async()=>{await sql.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[a,b]]);await sql.end();await repository.close();});
describe('PostgreSQL Strava lifecycle and account isolation',()=>{
  it('consumes hashed state once, binds to its owner and supersedes previous attempts',async()=>{
    const old=await service.start(a),fresh=await service.start(a);
    const rows=await sql.query<{state_hash:string;user_id:string}>('SELECT state_hash,user_id FROM strava_oauth_states WHERE user_id=$1',[a]);
    expect(rows.rows).toEqual([{state_hash:hashStravaState(fresh.state),user_id:a}]);
    await expect(service.callback(old.state,'code','read,activity:read')).rejects.toMatchObject({code:'strava_invalid_state'});
    expect(await service.callback(fresh.state,'code','read,activity:read')).toBe('connected');
    await expect(service.callback(fresh.state,'code','read,activity:read')).rejects.toMatchObject({code:'strava_invalid_state'});
    expect((await service.status(b)).status).toBe('disconnected');
    const status=await service.status(a);expect(status).toMatchObject({status:'connected',athleteName:'Test Runner',activities:[activity]});
    expect(JSON.stringify(status)).not.toMatch(/token|athleteID|latitude|longitude|route|email/);
    expect(provider.exchange).toHaveBeenCalledTimes(1);
  });
  it('rejects expired, wrong-owner and inactive-owner state without issuing tokens',async()=>{
    const flow=await service.start(a);
    expect(await repository.locked(b,store=>store.consumeState(hashStravaState(flow.state)))).toBe(false);
    await sql.query("UPDATE strava_oauth_states SET expires_at=now()-interval '1 second' WHERE user_id=$1",[a]);
    await expect(service.callback(flow.state,'code','read,activity:read')).rejects.toMatchObject({code:'strava_invalid_state'});
    const inactive=await service.start(a);await sql.query("UPDATE users SET status='SUSPENDED' WHERE id=$1",[a]);
    await expect(service.callback(inactive.state,'code','read,activity:read')).rejects.toMatchObject({code:'invalid_session'});
    expect(provider.exchange).not.toHaveBeenCalled();
  });
  it('handles denied authorization and consumes state even if exchange fails',async()=>{
    const denied=await service.start(a);expect(await service.callback(denied.state,undefined,undefined,'access_denied')).toBe('cancelled');
    expect(provider.exchange).not.toHaveBeenCalled();
    const flow=await service.start(a);provider.exchange.mockRejectedValueOnce(new StravaError(502,'strava_unavailable','Unavailable.'));
    expect(await service.callback(flow.state,'code','read,activity:read')).toBe('authorization_failed');
    await expect(service.callback(flow.state,'code','read,activity:read')).rejects.toMatchObject({code:'strava_invalid_state'});
  });
  it('rejects missing or broader accepted scopes and provider scope mismatch; revokes issued grants',async()=>{
    for(const scope of ['read','read,activity:read,activity:write',undefined]){
      const flow=await service.start(a);expect(await service.callback(flow.state,'code',scope)).toBe('scope_missing');
      expect((await service.status(a)).status).toBe('disconnected');
    }
    provider.exchange.mockResolvedValueOnce({...authorization,scopes:'read'});
    const flow=await service.start(a);expect(await service.callback(flow.state,'code','read,activity:read')).toBe('scope_missing');
    expect(provider.revoke).toHaveBeenCalledTimes(4);expect(provider.activities).not.toHaveBeenCalled();
  });
  it('keeps only an idempotent bounded summary window, removes no-longer-returned activities and encrypts tokens',async()=>{
    await connect();await service.sync(a);
    expect((await sql.query('SELECT * FROM strava_activities WHERE user_id=$1',[a])).rowCount).toBe(1);
    const record=await repository.locked(a,store=>store.connection());
    expect(record!.access_token_encrypted).not.toContain('test-access');
    expect(cipher.decrypt(record!.refresh_token_encrypted,a,'refresh')).toBe('test-refresh');
    provider.activities.mockResolvedValueOnce([]);expect((await service.sync(a)).activities).toEqual([]);
    expect((await sql.query('SELECT * FROM strava_activities WHERE user_id=$1',[a])).rowCount).toBe(0);
  });
  it('persists rotated credentials even when the subsequent activity fetch fails',async()=>{
    await connect();await sql.query('UPDATE strava_connections SET expires_at=1 WHERE user_id=$1',[a]);
    provider.activities.mockRejectedValueOnce(new StravaError(502,'strava_unavailable','Unavailable.'));
    await expect(service.sync(a)).rejects.toMatchObject({code:'strava_unavailable'});
    const record=await repository.locked(a,store=>store.connection());
    expect(cipher.decrypt(record!.refresh_token_encrypted,a,'refresh')).toBe('new-refresh');
    expect((await service.sync(a)).activities).toEqual([activity]);expect(provider.refresh).toHaveBeenCalledTimes(1);
    expect(provider.activities).toHaveBeenLastCalledWith('new-access');
  });
  it('refreshes a provider-rejected token once and marks invalid refresh authorization as reconnect required',async()=>{
    await connect();provider.activities.mockRejectedValueOnce(new StravaError(409,'strava_reconnect_required','Reconnect.'));
    await service.sync(a);expect(provider.refresh).toHaveBeenCalledTimes(1);
    await sql.query('UPDATE strava_connections SET expires_at=1 WHERE user_id=$1',[a]);
    provider.refresh.mockRejectedValueOnce(new StravaError(409,'strava_reconnect_required','Reconnect.'));
    await expect(service.sync(a)).rejects.toMatchObject({code:'strava_reconnect_required'});
    expect(await service.status(a)).toMatchObject({status:'reconnect_required',activities:[]});
  });
  it('serializes refresh and disconnect across instances and avoids stale refresh reuse',async()=>{
    await connect();await sql.query('UPDATE strava_connections SET expires_at=1 WHERE user_id=$1',[a]);
    let entered!:()=>void,release!:()=>void;
    const inside=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    provider.refresh.mockImplementationOnce(async()=>{entered();await gate;return {...authorization,accessToken:'new-access',refreshToken:'new-refresh'};});
    const syncing=service.sync(a);await inside;
    await expect(service.sync(a)).rejects.toMatchObject({code:'strava_busy'});
    await expect(service.disconnect(a)).rejects.toMatchObject({code:'strava_busy'});
    release();await syncing;await service.disconnect(a);expect(provider.revoke).toHaveBeenLastCalledWith('new-refresh');
    expect((await service.status(a)).status).toBe('disconnected');
  });
  it('hides summaries immediately on revoke failure, retries durably and cancels outstanding state',async()=>{
    const flow=await connect();provider.revoke.mockRejectedValueOnce(new StravaError(502,'strava_unavailable','Unavailable.'));
    expect(await service.disconnect(a)).toMatchObject({status:'revocation_pending',activities:[]});
    expect((await sql.query('SELECT * FROM strava_activities WHERE user_id=$1',[a])).rowCount).toBe(0);
    await expect(service.sync(a)).rejects.toMatchObject({code:'strava_disconnected'});
    await expect(service.start(a)).rejects.toMatchObject({code:'strava_already_connected'});
    await service.processCleanup();expect((await service.status(a)).status).toBe('disconnected');
    await expect(service.callback(flow.state,'code','read,activity:read')).rejects.toMatchObject({code:'strava_invalid_state'});
    expect(await service.disconnect(a)).toMatchObject({status:'disconnected'});
    const pending=await service.start(a);await service.disconnect(a);
    await expect(service.callback(pending.state,'code','read,activity:read')).rejects.toMatchObject({code:'strava_invalid_state'});
  });
  it('cleans rejected-scope grants after provider recovery and revalidates rotated scopes',async()=>{
    provider.revoke.mockRejectedValueOnce(new StravaError(502,'strava_unavailable','Unavailable.'));
    const flow=await service.start(a);expect(await service.callback(flow.state,'code','read')).toBe('scope_missing');
    expect((await service.status(a)).status).toBe('revocation_pending');await service.processCleanup();
    await connect();await sql.query('UPDATE strava_connections SET expires_at=1 WHERE user_id=$1',[a]);
    provider.refresh.mockResolvedValueOnce({...authorization,refreshToken:'new-refresh',scopes:'read'});
    await expect(service.sync(a)).rejects.toMatchObject({code:'strava_scope_missing'});
    expect((await service.status(a)).status).toBe('revocation_pending');await service.processCleanup();
    expect(provider.revoke).toHaveBeenLastCalledWith('new-refresh');
  });
  it('enforces owner isolation through real HTTP routes',async()=>{
    await connect();const app=createTestApp({stravaService:service,authService:createAuthServiceStub({restore:vi.fn().mockResolvedValue({id:b,email:null})})});
    const result=await request(app).get('/v1/integrations/strava/status').set('Authorization','Bearer test').expect(200);
    expect(result.body as {status:string}).toMatchObject({status:'disconnected'});
    await request(app).post('/v1/integrations/strava/disconnect').set('Authorization','Bearer test').expect(200);
    expect((await service.status(a)).status).toBe('connected');expect(provider.revoke).not.toHaveBeenCalled();
  });
  it('disabled integration remains usable without secrets',async()=>{
    const disabled=new StravaService(repository);expect((await disabled.status(a)).status).toBe('disabled');
    await expect(disabled.start(a)).rejects.toMatchObject({code:'strava_disabled'});
  });
});
