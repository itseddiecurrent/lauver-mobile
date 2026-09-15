import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { config } from 'dotenv';
import { Client } from 'pg';
import { acceptanceConnectionURL, validateAcceptanceTarget } from './verify-step-06-staging.js';

// Session bodies and provider errors must never be logged. Keep recovery state outside the repo.
const baseURL = 'https://lauver-api-staging.onrender.com';
type Session = { accessToken: string; refreshToken: string; user: { id: string } };
type ProfileResponse = { profile: { isComplete: boolean } };
type ChannelResponse = { channelType: string; channelId: string; members: string[] };
type ReportRow = { reporter_id: string; target_user_id: string; source: string; status: string; request_id: string; snapshot: Record<string, unknown> };
type State = { email: string; password: string; session?: Session; channelId?: string; messageId?: string; referenceId?: string; sendId: string };
const firstPath = process.argv[2];
const statePath = process.argv[3];
let stage = 'configuration';
const checks: string[] = [];
function check(ok: unknown, label: string): asserts ok {
  if (!ok) throw new Error('Check failed');
  checks.push(label);
  console.log('PASS ' + label);
}
async function call<T = Record<string, unknown>>(method: string, route: string, session?: Session, body?: unknown) {
  const response = await fetch(baseURL + route, {
    method, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.accessToken } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return await response.json() as T;
}
async function save(file: string, value: unknown) {
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
  await chmod(file, 0o600);
}
async function current(session: Session, file: string, state?: State): Promise<Session> {
  try { await call('GET', '/v1/auth/session', session); return session; }
  catch (error) {
    if (!(error instanceof Error) || error.message !== 'HTTP 401') throw error;
    const fresh = await call<Session>('POST', '/v1/auth/refresh', undefined, { refreshToken: session.refreshToken });
    await save(file, state ? { ...state, session: fresh } : fresh);
    return fresh;
  }
}
async function main() {
  if (!firstPath?.startsWith('/tmp/') || !statePath?.startsWith('/tmp/') || firstPath === statePath) throw new Error('Configuration');
  config({ path: '.env.staging', quiet: true });
  const databaseURL = process.env.STAGING_DATABASE_URL!;
  validateAcceptanceTarget(databaseURL, baseURL);
  await chmod(firstPath, 0o600);
  stage = 'first-user-session';
  const a = await current(JSON.parse(await readFile(firstPath, 'utf8')) as Session, firstPath);
  check((await call<ProfileResponse>('GET', '/v1/me', a)).profile.isComplete === true, 'first-user-profile-complete');
  let state: State;
  try { state = JSON.parse(await readFile(statePath, 'utf8')) as State; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    state = { email: `step10-${randomBytes(12).toString('hex')}@example.com`, password: 'Step10Validation9-' + randomBytes(24).toString('hex'), sendId: randomUUID() };
    await writeFile(statePath, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  }
  stage = 'second-user-registration';
  if (!state.session) {
    try { state.session = await call<Session>('POST', '/v1/auth/register', undefined, { email: state.email, password: state.password }); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'HTTP 409') throw error;
      state.session = await call<Session>('POST', '/v1/auth/login', undefined, { email: state.email, password: state.password });
    }
    await save(statePath, state);
  }
  const b = await current(state.session, statePath, state);
  state.session = b;
  check(a.user.id !== b.user.id, 'second-user-distinct');
  stage = 'second-user-profile';
  const profile = await call<ProfileResponse>('PATCH', '/v1/me', b, {
    displayName: 'Step 10 Chat Partner', bio: 'Staging direct chat acceptance fixture',
    city: { name: 'Shanghai', regionCode: null, countryCode: 'CN', latitude: 31.23, longitude: 121.47 },
    sports: [{ sport: 'running', paceValue: 5.5 }], trainingTimes: [{ weekday: 1, timeBucket: 'morning' }],
  });
  check(profile.profile.isComplete === true, 'second-user-profile-complete');
  stage = 'chat-credentials';
  for (const [label, session] of [['first', a], ['second', b]] as const) {
    const credentials = await call('POST', '/v1/chat/token', session, {});
    check(credentials.userId === session.user.id && typeof credentials.token === 'string', label + '-user-chat-auth-ready');
  }
  stage = 'direct-channel';
  const channel = await call<ChannelResponse>('POST', '/v1/chat/direct', a, { targetUserId: b.user.id });
  state.channelId = channel.channelId;
  await save(statePath, state);
  check(channel.channelType === 'messaging' && channel.members.length === 2 && channel.members.includes(a.user.id) && channel.members.includes(b.user.id), 'direct-channel-two-members');
  for (const [label, actor, target] of [['repeat', a, b], ['reverse', b, a]] as const) {
    const repeated = await call<ChannelResponse>('POST', '/v1/chat/direct', actor, { targetUserId: target.user.id });
    check(repeated.channelId === channel.channelId, label + '-direct-channel-unique');
  }
  stage = 'second-user-send';
  const messageText = 'Step 10 staging message evidence ' + state.sendId;
  const message = await call<{ id: string }>('POST', `/v1/chat/channels/${state.channelId}/messages`, b, { id: state.sendId, text: messageText });
  state.messageId = message.id;
  await save(statePath, state);
  check(typeof message.id === 'string' && message.id.length > 0, 'second-user-message-sent');
  stage = 'first-user-message-report';
  if (!state.referenceId) {
    const report = await call('POST', `/v1/chat/channels/${state.channelId}/messages/${message.id}/report`, a,
      { reason: 'other', details: 'Step 10 staging acceptance test; synthetic message.' });
    check(typeof report.referenceId === 'string' && report.blockedUser === false, 'first-user-report-reference-no-auto-block');
    state.referenceId = report.referenceId;
    await save(statePath, state);
  }
  stage = 'stored-evidence-and-audit';
  const client = new Client({ connectionString: acceptanceConnectionURL(databaseURL), connectionTimeoutMillis: 10000, statement_timeout: 15000 });
  client.on('error', () => {});
  try {
    await client.connect();
    const row = (await client.query<ReportRow>('SELECT reporter_id,target_user_id,source,status,snapshot,request_id FROM reports WHERE id=$1', [state.referenceId])).rows[0];
    check(row?.reporter_id === a.user.id && row.target_user_id === b.user.id && row.source === 'chat' && row.status === 'open', 'report-stored-with-correct-participants');
    check(row.snapshot.channelId === state.channelId && row.snapshot.messageId === state.messageId && row.snapshot.senderId === b.user.id && row.snapshot.text === messageText, 'report-message-snapshot-matches');
    const audit = await client.query("SELECT 1 FROM safety_audit_events WHERE report_id=$1 AND actor_id=$2 AND target_id=$3 AND action='report_message' AND request_id=$4", [state.referenceId, a.user.id, b.user.id, row.request_id]);
    check(audit.rowCount === 1, 'report-audit-matches');
  } finally { await client.end().catch(() => undefined); }
  console.log(JSON.stringify({ result: 'passed', checks: checks.length, channelId: state.channelId, messageId: state.messageId, referenceId: state.referenceId }));
}
main().catch(error => {
  const status = error instanceof Error && /^HTTP \d{3}$/.test(error.message) ? error.message : 'check or operation failed';
  console.error('FAIL ' + stage + ': ' + status + '; private recovery state retained');
  process.exitCode = 1;
});
