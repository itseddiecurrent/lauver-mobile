import request from 'supertest';
import { describe,expect,it,vi } from 'vitest';
import { AuthError } from '../src/auth.js';
import { StravaError } from '../src/strava-provider.js';
import { createAuthServiceStub,createTestApp } from './helpers/test-app.js';
const userID='e1800000-0000-4000-8000-000000000001',state='a'.repeat(43);
const status={status:'disconnected',athleteName:null,lastSyncedAt:null,scopes:[],activities:[]};
const stub=()=>({start:vi.fn().mockResolvedValue({authorizationURL:'https://www.strava.com/oauth/mobile/authorize',state,expiresIn:600}),
  callback:vi.fn().mockResolvedValue('connected'),status:vi.fn().mockResolvedValue(status),sync:vi.fn().mockResolvedValue(status),disconnect:vi.fn().mockResolvedValue(status)});
const authService=createAuthServiceStub({restore:vi.fn().mockImplementation((token:string)=> token
  ? Promise.resolve({id:userID,email:null}) : Promise.reject(new AuthError(401,'invalid_session','Sign in again.')))});
describe('Strava authenticated API routes',()=>{
  it('requires authentication and derives the integration owner from the session',async()=>{
    const stravaService=stub(),app=createTestApp({stravaService,authService});
    for(const action of ['start','sync','disconnect'] as const){
      await request(app).post(`/v1/integrations/strava/${action}`).expect(401);
      await request(app).post(`/v1/integrations/strava/${action}`).set('Authorization','Bearer valid').expect(200);
      expect(stravaService[action]).toHaveBeenCalledWith(userID);
      await request(app).post(`/v1/integrations/strava/${action}`).set('Authorization','Bearer valid').send({userId:'forged'}).expect(422);
    }
    const result=await request(app).get('/v1/integrations/strava/status').set('Authorization','Bearer valid').expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    await request(app).get('/v1/integrations/strava/status?userId=forged').set('Authorization','Bearer valid').expect(422);
  });
  it('rejects invalid sessions without invoking providers',async()=>{
    const stravaService=stub(),app=createTestApp({stravaService,authService:createAuthServiceStub({restore:vi.fn().mockRejectedValue(new AuthError(401,'invalid_session','Sign in again.'))})});
    await request(app).post('/v1/integrations/strava/start').set('Authorization','Bearer invalid').expect(401);
    expect(stravaService.start).not.toHaveBeenCalled();
  });
  it('validates callbacks and returns a fixed App URL with no provider tokens',async()=>{
    const stravaService=stub(),app=createTestApp({stravaService});
    await request(app).get('/v1/integrations/strava/callback?code=code').expect(400);
    await request(app).get(`/v1/integrations/strava/callback?state=${state}&state=${state}`).expect(400);
    await request(app).get(`/v1/integrations/strava/callback?state=${state}&userId=forged`).expect(400);
    const result=await request(app).get(`/v1/integrations/strava/callback?state=${state}&code=one-use-code&scope=read,activity:read`).expect(303);
    const url=new URL(result.headers.location as string);
    expect(url.origin).toBe('null');expect(url.protocol).toBe('lauver:');expect(url.host).toBe('oauth');expect(url.pathname).toBe('/strava');
    expect(Object.fromEntries(url.searchParams)).toEqual({state,result:'connected'});
    expect(result.headers['referrer-policy']).toBe('no-referrer');
  });
  it('reports actionable provider errors and limits repeated writes',async()=>{
    const stravaService=stub(),app=createTestApp({stravaService,authService});
    stravaService.sync.mockRejectedValue(new StravaError(409,'strava_disconnected','Strava is not connected.'));
    const failed=await request(app).post('/v1/integrations/strava/sync').set('Authorization','Bearer valid').expect(409);
    expect(failed.body as {code:string}).toMatchObject({code:'strava_disconnected'});
    for(let n=0;n<10;n++)await request(app).post('/v1/integrations/strava/start').set('Authorization','Bearer valid').expect(200);
    await request(app).post('/v1/integrations/strava/start').set('Authorization','Bearer valid').expect(429);
  });
});
