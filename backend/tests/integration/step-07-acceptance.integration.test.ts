import { createServer, type Server } from 'node:http';
import { mkdtemp, access, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyStep07 } from '../../scripts/verify-step-07-staging.js';
import { AuthService, NoopPasswordResetDelivery } from '../../src/auth.js';
import { createDatabase } from '../../src/database.js';
import { DiscoverService } from '../../src/discover.js';
import { ProfileService } from '../../src/profile.js';
import { UnavailableProfilePhotoStorage } from '../../src/object-storage.js';
import { createTestApp } from '../helpers/test-app.js';

const databaseURL = process.env.TEST_DATABASE_URL!;
const database = createDatabase(databaseURL);
const sql = new Client({ connectionString: databaseURL });
const storage = new UnavailableProfilePhotoStorage();
const authService = new AuthService({ repository: database.authRepository, passwordResetDelivery: new NoopPasswordResetDelivery(),
  accessTokenSecret: 'step07-acceptance-integration-secret-at-least-32', accessTokenTTLSeconds: 900,
  refreshTokenTTLSeconds: 2592000, passwordResetTTLSeconds: 900 });
let server: Server, baseURL: string;
let failDiscovery = false;
const discover = new DiscoverService(database.discoverRepository,storage,'step07-integration-cursor-secret');
beforeAll(async () => {
  await sql.connect();
  server = createServer(createTestApp({ database,authService,safetyService:database.safetyService,
    profileService:new ProfileService({repository:database.profileRepository,storage}),
    discoverService:{discover:(userId,query)=>failDiscovery?Promise.reject(new Error('Test failure')):discover.discover(userId,query)} }));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address || typeof address==='string') throw new Error('No local server address');
  baseURL=`http://127.0.0.1:${address.port}`;
});
afterAll(async()=>{
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  await database.disconnect();await sql.end();
});
async function assertClean(): Promise<void> {
  expect((await sql.query(`SELECT 1 FROM auth_identities WHERE provider_subject LIKE 'step07-%@example.com'`)).rowCount).toBe(0);
  expect((await sql.query(`SELECT 1 FROM reports WHERE snapshot->>'displayName' LIKE 'Step 07 %'`)).rowCount).toBe(0);
}
describe('Step 07 HTTP verifier and recovery safety',()=>{
  it('verifies all real HTTP operations and cleans reports, sessions and fixtures',async()=>{
    const result=await verifyStep07({databaseURL,baseURL,local:true,output:()=>{}});
    expect(result.checks).toBeGreaterThan(25);expect(result.deletedAccounts).toBe(3);await assertClean();
  },30000);
  it('cleans all fixtures after an HTTP failure',async()=>{
    failDiscovery=true;
    try {await expect(verifyStep07({databaseURL,baseURL,local:true,output:()=>{}})).rejects.toThrow();await assertClean();}
    finally{failDiscovery=false;}
  },30000);
  it('cleans created fixtures after interruption',async()=>{
    const controller=new AbortController();
    await expect(verifyStep07({databaseURL,baseURL,local:true,signal:controller.signal,
      output:line=>{if(line==='PASS complete-profile-0') controller.abort();}})).rejects.toThrow();
    await assertClean();
  },30000);
  it('rejects forged cleanup emails without deleting an unrelated user, and supports empty recovery',async()=>{
    const directory=await mkdtemp(path.join(os.tmpdir(),'lauver-step07-journal-test-'));
    const statePath=path.join(directory,'cleanup.json');
    const runId='a'.repeat(32);
    const sentinelId='e1700000-0000-4000-8000-000000000999';
    await sql.query(`INSERT INTO users(id,updated_at) VALUES($1,now())`,[sentinelId]);
    await sql.query(`INSERT INTO auth_identities(id,user_id,provider,provider_subject,updated_at) VALUES($1,$2,'EMAIL','owner@example.com',now())`,['e1700000-0000-4000-8000-000000000998',sentinelId]);
    const state={version:1,runId,baseURL,databaseName:new URL(databaseURL).pathname.slice(1),emails:[0,1,2].map(n=>`step07-${runId}-${n}@example.com`)};
    try{
      await writeFile(statePath,JSON.stringify({...state,emails:['owner@example.com',...state.emails.slice(1)]}));
      await expect(verifyStep07({databaseURL,baseURL,local:true,cleanupState:statePath,output:()=>{}})).rejects.toThrow();
      await access(statePath);
      expect((await sql.query('SELECT 1 FROM users WHERE id=$1',[sentinelId])).rowCount).toBe(1);
      await writeFile(statePath,JSON.stringify(state));
      expect((await verifyStep07({databaseURL,baseURL,local:true,cleanupState:statePath,output:()=>{}})).deletedAccounts).toBe(0);
      await expect(access(statePath)).rejects.toThrow();
      await assertClean();
    }finally{await sql.query('DELETE FROM users WHERE id=$1',[sentinelId]);await rm(directory,{recursive:true,force:true});}
  });
});
