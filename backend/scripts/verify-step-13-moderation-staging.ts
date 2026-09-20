import { randomBytes, randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Client } from 'pg';

config({ path: '.env.staging', quiet: true });
const baseURL = (process.env.STEP13_ADMIN_BASE_URL ?? 'https://lauver-api-staging.onrender.com').replace(/\/$/, '');
const databaseURL = process.env.STAGING_DATABASE_URL;
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
if (!databaseURL || !adminEmail || !adminPassword) throw new Error('Staging database and admin credentials are required.');

type Session = { accessToken: string; refreshToken: string; user: { id: string } };
type Actor = { email: string; password: string; session?: Session };
type Report = { id: string; source: string; status: string; targetType: string; targetUser?: { id: string; status: string } | null; snapshot: Record<string, unknown> };
let adminCookie = '';

function check(condition: unknown, label: string): asserts condition { if (!condition) throw new Error(`Check failed: ${label}`); console.log(`PASS ${label}`); }
async function api<T = Record<string, unknown>>(method: string, path: string, session?: Session, body?: unknown): Promise<{ status: number; data: T }> {
  const response = await fetch(`${baseURL}${path}`, { method, signal: AbortSignal.timeout(60_000), headers: { accept: 'application/json', 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data: T = {} as T; try { data = await response.json() as T; } catch { /* empty response */ }
  return { status: response.status, data };
}
async function login(actor: Actor): Promise<Session> {
  if (actor.session) {
    const current = await api('GET', '/v1/auth/session', actor.session);
    if (current.status === 200) return actor.session;
    const refreshed = await api<Session>('POST', '/v1/auth/refresh', undefined, { refreshToken: actor.session.refreshToken });
    if (refreshed.status === 200) { actor.session = refreshed.data; return refreshed.data; }
  }
  let result = await api<Session>('POST', '/v1/auth/register', undefined, { email: actor.email, password: actor.password });
  if (result.status === 409) result = await api<Session>('POST', '/v1/auth/login', undefined, { email: actor.email, password: actor.password });
  check(result.status === 201 || result.status === 200, 'fixture login'); actor.session = result.data; return result.data;
}
async function admin<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) };
  if (adminCookie) headers.cookie = adminCookie;
  if (method !== 'GET') headers['x-csrf-token'] = adminCookie.match(/lauver_admin_csrf=([^;]+)/)?.[1] ?? '';
  const response = await fetch(`${baseURL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const setCookie = response.headers.get('set-cookie'); if (setCookie) adminCookie = setCookie.split(', ').map(value => value.split(';')[0]).join('; ');
  let data: T = {} as T; try { data = await response.json() as T; } catch { /* empty response */ }
  return { status: response.status, data };
}
async function main() {
  const nonce = randomBytes(10).toString('hex');
  const actors: Actor[] = Array.from({ length: 3 }, (_, index) => ({ email: `step13-${nonce}-${index}@example.com`, password: `Step13Acceptance9-${randomBytes(20).toString('hex')}` }));
  const [eventOwner, eventPartner, directTarget] = actors as [Actor, Actor, Actor];
  const owner = await login(eventOwner); const partner = await login(eventPartner); const target = await login(directTarget);
  for (const [index, actor] of actors.entries()) {
    const profile = await api('PATCH', '/v1/me', actor.session, { displayName: `Step 13 Fixture ${index}`, bio: 'Disposable moderation acceptance fixture', city: { name: 'Shanghai', regionCode: null, countryCode: 'CN', latitude: 31.23, longitude: 121.47 }, sports: [{ sport: 'running', paceValue: 5.5 }], trainingTimes: [{ weekday: 1, timeBucket: 'morning' }] });
    check(profile.status === 200, 'fixture profile complete');
  }
  for (const actor of [eventOwner, directTarget]) {
    const preferences = await api('PATCH', '/v1/match/preferences', actor.session, {
      visibleInMatch: true, gender: 'other', preferredGender: 'all', maxDistanceKm: 25, sports: ['running'],
    });
    check(preferences.status === 200, 'match preferences enabled');
  }
  const firstLike = await api<{ matched: boolean; matchId: string | null }>('POST', '/v1/match/swipes', owner, { targetUserId: target.user.id, direction: 'like' });
  check(firstLike.status === 200 && firstLike.data.matched === false, 'one-way Like recorded');
  const reciprocalLike = await api<{ matched: boolean; matchId: string | null }>('POST', '/v1/match/swipes', target, { targetUserId: owner.user.id, direction: 'like' });
  check(reciprocalLike.status === 200 && reciprocalLike.data.matched && reciprocalLike.data.matchId, 'mutual Like created Match');
  const matchID = reciprocalLike.data.matchId;
  const eventBody = { title: `Step 13 Event ${nonce}`, sport: 'running', startsAt: new Date(Date.now() + 30 * 60_000).toISOString(), endsAt: new Date(Date.now() + 90 * 60_000).toISOString(), capacity: 3, venueName: `Step 13 Venue ${nonce}`, venueLatitude: 31.23, venueLongitude: 121.47 };
  let event = await api<{ event: { id: string } }>('POST', '/v1/events', owner, eventBody);
  if (event.status === 503) { await new Promise(resolve => setTimeout(resolve, 3_000)); event = await api<{ event: { id: string } }>('POST', '/v1/events', owner, eventBody); }
  check(event.status === 201, `event fixture created (${event.status})`);
  const eventID = event.data.event.id;
  check((await api('POST', `/v1/events/${eventID}/join`, partner)).status === 200, 'event partner joined');
  let direct = await api<{ channelId: string }>('POST', '/v1/chat/direct', owner, { targetUserId: target.user.id });
  if (direct.status !== 200) { await new Promise(resolve => setTimeout(resolve, 3_000)); direct = await api<{ channelId: string }>('POST', '/v1/chat/direct', owner, { targetUserId: target.user.id }); }
  check(direct.status === 200, `direct channel created (${direct.status})`);
  const directMessage = await api<{ id: string }>('POST', `/v1/chat/channels/${direct.data.channelId}/messages`, target, { id: randomUUID(), text: 'Step 13 direct moderation fixture' });
  check(directMessage.status === 200, 'direct message created');
  const directReport = await api<{ referenceId: string }>('POST', `/v1/chat/channels/${direct.data.channelId}/messages/${directMessage.data.id}/report`, owner, { reason: 'other', details: 'Step 13 direct chat moderation fixture' });
  check(directReport.status === 201, 'direct chat report created');
  const matchReport = await api<{ referenceId: string }>('POST', `/v1/matches/${matchID}/report`, owner, { reason: 'harassment', details: 'Step 13 match moderation fixture', context: 'match' });
  check(matchReport.status === 201, `match report created (${matchReport.status}): ${JSON.stringify(matchReport.data)}`);
  const likeReport = await api<{ referenceId: string }>('POST', `/v1/match/likes/${target.user.id}/report`, owner, { reason: 'spam', details: 'Step 13 like moderation fixture' });
  check(likeReport.status === 201, `like report created (${likeReport.status})`);
  const eventReport = await api<{ referenceId: string }>('POST', `/v1/events/${eventID}/report`, partner, { reason: 'other', details: 'Step 13 event moderation fixture', targetType: 'event' });
  check(eventReport.status === 201, 'event report created');

  const profileReport = await api<{ referenceId: string }>('POST', '/v1/reports', owner, { targetType: 'user', targetId: partner.user.id, reason: 'other', details: 'Step 13 profile moderation fixture' });
  check(profileReport.status === 201, 'profile report created');
  const eventChat = await api<{ channelId: string }>('GET', `/v1/events/${eventID}/chat`, owner);
  check(eventChat.status === 200, 'event group chat available');
  const message = await api<{ id: string }>('POST', `/v1/chat/channels/${eventChat.data.channelId}/messages`, owner, { id: randomUUID(), text: 'Step 13 event chat moderation fixture' });
  check(message.status === 200, 'event chat message created');
  await new Promise(resolve => setTimeout(resolve, 3_000));
  let eventChatReport = await api<{ referenceId: string }>('POST', `/v1/chat/channels/${eventChat.data.channelId}/messages/${message.data.id}/report`, partner, { reason: 'other', details: 'Step 13 event chat moderation fixture' });
  if (eventChatReport.status === 404) {
    await new Promise(resolve => setTimeout(resolve, 5_000));
    eventChatReport = await api<{ referenceId: string }>('POST', `/v1/chat/channels/${eventChat.data.channelId}/messages/${message.data.id}/report`, partner, { reason: 'other', details: 'Step 13 event chat moderation fixture' });
  }
  check(eventChatReport.status === 201, `event chat report created (${eventChatReport.status})`);

  const adminLogin = await admin<{ csrfToken: string; admin: { role: string } }>('POST', '/admin/auth/login', { email: adminEmail, password: adminPassword });
  check(adminLogin.status === 200 && adminLogin.data.admin.role, 'admin login');
  const queue = await admin<{ reports: Report[] }>('GET', '/admin/api/reports?limit=100'); check(queue.status === 200, 'report queue readable');
  const reportIDs = [profileReport.data.referenceId, directReport.data.referenceId, matchReport.data.referenceId, likeReport.data.referenceId, eventReport.data.referenceId, eventChatReport.data.referenceId];
  const reports = queue.data.reports.filter(report => reportIDs.includes(report.id));
  check(reports.some(report => report.id === profileReport.data.referenceId && report.source === 'profile'), 'profile source in queue');
  check(reports.some(report => report.id === directReport.data.referenceId && report.source === 'chat' && String(report.snapshot.channelId).startsWith('dm-')), 'direct chat source in queue');
  check(reports.some(report => report.id === eventChatReport.data.referenceId && report.source === 'chat' && String(report.snapshot.channelId).startsWith('event-')), 'event chat source in queue');
  check(reports.some(report => report.id === eventReport.data.referenceId && report.source === 'event'), 'event source in queue');
  check(reports.some(report => report.id === matchReport.data.referenceId && report.source === 'match' && report.targetType === 'match'), 'match source in queue');
  check(reports.some(report => report.id === likeReport.data.referenceId && report.source === 'like' && report.targetType === 'like'), 'like source in queue');

  for (const id of reportIDs) {
    const detail = await admin<{ report: Report }>('GET', `/admin/api/reports/${id}`); if (detail.status !== 200 || !detail.data.report) continue;
    if (detail.data.report.status === 'open') { check((await admin('POST', `/admin/api/reports/${id}/status`, { status: 'in_review', reason: 'Step 13 moderation review' })).status === 200, 'report moved to in review'); }
    check((await admin('POST', `/admin/api/reports/${id}/status`, { status: 'resolved', reason: 'Step 13 moderation resolved' })).status === 200, 'report resolved');
  }

  const suspend = await admin('POST', `/admin/api/users/${target.user.id}/suspend`, { reason: 'Step 13 suspend fixture' });
  check(suspend.status === 200, 'user suspended');
  check((await api('GET', '/v1/me', target)).status === 401, 'suspended access token rejected');
  const suspendedToken = await api('POST', '/v1/chat/token', target, {});
  check(suspendedToken.status === 401 || suspendedToken.status === 403, 'suspended user cannot receive Stream token');
  const ownerCandidates = await api<{ users: Array<{ id: string }> }>('GET', '/v1/match/candidates', owner);
  check(ownerCandidates.status === 200 && !ownerCandidates.data.users.some(user => user.id === target.user.id), 'suspended user removed from candidates');
  const ownerMatches = await api<{ matches: Array<{ id: string }> }>('GET', '/v1/matches', owner);
  check(ownerMatches.status === 200 && !ownerMatches.data.matches.some(match => match.id === matchID), 'suspended user Match revoked');
  check((await api('POST', `/v1/chat/channels/${direct.data.channelId}/messages`, owner, { id: randomUUID(), text: 'suspended target probe' })).status === 403, 'suspended user direct chat revoked');
  check((await admin('POST', `/admin/api/users/${target.user.id}/restore`, { reason: 'Step 13 restore fixture' })).status === 200, 'user restored');

  const remove = await admin('POST', `/admin/api/events/${eventID}/remove`, { reason: 'Step 13 event removal fixture' });
  check(remove.status === 200, 'event removed');
  check((await api('POST', `/v1/events/${eventID}/join`, target)).status === 409, 'removed event cannot be joined');
  check((await api('GET', `/v1/events/${eventID}/chat`, owner)).status === 403, 'removed event chat is inaccessible');

  let deleteMessage = await admin('POST', `/admin/api/messages/${directMessage.data.id}/delete`, { channelId: direct.data.channelId, reason: 'Step 13 message deletion fixture' });
  for (let attempt = 0; attempt < 4 && deleteMessage.status !== 200; attempt++) { await new Promise(resolve => setTimeout(resolve, 3_000)); deleteMessage = await admin('POST', `/admin/api/messages/${directMessage.data.id}/delete`, { channelId: direct.data.channelId, reason: 'Step 13 message deletion fixture' }); }
  check(deleteMessage.status === 200, `direct chat message deleted (${deleteMessage.status})`);
  check((await api('POST', `/v1/chat/channels/${direct.data.channelId}/messages/${directMessage.data.id}/report`, owner, { reason: 'other', details: 'deleted message probe' })).status === 404, 'deleted Stream message no longer readable');

  const sql = new Client({ connectionString: databaseURL, ssl: { rejectUnauthorized: false } }); await sql.connect();
  try {
    const audit = await sql.query<{ action: string; count: number }>(`SELECT action, count(*)::int AS count FROM admin_audit_logs WHERE reason LIKE 'Step 13 %' GROUP BY action`);
    for (const action of ['report_status', 'suspend_user', 'restore_user', 'remove_event', 'delete_message']) check(Number(audit.rows.find(row => row.action === action)?.count ?? 0) >= 1, `${action} audit persisted`);
  } finally { await sql.end(); }
  let logout: { status: number } = { status: 0 };
  for (let attempt = 0; attempt < 3 && logout.status !== 204; attempt++) {
    try { logout = await admin('POST', '/admin/auth/logout'); }
    catch { await new Promise(resolve => setTimeout(resolve, 3_000)); }
  }
  check(logout.status === 204, 'admin logout');
  console.log(JSON.stringify({ result: 'passed', sources: ['profile', 'chat-direct', 'event', 'chat-event'], moderation: ['suspend-restore', 'remove-event', 'delete-message'] }));
}
main().catch(error => { console.error(error instanceof Error ? `FAIL: ${error.message}` : 'FAIL: moderation acceptance failed'); process.exitCode = 1; });
