import { createServer,type Server } from 'node:http';
import { access,readFile,rm,stat,writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { verifyStep08 } from '../../scripts/verify-step-08-staging.js';
import { AuthService,NoopPasswordResetDelivery } from '../../src/auth.js';
import { createDatabase } from '../../src/database.js';
import { StravaService } from '../../src/strava.js';
import { StravaError,StravaTokenCipher,type StravaActivity } from '../../src/strava-provider.js';
import { InMemoryRateLimiter } from '../../src/rate-limiter.js';
import { createTestApp } from '../helpers/test-app.js';
const databaseURL=process.env.TEST_DATABASE_URL!,database=createDatabase(databaseURL);
const sql=new Client({connectionString:databaseURL});
const authService=new AuthService({repository:database.authRepository,passwordResetDelivery:new NoopPasswordResetDelivery(),
  accessTokenSecret:'step08-acceptance-secret-at-least-32-characters',accessTokenTTLSeconds:900,refreshTokenTTLSeconds:2592000,passwordResetTTLSeconds:900});
const tokens={accessToken:'provider-test-access',refreshToken:'provider-test-refresh',expiresAt:2_000_000_000,athleteID:'42',athleteName:'Test Runner'};
const provider={authorizationURL:(state:string)=>`https://www.strava.com/oauth/mobile/authorize?state=${state}`,exchange:vi.fn().mockResolvedValue(tokens),
  refresh:vi.fn().mockResolvedValue({...tokens,accessToken:'new-provider-access',refreshToken:'new-provider-refresh'}),activities:vi.fn<()=>Promise<StravaActivity[]>>().mockResolvedValue([]),revoke:vi.fn().mockResolvedValue(undefined)};
const service=new StravaService(database.stravaRepository,provider,new StravaTokenCipher(Buffer.alloc(32,18).toString('base64')));
let server:Server,baseURL:string;
beforeAll(async()=>{await sql.connect();server=createServer(createTestApp({database,authService,stravaService:service,authRateLimiter:new InMemoryRateLimiter(60000,100)}));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address || typeof address==='string')throw new Error('No test server');baseURL=`http://127.0.0.1:${address.port}`;});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await database.disconnect();await sql.end();});
const run=(action:string,journal?:string,output?:(message:string)=>void)=>verifyStep08({databaseURL,baseURL,local:true,action,journal,output:output ?? (()=>{})});
async function prepare():Promise<{journal:string;userID:string;password:string;messages:string[]}>{
  const messages:string[]=[];await run('prepare',undefined,line=>messages.push(line));
  const journal=messages.find(line=>line.startsWith('Private login/recovery journal: '))!.split(': ')[1]!;
  const state=JSON.parse(await readFile(journal,'utf8')) as {userID:string;password:string};
  return {journal,userID:state.userID,password:state.password,messages};
}
describe('Step 08 staging acceptance journal and cleanup',()=>{
  it('runs private preparation, connect, expiry, repeated refresh, revoke and exact cleanup over HTTP and SQL',async()=>{
    const fixture=await prepare();
    expect((await stat(fixture.journal)).mode & 0o777).toBe(0o600);expect(fixture.messages.join('\n')).not.toContain(fixture.password);
    try{
      const flow=await service.start(fixture.userID);await service.callback(flow.state,'test-code','read,activity:read');
      await run('connected',fixture.journal);await run('expire',fixture.journal);await run('refresh',fixture.journal);
      const messages:string[]=[];await run('disconnect',fixture.journal,line=>messages.push(line));
      expect(messages.some(line=>line.startsWith('NOT VERIFIED old-provider-token-401'))).toBe(true);
      await run('cleanup',fixture.journal);
      await expect(access(fixture.journal)).rejects.toThrow();
      expect((await sql.query('SELECT 1 FROM users WHERE id=$1',[fixture.userID])).rowCount).toBe(0);
      expect(provider.revoke).toHaveBeenLastCalledWith('new-provider-refresh');
    }finally{await sql.query('DELETE FROM users WHERE id=$1',[fixture.userID]);await rm(fixture.journal,{force:true});}
  },30000);
  it('accepts ordinary title text and saves encrypted revocation evidence without forcing expiry',async()=>{
    const fixture=await prepare();
    try{
      provider.activities.mockResolvedValueOnce([{id:'123',title:'Latitude and longitude run',sport:'Run',startedAt:'2026-09-14T01:00:00.000Z',durationSeconds:3600,distanceMeters:10000}]);
      const flow=await service.start(fixture.userID);await service.callback(flow.state,'test-code','read,activity:read');
      await run('connected',fixture.journal);
      const journal=JSON.parse(await readFile(fixture.journal,'utf8')) as {oldAccessEncrypted:string};
      expect(new StravaTokenCipher(Buffer.alloc(32,18).toString('base64')).decrypt(journal.oldAccessEncrypted,fixture.userID,'access')).toBe(tokens.accessToken);
      await run('cleanup',fixture.journal);
    }finally{await service.disconnect(fixture.userID);await sql.query('DELETE FROM users WHERE id=$1',[fixture.userID]);await rm(fixture.journal,{force:true});}
  },30000);
  it('preserves the fixture and journal until a failed external revoke recovers',async()=>{
    const fixture=await prepare();
    try{
      const flow=await service.start(fixture.userID);await service.callback(flow.state,'test-code','read,activity:read');
      provider.revoke.mockRejectedValueOnce(new StravaError(502,'strava_unavailable','Unavailable.'));
      await expect(run('cleanup',fixture.journal)).rejects.toThrow('provider-revoke-confirmed-not-pending');
      expect((await sql.query('SELECT 1 FROM users WHERE id=$1',[fixture.userID])).rowCount).toBe(1);await access(fixture.journal);
      await run('cleanup',fixture.journal);await expect(access(fixture.journal)).rejects.toThrow();
    }finally{provider.revoke.mockResolvedValue(undefined);await service.disconnect(fixture.userID);await sql.query('DELETE FROM users WHERE id=$1',[fixture.userID]);await rm(fixture.journal,{force:true});}
  },30000);
  it('refuses a tampered journal and unrelated safety evidence without deleting the owner',async()=>{
    const fixture=await prepare(),original=await readFile(fixture.journal,'utf8');
    try{
      const state=JSON.parse(original) as Record<string,unknown>;
      await writeFile(fixture.journal,JSON.stringify({...state,email:'real-user@example.com'}));
      await expect(run('cleanup',fixture.journal)).rejects.toThrow('not a Step 08 fixture');
      await writeFile(fixture.journal,original);
      await sql.query(`INSERT INTO safety_audit_events(id,actor_id,action,request_id) VALUES(gen_random_uuid(),$1,'block',gen_random_uuid())`,[fixture.userID]);
      await expect(run('cleanup',fixture.journal)).rejects.toThrow('unrelated data');
      expect((await sql.query('SELECT 1 FROM users WHERE id=$1',[fixture.userID])).rowCount).toBe(1);await access(fixture.journal);
      await sql.query('DELETE FROM safety_audit_events WHERE actor_id=$1',[fixture.userID]);await run('cleanup',fixture.journal);
    }finally{await sql.query('DELETE FROM safety_audit_events WHERE actor_id=$1',[fixture.userID]);await sql.query('DELETE FROM users WHERE id=$1',[fixture.userID]);await rm(fixture.journal,{force:true});}
  },30000);
});
