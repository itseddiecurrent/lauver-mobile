import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { config } from 'dotenv';
import { Client } from 'pg';
import { acceptanceConnectionURL, validateAcceptanceTarget } from './verify-step-06-staging.js';
const origin = 'https://lauver-api-staging.onrender.com';
const action = process.argv[2] ?? 'verify';
const statePath = process.argv[3] ?? '/tmp/lauver-step11-acceptance.json';
type Session = { accessToken: string; user: { id: string } };
type Actor = { email: string; password: string; session?: Session };
type Event = { id: string; title: string; status: string; attendeeCount: number; isAttendee: boolean; isCreator: boolean };
type State = { actors: Actor[]; venue: string; partnerEvent?: Event; reports?: { id: string; targetType: string; eventId: string }[] };
let stage = 'configuration';
function check(ok: unknown, label: string): asserts ok { if (!ok) throw new Error('Check failed: ' + label); console.log('PASS ' + label); }
async function api(method: string, route: string, actor?: Actor, body?: unknown) {
  const start = performance.now();
  const r = await fetch(origin + route, { method, signal: AbortSignal.timeout(60_000), redirect: 'error', headers: { 'Content-Type': 'application/json', ...(actor?.session ? { Authorization: 'Bearer ' + actor.session.accessToken } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, ms: Math.round(performance.now() - start), data: await r.json() as { event: Event; events: Event[]; nextCursor: string | null; referenceId: string } & Session };
}
async function main() {
  config({ path: '.env.staging', quiet: true });
  check(['prepare', 'verify', 'evidence', 'cleanup'].includes(action), 'recognized action');
  check(statePath.startsWith('/tmp/'), 'journal outside repository');
  const databaseURL = process.env.STAGING_DATABASE_URL!; validateAcceptanceTarget(databaseURL, origin);
  const sql = new Client({ connectionString: acceptanceConnectionURL(databaseURL), connectionTimeoutMillis: 10_000 });
  let state: State;
  const save = async () => writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  try {
    try { state = JSON.parse(await readFile(statePath, 'utf8')) as State; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || action !== 'prepare') throw e;
      const nonce = randomBytes(8).toString('hex');
      state = { venue: 'Step11 Park ' + nonce, actors: Array.from({ length: 4 }, (_, n) => ({ email: `step11-${nonce}-${n}@example.com`, password: 'Step11Acceptance9-' + randomBytes(18).toString('hex') })) };
      await writeFile(statePath, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
    }
    check(state.actors.length === 4 && state.actors.every(a => /^step11-[a-f0-9]{16}-[0-3]@example\.com$/.test(a.email)), 'exact disposable identities');
    if (action === 'cleanup') {
      await sql.connect();
      const ids = (await sql.query<{ id: string }>('SELECT u.id FROM users u JOIN auth_identities a ON a.user_id=u.id WHERE a.provider_subject=ANY($1::text[])', [state.actors.map(a => a.email)])).rows.map(r => r.id);
      await sql.query('BEGIN');
      await sql.query('DELETE FROM safety_audit_events WHERE actor_id=ANY($1::uuid[])', [ids]);
      await sql.query('DELETE FROM reports WHERE reporter_id=ANY($1::uuid[])', [ids]);
      await sql.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
      await sql.query('COMMIT'); console.log('PASS cleaned ' + ids.length + ' disposable accounts and events'); return;
    }
    const evidence = async () => {
      stage = 'staging database evidence';
      check(state.reports?.length, 'saved report receipts available');
      await sql.connect();
      for (const receipt of state.reports) {
        const rows = await sql.query<{ snapshot: { id: string }; target_type: string }>('SELECT snapshot,target_type FROM reports WHERE id=$1', [receipt.id]);
        check(rows.rows[0]?.snapshot.id === receipt.eventId && rows.rows[0]?.target_type === receipt.targetType, 'snapshot and correct target');
        check((await sql.query('SELECT 1 FROM safety_audit_events WHERE report_id=$1', [receipt.id])).rowCount === 1, 'audit committed');
      }
    };
    if (action === 'evidence') { await evidence(); return; }
    stage = 'authentication';
    for (const actor of state.actors) {
      const login = await api('POST', '/v1/auth/login', undefined, { email: actor.email, password: actor.password });
      const r = login.status === 401 && action === 'prepare' ? await api('POST', '/v1/auth/register', undefined, { email: actor.email, password: actor.password }) : login;
      check(r.status === 200 || r.status === 201, 'fixture authenticated'); actor.session = r.data; await save();
    }
    const [owner, partner, third, fourth] = state.actors as [Actor, Actor, Actor, Actor];
    const draft = (title: string, minutes = 60) => ({ title, sport: 'running', startsAt: new Date(Date.now() + minutes * 60_000).toISOString(), endsAt: new Date(Date.now() + (minutes + 60) * 60_000).toISOString(), capacity: 2, venueName: state.venue, venueLatitude: 31.2304, venueLongitude: 121.4737 });
    if (action === 'prepare') {
      for (const [i, actor] of state.actors.entries()) check((await api('PATCH', '/v1/me', actor, { displayName: 'Step 11 Runner ' + i, bio: 'Disposable event acceptance', city: { name: 'Shanghai', regionCode: null, countryCode: 'CN', latitude: 31.23, longitude: 121.47 }, sports: [{ sport: 'running', paceValue: 5.5 }], trainingTimes: [{ weekday: 1, timeBucket: 'morning' }] })).status === 200, 'profile complete');
      const existing = await api('GET', '/v1/events?limit=50&from=2000-01-01T00%3A00%3A00Z&city=' + encodeURIComponent(state.venue), partner);
      check(existing.status === 200, 'fixture list readable');
      for (let n = 0; n < 21; n++) {
        const title = 'Earlier pagination fixture ' + n;
        const found = existing.data.events.find(e => e.title === title && e.isCreator);
        const result = await api(found ? 'PATCH' : 'POST', '/v1/events' + (found ? '/' + found.id : ''), partner, draft(title, 10 + n));
        check(result.status === (found ? 200 : 201), 'earlier event ' + n);
      }
      const r = await api(state.partnerEvent ? 'PATCH' : 'POST', '/v1/events' + (state.partnerEvent ? '/' + state.partnerEvent.id : ''), partner, draft('Step 11 Partner Acceptance', 8)); check(r.status === (state.partnerEvent ? 200 : 201), 'partner device fixture'); state.partnerEvent = r.data.event; await save(); console.log('Prepared; private journal: ' + statePath); return;
    }
    stage = 'create and immediate read';
    for (const invalid of [{ startsAt: new Date(Date.now() - 10000).toISOString() }, { capacity: 1 }, { venueLatitude: 91 }, { venueName: '' }]) check((await api('POST', '/v1/events', owner, { ...draft('Invalid'), ...invalid })).status === 422, 'invalid create rejected');
    const created = await api('POST', '/v1/events', owner, draft('Immediate visibility acceptance', 90)); check(created.status === 201, 'create committed');
    const id = created.data.event.id, path = '/v1/events/' + id;
    const immediate = await api('GET', path, partner); check(immediate.status === 200 && immediate.data.event.id === id, 'another user immediately reads created ID without polling');
    console.log(JSON.stringify({ createMilliseconds: created.ms, immediateGetMilliseconds: immediate.ms }));
    const first = await api('GET', '/v1/events?city=' + encodeURIComponent(state.venue), owner);
    check(first.status === 200 && first.data.events.length === 20 && !first.data.events.some(e => e.id === id) && first.data.nextCursor, 'created event outside first 20');
    let cursor: string | null = first.data.nextCursor; let found = false, pages = 1; const seen = new Set(first.data.events.map(e => e.id));
    while (cursor) {
      const page = await api('GET', '/v1/events?city=' + encodeURIComponent(state.venue) + '&cursor=' + cursor, owner); pages++;
      check(page.status === 200 && page.data.events.every(e => !seen.has(e.id)), 'pagination without duplicates');
      page.data.events.forEach(e => seen.add(e.id)); found ||= page.data.events.some(e => e.id === id); cursor = page.data.nextCursor;
    }
    check(found, 'created event present on later page'); console.log(JSON.stringify({ pages }));
    check((await api('PATCH', path, partner, { title: 'Forbidden' })).status === 403, 'noncreator cannot edit');
    check((await api('POST', path + '/cancel', partner)).status === 403, 'noncreator cannot cancel');
    check((await api('DELETE', path + '/join', owner)).status === 409, 'creator cannot leave');
    stage = 'concurrent last place';
    const actors = [partner, third, fourth], joins = await Promise.all(actors.map(a => api('POST', path + '/join', a)));
    check(joins.filter(r => r.status === 200).length === 1 && joins.filter(r => r.status === 409).length === 2, 'three distinct simultaneous joins; exactly one wins');
    const winner = actors[joins.findIndex(r => r.status === 200)]!;
    check((await api('POST', path + '/join', winner)).data.event.attendeeCount === 2, 'repeat join idempotent');
    for (let n = 0; n < 2; n++) check((await api('DELETE', path + '/join', winner)).data.event.attendeeCount === 1, 'repeat leave idempotent');
    await api('POST', path + '/join', winner);
    stage = 'edit and report';
    state.reports = [];
    check((await api('PATCH', path, owner, { title: 'Edited acceptance' })).data.event.title === 'Edited acceptance', 'creator edit persists');
    for (const targetType of ['event', 'user']) {
      const r = await api('POST', path + '/report', winner, { reason: 'other', targetType, details: 'Synthetic Step 11 acceptance' }); check(r.status === 201, targetType + ' report receipt');
      state.reports.push({ id: r.data.referenceId, targetType, eventId: id }); await save();
    }
    check((await api('POST', path + '/report', owner, { reason: 'other' })).status === 422, 'self report rejected');
    stage = 'cancel';
    check((await api('POST', path + '/cancel', owner)).data.event.status === 'cancelled', 'creator cancel succeeds');
    const after = await api('GET', path, winner); check(after.data.event.status === 'cancelled' && after.data.event.isAttendee, 'attendee reads cancelled status');
    check(!(await api('GET', '/v1/events?from=' + encodeURIComponent(draft('x', 89).startsAt) + '&city=' + encodeURIComponent(state.venue), owner)).data.events.some(e => e.id === id), 'cancel absent from Upcoming');
    check((await api('POST', path + '/join', third)).status === 409, 'cancelled join rejected');
    console.log('PASS Step 11 staging API acceptance');
    await evidence();

  } finally { await sql.end(); }
}
main().catch(e => { console.error('FAIL ' + stage + ': ' + (e instanceof Error && e.message.startsWith('Check failed') ? e.message : 'operation failed; private details suppressed')); process.exitCode = 1; });
