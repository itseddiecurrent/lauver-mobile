import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { Client } from 'pg';
import { z } from 'zod';
import { acceptanceConnectionURL, validateAcceptanceTarget } from './verify-step-06-staging.js';

const origin = 'https://lauver-api-staging.onrender.com';
const stateSchema = z.object({ version: z.literal(1), runId: z.string().regex(/^[a-f0-9]{32}$/),
  baseURL: z.string(), databaseName: z.string(), emails: z.array(z.email()).length(3) }).strict();
type Session = { accessToken: string; user: { id: string } };
export async function verifyStep07(options: { databaseURL: string; baseURL?: string; local?: boolean; cleanupState?: string; signal?: AbortSignal; output?: (message: string) => void }): Promise<{ checks: number; deletedAccounts: number }> {
  const baseURL = options.baseURL ?? origin;
  const databaseName = validateAcceptanceTarget(options.databaseURL, baseURL, options.local);
  const output = options.output ?? console.log;
  const connection = { connectionString: acceptanceConnectionURL(options.databaseURL, options.local), connectionTimeoutMillis: 5000, statement_timeout: 15000 };
  const withSQL = async <T>(work: (client: Client) => Promise<T>): Promise<T> => {
    const client = new Client(connection); client.on('error', () => {});
    try { await client.connect(); return await work(client); } finally { await client.end().catch(() => undefined); }
  };
  let state: z.infer<typeof stateSchema> | undefined;
  let statePath = options.cleanupState;
  let viewer: Session | undefined;
  let checks = 0, deletedAccounts = 0;
  const check = (value: boolean, label: string) => { if (!value) throw new Error(label); checks++; output('PASS ' + label); };
  const call = async (method: string, route: string, session?: Session, body?: unknown, cleanup = false) => {
    const response = await fetch(baseURL + route, { method, redirect: 'error',
      headers: { ...(session ? { Authorization: 'Bearer ' + session.accessToken } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([AbortSignal.timeout(20000), ...(!cleanup && options.signal ? [options.signal] : [])]) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} };
  };
  let failure: unknown;
  try {
    if (statePath) {
      const candidate = stateSchema.parse(JSON.parse(await readFile(statePath,'utf8')));
      if (candidate.baseURL !== baseURL || candidate.databaseName !== databaseName || new Set(candidate.emails).size !== 3 ||
          candidate.emails.some((email,n) => email !== `step07-${candidate.runId}-${n}@example.com`)) throw new Error('Invalid cleanup journal');
      state = candidate;
    } else {
      check((await call('GET','/readyz')).status === 200,'staging-ready');
      check((await call('GET','/v1/blocks')).status === 401,'safety-deployed-and-authenticated');
      await withSQL(client => client.query('SELECT snapshot FROM reports LIMIT 0'));
      const runId = randomBytes(16).toString('hex');
      const prepared = { version: 1 as const, runId, baseURL, databaseName, emails: [0,1,2].map(n=>`step07-${runId}-${n}@example.com`) };
      const directory = path.join(os.tmpdir(),'lauver-step07-'+runId);
      await mkdir(directory,{mode:0o700}); statePath = path.join(directory,'cleanup.json');
      await writeFile(statePath,JSON.stringify(prepared),{mode:0o600,flag:'wx'}); state=prepared;
      output('Recovery journal: '+statePath);
      const password = 'Step07Validation9-'+randomBytes(24).toString('hex');
      const sessions: Session[] = [];
      for (let n=0;n<3;n++) {
        const response = await call('POST','/v1/auth/register',undefined,{email:state.emails[n],password});
        check(response.status===201,'register-fixture-'+n);
        const session = response.body as unknown as Session; sessions.push(session);
        if (n===0) viewer=session;
        check((await withSQL(client=>client.query('SELECT 1 FROM auth_identities WHERE provider_subject=$1 AND user_id=$2',[state!.emails[n],session.user.id]))).rowCount===1,'api-database-target-match-'+n);
        check((await call('PATCH','/v1/me',session,{displayName:'Step 07 '+n,bio:'Original evidence',
          city:{name:'Step 07 Test City',regionCode:null,countryCode:'CN',latitude:0,longitude:70},
          sports:[{sport:'running',paceValue:5.5}],trainingTimes:[{weekday:1,timeBucket:'morning'}]})).status===200,'complete-profile-'+n);
      }
      const a=sessions[0]!,b=sessions[1]!,c=sessions[2]!;
      const profile = '/v1/users/'+b.user.id;
      check((await call('GET',profile,a)).status===200,'public-profile-before-block');
      check((await call('POST','/v1/blocks/'+b.user.id,a)).status===204,'block-user');
      check((await call('POST','/v1/blocks/'+b.user.id,a)).status===204,'repeat-block-idempotent');
      check((await call('GET',profile,a)).status===404,'outgoing-block-profile-hidden');
      check((await call('GET','/v1/users/'+a.user.id,b)).status===404,'incoming-block-profile-hidden');
      for (const [session,target,label] of [[a,b,'outgoing'],[b,a,'incoming']] as const) {
        const page=await call('GET','/v1/discover?radius=10',session);
        check(page.status===200 && !(page.body.users as {id:string}[]).some(u=>u.id===target.user.id),label+'-block-discover-hidden');
      }
      const blocked=await call('GET','/v1/blocks',a);
      check((blocked.body.users as {id:string}[]).some(u=>u.id===b.user.id),'blocked-list-owned-entry');
      const reverseList = await call('GET','/v1/blocks',b);
      check(reverseList.status === 200 && Array.isArray(reverseList.body.users) && reverseList.body.users.length===0,'blocked-list-caller-isolation');
      check((await call('DELETE','/v1/blocks/'+a.user.id,b)).status===204 && (await call('GET',profile,a)).status===404,'unblock-cannot-remove-reverse-block');
      check((await call('DELETE','/v1/blocks/'+b.user.id,a)).status===204 && (await call('GET',profile,a)).status===200,'unblock-restores-profile');
      check((await call('POST','/v1/blocks/'+a.user.id,a)).status===422,'self-block-rejected');
      const body={targetType:'user',targetId:b.user.id,reason:'harassment',details:'Acceptance evidence'};
      const report=await call('POST','/v1/reports',a,body);
      check(report.status===201 && typeof report.body.referenceId==='string' && report.body.blockedUser===false,'report-reference-without-auto-block');
      check((await call('GET',profile,a)).status===200,'report-alone-keeps-profile-access');
      check((await call('PATCH','/v1/me',b,{bio:'Changed after report'})).status===200,'edit-target-after-report');
      const stored=await withSQL(client=>client.query<{snapshot:Record<string,unknown>;request_id:string;status:string}>('SELECT snapshot,request_id,status FROM reports WHERE id=$1',[report.body.referenceId]));
      check(stored.rows[0]?.snapshot.bio==='Original evidence' && stored.rows[0].status==='open' && typeof stored.rows[0].request_id==='string','immutable-snapshot-open-queue-and-audit');
      check(!/latitude|longitude|photoKey|email|password/.test(JSON.stringify(stored.rows[0]?.snapshot)),'snapshot-coordinate-and-secret-privacy');
      const repeat=await call('POST','/v1/reports',a,{...body,details:'New evidence'});
      check(repeat.status===201 && repeat.body.referenceId!==report.body.referenceId,'repeat-target-preserves-new-evidence');
      const combined=await call('POST','/v1/reports',a,{...body,blockUser:true});
      check(combined.status===201 && combined.body.blockedUser===true && (await call('GET',profile,a)).status===404,'atomic-report-and-block');
      check((await call('POST','/v1/reports',a,{...body,targetId:c.user.id,targetType:'event'})).status===422,'unsupported-target-type-rejected');
      check((await call('POST','/v1/reports',a,{...body,reporterId:c.user.id})).status===422,'forged-reporter-rejected');
      check((await call('POST','/v1/reports',a,{...body,targetId:a.user.id})).status===422,'self-report-rejected');
    }
  } catch(error) {failure=error; output('FAIL acceptance; cleaning this run');}
  finally {
    if(state && statePath) {
      try {
        deletedAccounts=await withSQL(async client=>{
          await client.query('BEGIN');
          try {
            const owned=await client.query<{id:string;photo_key:string|null;providers:string[]}> (`SELECT u.id,p.photo_key,
              ARRAY(SELECT provider::text FROM auth_identities other WHERE other.user_id=u.id) AS providers
              FROM users u JOIN auth_identities ai ON ai.user_id=u.id LEFT JOIN profiles p ON p.user_id=u.id
              WHERE ai.provider_subject=ANY($1::text[]) FOR UPDATE OF u`,[state!.emails]);
            if(owned.rows.some(row=>row.photo_key!==null || row.providers.length!==1 || row.providers[0]!=='EMAIL')) throw new Error('Fixture acquired external data');
            const ids=owned.rows.map(row=>row.id);
            for(const id of [...ids].sort()){
              const locked=await client.query<{locked:boolean}>('SELECT pg_try_advisory_xact_lock(hashtextextended($1,8)) AS locked',[id]);
              if(!locked.rows[0]!.locked)throw new Error('Fixture has a Strava operation in progress; retry cleanup');
            }
            const stravaTable=await client.query<{present:boolean}>("SELECT to_regclass('public.strava_connections') IS NOT NULL AS present");
            if(stravaTable.rows[0]!.present && (await client.query('SELECT 1 FROM strava_connections WHERE user_id=ANY($1::uuid[]) LIMIT 1',[ids])).rowCount) throw new Error('Fixture acquired Strava credentials; revoke the grant before cleanup');
            if((await client.query('SELECT 1 FROM profile_photo_uploads WHERE user_id=ANY($1::uuid[]) LIMIT 1',[ids])).rowCount) throw new Error('Fixture acquired upload data');
            const foreign=await client.query(`SELECT 1 FROM reports WHERE target_user_id=ANY($1::uuid[]) AND (reporter_id IS NULL OR NOT reporter_id=ANY($1::uuid[])) LIMIT 1`,[ids]);
            if(foreign.rowCount) throw new Error('Fixture acquired external evidence');
            if((await client.query(`SELECT 1 FROM reports WHERE reporter_id=ANY($1::uuid[]) AND (source<>'profile' OR target_user_id IS NULL OR NOT target_user_id=ANY($1::uuid[])) LIMIT 1`,[ids])).rowCount) throw new Error('Fixture acquired unrelated evidence');
            if((await client.query(`SELECT 1 FROM safety_audit_events WHERE target_id=ANY($1::uuid[]) AND (actor_id IS NULL OR NOT actor_id=ANY($1::uuid[])) LIMIT 1`,[ids])).rowCount) throw new Error('Fixture acquired unrelated audit data');
            const identities = await client.query<{id:string}>('SELECT id FROM auth_identities WHERE user_id=ANY($1::uuid[])',[ids]);
            await client.query('DELETE FROM safety_audit_events WHERE actor_id=ANY($1::uuid[])',[ids]);
            await client.query('DELETE FROM reports WHERE reporter_id=ANY($1::uuid[])',[ids]);
            const deleted=await client.query('DELETE FROM users WHERE id=ANY($1::uuid[]) RETURNING id',[ids]);
            for(const table of ['profiles','user_sports','training_times','sessions','auth_identities','email_tokens']) {
              if((await client.query(`SELECT 1 FROM ${table} WHERE user_id=ANY($1::uuid[]) LIMIT 1`,[ids])).rowCount) throw new Error('Cascade cleanup failed');
            }
            if((await client.query('SELECT 1 FROM password_credentials WHERE identity_id=ANY($1::uuid[]) LIMIT 1',[identities.rows.map(row=>row.id)])).rowCount) throw new Error('Credentials remain');
            if((await client.query('SELECT 1 FROM blocks WHERE blocker_id=ANY($1::uuid[]) OR blocked_id=ANY($1::uuid[]) LIMIT 1',[ids])).rowCount) throw new Error('Blocks remain');
            await client.query('COMMIT'); return deleted.rowCount??0;
          } catch(error) {await client.query('ROLLBACK');throw error;}
        });
        if(viewer) check((await call('GET','/v1/auth/session',viewer,undefined,true)).status===401,'deleted-fixture-session-invalid');
        await rm(statePath); output(`PASS cleanup: ${deletedAccounts} fixtures, reports, safety audit and dependent data deleted`);
      } catch {failure=new Error('Cleanup failed');output('CLEANUP FAILED; retry --cleanup-state '+statePath);}
    }
  }
  if(failure) throw new Error('Step 07 acceptance failed; cleanup was attempted');
  return {checks,deletedAccounts};
}

async function main(): Promise<void> {
  config({path:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.env.staging'),quiet:true});
  const {values}=parseArgs({options:{'cleanup-state':{type:'string'},local:{type:'boolean',default:false}}});
  const databaseURL=process.env.STAGING_DATABASE_URL;
  if(!databaseURL) throw new Error('Set STAGING_DATABASE_URL in backend/.env.staging');
  const controller=new AbortController(); const interrupt=()=>controller.abort();
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  try {console.log(JSON.stringify({result:'passed',...await verifyStep07({databaseURL,baseURL:process.env.STEP07_API_BASE_URL,local:values.local,cleanupState:values['cleanup-state'],signal:controller.signal})}));}
  finally {process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(()=>{console.error('Step 07 acceptance failed. Check staging configuration; any created fixtures were scheduled for cleanup.');process.exitCode=1;});
}
