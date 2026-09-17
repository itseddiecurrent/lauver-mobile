import 'dotenv/config';

const baseURL = (process.env.STEP13_ADMIN_BASE_URL ?? 'https://lauver-api-staging.onrender.com').replace(/\/$/, '');
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD for the staging admin verifier.');

type Result = { status: number; body: Record<string, unknown>; headers: Headers };
let cookie = '';

async function call(path: string, init: RequestInit = {}): Promise<Result> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(`${baseURL}${path}`, { ...init, headers, redirect: 'manual' });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(', ').map(value => value.split(';')[0]).join('; ');
  let body: Record<string, unknown> = {};
  try { body = await response.json() as Record<string, unknown>; } catch { /* empty response */ }
  return { status: response.status, body, headers: response.headers };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const unauthenticated = await call('/admin/api/reports');
assert(unauthenticated.status === 401, `unauthenticated queue expected 401, got ${unauthenticated.status}`);

const shell = await fetch(`${baseURL}/admin`);
const html = await shell.text();
assert(shell.status === 200 && html.includes('Admin sign in') && html.includes('Target moderation'), 'admin UI shell is incomplete');

const login = await call('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
assert(login.status === 200, `admin login failed with ${login.status}`);
const csrf = typeof login.body.csrfToken === 'string' ? login.body.csrfToken : '';
assert(csrf.length > 20 && cookie.includes('lauver_admin_session=') && cookie.includes('lauver_admin_csrf='), 'admin session/CSRF cookies missing');

const csrfFailure = await call('/admin/auth/logout', { method: 'POST' });
assert(csrfFailure.status === 403, `missing CSRF expected 403, got ${csrfFailure.status}`);

const queue = await call('/admin/api/reports?limit=1');
assert(queue.status === 200 && Array.isArray(queue.body.reports), `admin queue failed with ${queue.status}`);

const logout = await call('/admin/auth/logout', { method: 'POST', headers: { 'x-csrf-token': csrf } });
assert(logout.status === 204, `admin logout failed with ${logout.status}`);

console.log(JSON.stringify({
  result: 'passed',
  baseURL,
  checks: ['unauthenticated-denied', 'admin-ui-shell', 'admin-login', 'csrf-enforced', 'report-queue', 'logout'],
  queueCount: Array.isArray(queue.body.reports) ? queue.body.reports.length : 0,
}));
