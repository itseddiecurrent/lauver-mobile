import { createHash, randomBytes } from 'node:crypto';
import { mkdir,readFile,rm,writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { Client } from 'pg';
import { z } from 'zod';
import { acceptanceConnectionURL,validateAcceptanceTarget } from './verify-step-06-staging.js';
import { StravaTokenCipher } from '../src/strava-provider.js';

const stagingOrigin='https://lauver-api-staging.onrender.com';
const journalSchema=z.object({version:z.literal(1),runId:z.string().regex(/^[a-f0-9]{32}$/),email:z.email(),password:z.string().min(12),
  oldRefreshDigest:z.string().regex(/^[a-f0-9]{64}$/).optional(),oldAccessEncrypted:z.string().optional(),userID:z.uuid().optional()}).strict();
type Journal=z.infer<typeof journalSchema>;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const statusSchema=z.object({
  status:z.enum(['disabled','disconnected','connected','revocation_pending','reconnect_required']),
  athleteName:z.string().nullable(),lastSyncedAt:z.iso.datetime({offset:true}).nullable(),
  scopes:z.array(z.string()),activities:z.array(z.object({
    id:z.string().regex(/^[1-9][0-9]*$/),title:z.string(),sport:z.string(),startedAt:z.iso.datetime({offset:true}),
    durationSeconds:z.number().int().nonnegative(),distanceMeters:z.number().finite().nonnegative(),
  }).strict()).max(20),
}).strict();

// Multi-command manual acceptance; no provider code/token is printed. Registration
// is journalled first, and cleanup must confirm revoke before deleting the fixture.
export async function verifyStep08(options:{databaseURL:string;baseURL?:string;local?:boolean;action?:string;journal?:string;tokenEncryptionKey?:string;output?:(message:string)=>void}):Promise<void>{
  const action=z.enum(['prepare','connected','expire','refresh','disconnect','cleanup']).parse(options.action ?? 'prepare');
  const baseURL=options.baseURL ?? stagingOrigin;
  validateAcceptanceTarget(options.databaseURL,baseURL,options.local);
  const output=options.output ?? console.log;
  const sql=new Client({connectionString:acceptanceConnectionURL(options.databaseURL,options.local),connectionTimeoutMillis:5000,statement_timeout:15000});
  sql.on('error',()=>{});
  const assert=(condition:unknown,label:string)=>{
    if(!condition){output('FAIL '+label);throw new Error(label);}
    output('PASS '+label);
  };
  const api=async(route:string,method='GET',token?:string,body?:unknown)=>{
    const response=await fetch(baseURL+route,{method,redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,body:await response.json() as Record<string,unknown>};
  };
  let journalPath=options.journal;
  let journal:Journal;
  try{
    await sql.connect();
    await sql.query('SELECT user_id FROM strava_connections LIMIT 0');
    if(action==='prepare'){
      if(journalPath)throw new Error('Prepare creates a new private journal; do not supply --journal');
      assert((await api('/readyz')).status===200,'staging-ready');
      assert((await api('/v1/integrations/strava/status')).status===401,'strava-deployed-and-authenticated');
      const runId=randomBytes(16).toString('hex');
      journal={version:1,runId,email:`step08-${runId}@example.com`,password:'Step08Test9-'+randomBytes(24).toString('hex')};
      const directory=path.join(os.tmpdir(),'lauver-step08-'+runId);await mkdir(directory,{mode:0o700});
      journalPath=path.join(directory,'private.json');
      await writeFile(journalPath,JSON.stringify(journal,null,2),{mode:0o600,flag:'wx'});
      output('Private login/recovery journal: '+journalPath);
      const registered=await api('/v1/auth/register','POST',undefined,{email:journal.email,password:journal.password});
      assert(registered.status===201,'register-private-fixture');
    }else{
      if(!journalPath)throw new Error('Supply --journal /private/path/from/prepare');
      journal=journalSchema.parse(JSON.parse(await readFile(journalPath,'utf8')));
    }
    if(journal.email!==`step08-${journal.runId}@example.com`)throw new Error('Journal is not a Step 08 fixture');
    const owned=await sql.query<{id:string;providers:string[];photo_key:string|null}>(`SELECT u.id,p.photo_key,
      ARRAY(SELECT provider::text FROM auth_identities other WHERE other.user_id=u.id) AS providers
      FROM users u JOIN auth_identities ai ON ai.user_id=u.id LEFT JOIN profiles p ON p.user_id=u.id WHERE ai.provider_subject=$1`,[journal.email]);
    if(owned.rowCount===0 && action==='cleanup'){
      await rm(journalPath);output('PASS already-cleaned-fixture');return;
    }
    const row=owned.rows[0];
    assert(owned.rowCount===1 && row && row.providers.length===1 && row.providers[0]==='EMAIL','exact-fixture-database-owner');
    const userID=row!.id;
    if(journal.userID && journal.userID!==userID)throw new Error('Journal owner changed; refusing operation');
    journal.userID=userID;
    await writeFile(journalPath,JSON.stringify(journal,null,2),{mode:0o600});
    const loggedIn=await api('/v1/auth/login','POST',undefined,{email:journal.email,password:journal.password});
    assert(loggedIn.status===200 && (loggedIn.body.user as {id?:string})?.id===userID,'fixture-session');
    const token=z.string().parse(loggedIn.body.accessToken);
    const refreshToken=z.string().parse(loggedIn.body.refreshToken);
    try{
      const getStatus=async()=>{
        const response=await api('/v1/integrations/strava/status','GET',token);
        assert(response.status===200,'strava-status');return statusSchema.parse(response.body);
      };
      if(action==='prepare'){
        assert((await getStatus()).status==='disconnected','strava-enabled-and-disconnected');
        output('Use the email/password in the private journal to log in on iPhone, then Connect Strava.');
      }
      if(action==='connected' || action==='expire'){
        const status=await getStatus();assert(status.status==='connected','real-strava-connected');
        assert(new Set(status.scopes).size===2 && status.scopes.includes('read') && status.scopes.includes('activity:read'),'actual-read-only-scopes');
        // Validate field names and types, not user-authored activity titles.
        assert(statusSchema.safeParse(status).success,'bounded-private-summaries');
        const credentials=await sql.query<{refresh_token_encrypted:string;access_token_encrypted:string}>('SELECT refresh_token_encrypted,access_token_encrypted FROM strava_connections WHERE user_id=$1',[userID]);
        journal.oldAccessEncrypted=credentials.rows[0]!.access_token_encrypted;
        await writeFile(journalPath,JSON.stringify(journal,null,2),{mode:0o600});
        if(action==='expire'){
          journal.oldRefreshDigest=digest(credentials.rows[0]!.refresh_token_encrypted);
          await writeFile(journalPath,JSON.stringify(journal,null,2),{mode:0o600});
          await sql.query('UPDATE strava_connections SET expires_at=1 WHERE user_id=$1',[userID]);
          assert(true,'expired-only-owned-fixture-access-token');
        }
      }
      if(action==='refresh'){
        const first=await api('/v1/integrations/strava/sync','POST',token);
        assert(first.status===200 && first.body.status==='connected','real-provider-refresh-and-sync');
        if(journal.oldRefreshDigest){
          const credentials=await sql.query<{refresh_token_encrypted:string;expires_at:string}>('SELECT refresh_token_encrypted,expires_at FROM strava_connections WHERE user_id=$1',[userID]);
          assert(digest(credentials.rows[0]!.refresh_token_encrypted)!==journal.oldRefreshDigest && Number(credentials.rows[0]!.expires_at)>Date.now()/1000,'newest-encrypted-credentials-persisted');
        }
        assert((await api('/v1/integrations/strava/sync','POST',token)).status===200,'repeat-sync');
        const counts=await sql.query<{total:number;unique_count:number}>('SELECT count(*)::int AS total,count(DISTINCT provider_activity_id)::int AS unique_count FROM strava_activities WHERE user_id=$1',[userID]);
        assert(counts.rows[0]!.total===counts.rows[0]!.unique_count && counts.rows[0]!.total<=20,'idempotent-summary-window');
      }
      if(action==='disconnect' || action==='cleanup'){
        const result=await api('/v1/integrations/strava/disconnect','POST',token);
        assert(result.status===200 && result.body.status==='disconnected','provider-revoke-confirmed-not-pending');
        for(const table of ['strava_connections','strava_activities','strava_oauth_states'])assert((await sql.query(`SELECT 1 FROM ${table} WHERE user_id=$1`,[userID])).rowCount===0,table+'-cleared');
        if(journal.oldAccessEncrypted && options.tokenEncryptionKey){
          const oldToken=new StravaTokenCipher(options.tokenEncryptionKey).decrypt(journal.oldAccessEncrypted,userID,'access');
          const revoked=await fetch('https://www.strava.com/api/v3/athlete',{headers:{Authorization:'Bearer '+oldToken},redirect:'error',signal:AbortSignal.timeout(15000)});
          await revoked.body?.cancel();assert(revoked.status===401,'old-provider-access-token-401');
        }else output('NOT VERIFIED old-provider-token-401; requires saved encrypted token and server-side encryption key (run in Render).');
        if(action==='cleanup'){
          await sql.query('BEGIN');
          try{
            const locked=await sql.query<{locked:boolean}>('SELECT pg_try_advisory_xact_lock(hashtextextended($1,8)) AS locked',[userID]);
            if(!locked.rows[0]!.locked)throw new Error('Strava operation in progress; keep the journal and retry cleanup');
            const safe=await sql.query(`SELECT 1 FROM users u JOIN auth_identities ai ON ai.user_id=u.id LEFT JOIN profiles p ON p.user_id=u.id
              WHERE u.id=$1 AND ai.provider_subject=$2 AND ai.provider='EMAIL' AND p.photo_key IS NULL
              AND (SELECT count(*) FROM auth_identities x WHERE x.user_id=u.id)=1
              AND NOT EXISTS(SELECT 1 FROM profile_photo_uploads x WHERE x.user_id=u.id)
              AND NOT EXISTS(SELECT 1 FROM strava_connections x WHERE x.user_id=u.id)
              AND NOT EXISTS(SELECT 1 FROM strava_oauth_states x WHERE x.user_id=u.id)
              AND NOT EXISTS(SELECT 1 FROM reports x WHERE x.reporter_id=u.id OR x.target_user_id=u.id)
              AND NOT EXISTS(SELECT 1 FROM safety_audit_events x WHERE x.actor_id=u.id OR x.target_id=u.id)
              AND NOT EXISTS(SELECT 1 FROM blocks x WHERE x.blocker_id=u.id OR x.blocked_id=u.id) FOR UPDATE OF u`,[userID,journal.email]);
            if(safe.rowCount!==1)throw new Error('Fixture acquired unrelated data; refusing deletion');
            await sql.query('DELETE FROM users WHERE id=$1',[userID]);await sql.query('COMMIT');
          }catch(error){await sql.query('ROLLBACK');throw error;}
          assert((await api('/v1/auth/session','GET',token)).status===401,'deleted-session-invalid');
          await rm(journalPath);output('PASS fixture-and-private-journal-cleaned');
        }
      }
    }finally{await api('/v1/auth/logout','POST',undefined,{refreshToken}).catch(()=>undefined);}
  }finally{await sql.end().catch(()=>undefined);}
}
async function main():Promise<void>{
  config({path:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.env.staging'),quiet:true});
  const {values}=parseArgs({options:{action:{type:'string',default:'prepare'},journal:{type:'string'}}});
  const databaseURL=process.env.STAGING_DATABASE_URL ?? (process.env.NODE_ENV==='staging'?process.env.DATABASE_URL:undefined);
  if(!databaseURL)throw new Error('Set STAGING_DATABASE_URL in the ignored backend/.env.staging file');
  await verifyStep08({databaseURL,action:values.action,journal:values.journal,tokenEncryptionKey:process.env.STRAVA_TOKEN_ENCRYPTION_KEY});
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(()=>{console.error('Step 08 staging command failed. Keep the private journal and retry; no credentials are printed.');process.exitCode=1;});
}
