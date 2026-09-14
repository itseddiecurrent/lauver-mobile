import { describe, expect, it, vi } from 'vitest';
import { hasReadOnlyScopes, StravaProvider, StravaTokenCipher } from '../src/strava-provider.js';
const config = { clientID:'12345',clientSecret:'provider-test-secret',callbackURL:'https://example.com/v1/integrations/strava/callback' };
const tokenBody = { access_token:'test-access',refresh_token:'test-refresh',expires_at:2_000_000_000 };
const activity = { id:123,name:'Morning run',sport_type:'Run',start_date:'2026-09-14T01:00:00Z',elapsed_time:3600,distance:10000,
  start_latlng:[31,121],end_latlng:[32,122],map:{ summary_polyline:'private-route' },average_heartrate:150 };
describe('Strava read-only provider contract', () => {
  it('requests exactly the two scopes and a fixed HTTPS callback', () => {
    const url = new URL(new StravaProvider(config).authorizationURL('state'));
    expect(url.origin+url.pathname).toBe('https://www.strava.com/oauth/mobile/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({client_id:'12345',redirect_uri:config.callbackURL,response_type:'code',approval_prompt:'force',scope:'read,activity:read',state:'state'});
    expect(hasReadOnlyScopes('read activity:read')).toBe(true);
    for (const scope of ['read','read,activity:read,activity:write','activity:read_all,read','']) expect(hasReadOnlyScopes(scope)).toBe(false);
  });
  it('exchanges and refreshes server-side and keeps the newest refresh token', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({...tokenBody,athlete:{id:42,firstname:'Test',lastname:'Runner'},scope:'read,activity:read'}))
      .mockResolvedValueOnce(Response.json({...tokenBody,refresh_token:'new-refresh'}));
    const provider = new StravaProvider(config,fetcher);
    expect(await provider.exchange('one-use-code')).toMatchObject({athleteID:'42',athleteName:'Test Runner',refreshToken:'test-refresh'});
    expect(await provider.refresh('test-refresh')).toMatchObject({refreshToken:'new-refresh'});
    const options = fetcher.mock.calls[1]![1]!;
    expect(new URLSearchParams(options.body as string).get('grant_type')).toBe('refresh_token');
    expect(new URLSearchParams(options.body as string).get('client_secret')).toBe(config.clientSecret);
    expect(options.redirect).toBe('error');
  });
  it('projects only summaries, preserving no route, coordinates or HR', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([activity]));
    const result = await new StravaProvider(config,fetcher).activities('test-access');
    expect(result).toEqual([{id:'123',title:'Morning run',sport:'Run',startedAt:'2026-09-14T01:00:00.000Z',durationSeconds:3600,distanceMeters:10000}]);
    expect(fetcher.mock.calls[0]![0]).toContain('per_page=20');
  });
  it('uses recommended revoke endpoint with Basic auth and the refresh token; accepts empty 200', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null,{status:200}));
    await new StravaProvider(config,fetcher).revoke('test-refresh');
    expect(fetcher.mock.calls[0]![0]).toBe('https://www.strava.com/oauth/revoke');
    const options=fetcher.mock.calls[0]![1]!;
    expect(options.headers).toMatchObject({Authorization:`Basic ${Buffer.from('12345:provider-test-secret').toString('base64')}`});
    expect(new URLSearchParams(options.body as string).get('token_type_hint')).toBe('refresh_token');
  });
  it('sanitizes rate-limit, invalid grants, invalid payloads and transport errors', async () => {
    for (const [response,code] of [[new Response('sensitive provider error',{status:429}),'strava_rate_limited'],
      [new Response('sensitive provider error',{status:401}),'strava_reconnect_required'],
      [Response.json({refresh_token:'sensitive payload'}),'strava_unavailable']] as const) {
      const provider = new StravaProvider(config,vi.fn<typeof fetch>().mockResolvedValue(response));
      await expect(provider.refresh('test-refresh')).rejects.toMatchObject({code});
    }
    const provider = new StravaProvider(config,vi.fn<typeof fetch>().mockRejectedValue(new Error('test-refresh in upstream error')));
    await expect(provider.refresh('test-refresh')).rejects.toThrow('Strava could not complete this request.');
  });
  it('does not count an accepted-but-pending revoke as confirmed success', async () => {
    const provider = new StravaProvider(config,vi.fn<typeof fetch>().mockResolvedValue(new Response(null,{status:202})));
    await expect(provider.revoke('test-refresh')).rejects.toMatchObject({code:'strava_unavailable'});
  });
  it('rejects invalid and unbounded activities', async () => {
    for (const payload of [[{...activity,id:Number.MAX_SAFE_INTEGER+1}],[{...activity,distance:-1}],Array.from({length:21},()=>activity)]) {
      const provider = new StravaProvider(config,vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload)));
      await expect(provider.activities('test-access')).rejects.toMatchObject({code:'strava_unavailable'});
    }
  });
  it('authenticates ciphertext against account and token kind, randomizes IV and detects tampering', () => {
    const cipher = new StravaTokenCipher(Buffer.alloc(32,8).toString('base64'));
    const encrypted = cipher.encrypt('test-refresh','user-a','refresh');
    expect(cipher.decrypt(encrypted,'user-a','refresh')).toBe('test-refresh');
    expect(encrypted).not.toContain('test-refresh');
    expect(cipher.encrypt('test-refresh','user-a','refresh')).not.toBe(encrypted);
    expect(()=>cipher.decrypt(encrypted,'user-b','refresh')).toThrow();
    expect(()=>cipher.decrypt(encrypted,'user-a','access')).toThrow();
    const parts=encrypted.split('.'); parts[2]=Buffer.alloc(16).toString('base64url');
    expect(()=>cipher.decrypt(parts.join('.'),'user-a','refresh')).toThrow();
  });
});
