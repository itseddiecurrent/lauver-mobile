import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import argon2 from 'argon2';
import type { PrismaClient, AdminRole } from '@prisma/client';
import { z } from 'zod';
import { ProfileError } from './profile.js';

const sessionCookie = 'lauver_admin_session';
const csrfCookie = 'lauver_admin_csrf';
const sessionTTL = 8 * 60 * 60 * 1000;
const loginSchema = z.object({ email: z.email(), password: z.string().min(1).max(200) }).strict();
const reasonSchema = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
const statusSchema = z.object({ status: z.enum(['in_review', 'resolved', 'dismissed']), reason: z.string().trim().min(1).max(2000) }).strict();
const deleteMessageSchema = z.object({ channelId: z.string().regex(/^(?:dm-[a-f0-9]{40}|event-[a-f0-9]{32})$/), reason: z.string().trim().min(1).max(2000) }).strict();

export type AdminIdentity = { id: string; email: string; role: AdminRole };
export type AdminStreamActions = {
  deleteMessage?: (channelId: string, messageId: string) => Promise<void>;
  revokeEvent?: (eventId: string, members: string[]) => Promise<void>;
};

function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function parseCookies(request: Request): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (request.get('cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key && value.length) cookies[key] = decodeURIComponent(value.join('='));
  }
  return cookies;
}
function setCookie(response: Response, name: string, value: string, maxAge: number, httpOnly = true): void {
  response.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Max-Age=${Math.floor(maxAge / 1000)}; Path=/;${httpOnly ? ' HttpOnly;' : ''} Secure; SameSite=Strict`);
}
function clearCookie(response: Response, name: string): void { response.append('Set-Cookie', `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`); }
function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function json(value: unknown): object | null { return value && typeof value === 'object' ? value : null; }
function canAccessAdmin(role: AdminRole): boolean { return role === 'ADMIN' || role === 'SUPER_ADMIN'; }

export class AdminService {
  constructor(private readonly database: PrismaClient, private readonly stream?: AdminStreamActions) {}

  async createAdmin(email: string, password: string, role: AdminRole = 'ADMIN'): Promise<void> {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    await this.database.adminUser.upsert({ where: { email: email.trim().toLowerCase() }, update: { passwordHash, role, status: 'ACTIVE' }, create: { email: email.trim().toLowerCase(), passwordHash, role } });
  }

  async login(email: string, password: string): Promise<{ admin: AdminIdentity; session: string; csrf: string }> {
    const admin = await this.database.adminUser.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!admin || admin.status !== 'ACTIVE' || !(await argon2.verify(admin.passwordHash, password).catch(() => false))) throw new ProfileError(401, 'admin_invalid_credentials', 'Invalid admin credentials.');
    const session = randomBytes(32).toString('base64url'); const csrf = randomBytes(32).toString('base64url');
    await this.database.adminSession.create({ data: { adminId: admin.id, tokenHash: hash(session), csrfHash: hash(csrf), expiresAt: new Date(Date.now() + sessionTTL) } });
    return { admin: { id: admin.id, email: admin.email, role: admin.role }, session, csrf };
  }

  async authenticate(request: Request): Promise<{ admin: AdminIdentity; csrf: string }> {
    const cookies = parseCookies(request); const token = cookies[sessionCookie];
    if (!token) throw new ProfileError(401, 'admin_auth_required', 'Admin authentication is required.');
    const row = await this.database.adminSession.findUnique({ where: { tokenHash: hash(token) }, include: { admin: true } });
    if (!row || row.expiresAt <= new Date() || row.admin.status !== 'ACTIVE') throw new ProfileError(401, 'admin_auth_required', 'Admin authentication is required.');
    return { admin: { id: row.admin.id, email: row.admin.email, role: row.admin.role }, csrf: row.csrfHash };
  }

  async logout(request: Request): Promise<void> {
    const token = parseCookies(request)[sessionCookie]; if (token) await this.database.adminSession.deleteMany({ where: { tokenHash: hash(token) } });
  }

  async requireCSRF(request: Request): Promise<{ admin: AdminIdentity }> {
    const auth = await this.authenticate(request); const supplied = request.get('x-csrf-token') ?? '';
    if (!sameSecret(hash(supplied), auth.csrf)) throw new ProfileError(403, 'admin_csrf_failed', 'CSRF validation failed.');
    return { admin: auth.admin };
  }

  async reports(query: { status?: string; source?: string; limit: number; cursor?: string }) {
    const rows = await this.database.report.findMany({ where: { ...(query.status ? { status: query.status } : {}), ...(query.source ? { source: query.source } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}), take: query.limit + 1, include: { reporter: { select: { id: true, identities: { where: { provider: 'EMAIL' }, select: { providerSubject: true } } } }, targetUser: { select: { id: true, status: true, profile: { select: { displayName: true } } } } } });
    const next = rows.length > query.limit ? rows[query.limit - 1]?.id ?? null : null;
    return { reports: rows.slice(0, query.limit), nextCursor: next };
  }

  async report(id: string) { const row = await this.database.report.findUnique({ where: { id }, include: { reporter: { select: { id: true, identities: { where: { provider: 'EMAIL' }, select: { providerSubject: true } } } }, targetUser: { select: { id: true, status: true, profile: true } } } }); if (!row) throw new ProfileError(404, 'report_not_found', 'Report not found.'); return row; }

  async updateReport(admin: AdminIdentity, id: string, status: 'in_review' | 'resolved' | 'dismissed', reason: string, requestId: string) {
    const current = await this.database.report.findUnique({ where: { id } }); if (!current) throw new ProfileError(404, 'report_not_found', 'Report not found.');
    if (!((current.status === 'open' && status === 'in_review') || (['open', 'in_review'].includes(current.status) && ['resolved', 'dismissed'].includes(status)))) throw new ProfileError(409, 'invalid_report_transition', 'This report status transition is not allowed.');
    return this.database.$transaction(async tx => {
      const updated = await tx.report.update({ where: { id }, data: { status } });
      await tx.adminAuditLog.create({ data: { adminId: admin.id, action: 'report_status', targetType: 'report', targetId: id, reason, before: { status: current.status, snapshot: json(current.snapshot) }, after: { status: updated.status }, requestId } });
      return updated;
    });
  }

  async suspend(admin: AdminIdentity, userId: string, reason: string, requestId: string, suspended: boolean) {
    const current = await this.database.user.findUnique({ where: { id: userId }, select: { id: true, status: true } }); if (!current) throw new ProfileError(404, 'user_not_found', 'User not found.');
    const target = suspended ? 'SUSPENDED' : 'ACTIVE'; if (current.status === target) throw new ProfileError(409, 'user_already_in_state', 'User is already in this state.');
    return this.database.$transaction(async tx => {
      const updated = await tx.user.update({ where: { id: userId }, data: { status: target } });
      if (suspended) await tx.session.deleteMany({ where: { userId } });
      await tx.adminAuditLog.create({ data: { adminId: admin.id, action: suspended ? 'suspend_user' : 'restore_user', targetType: 'user', targetId: userId, reason, before: { status: current.status }, after: { status: updated.status }, requestId } });
      return updated;
    });
  }

  async removeEvent(admin: AdminIdentity, eventId: string, reason: string, requestId: string) {
    const current = await this.database.event.findUnique({ where: { id: eventId }, include: { attendees: true } }); if (!current) throw new ProfileError(404, 'event_not_found', 'Event not found.');
    const updated = await this.database.event.update({ where: { id: eventId }, data: { status: 'CANCELLED' } });
    try { await this.stream?.revokeEvent?.(eventId, current.attendees.map(row => row.userId)); } catch { await this.database.event.update({ where: { id: eventId }, data: { status: current.status } }); throw new ProfileError(503, 'admin_action_unavailable', 'The event could not be removed completely.'); }
    await this.database.adminAuditLog.create({ data: { adminId: admin.id, action: 'remove_event', targetType: 'event', targetId: eventId, reason, before: { status: current.status }, after: { status: updated.status }, requestId } }); return updated;
  }

  async deleteMessage(admin: AdminIdentity, channelId: string, messageId: string, reason: string, requestId: string) {
    if (!this.stream?.deleteMessage) throw new ProfileError(503, 'admin_action_unavailable', 'Message deletion is unavailable.');
    await this.stream.deleteMessage(channelId, messageId); await this.database.adminAuditLog.create({ data: { adminId: admin.id, action: 'delete_message', targetType: 'message', reason, before: { channelId, messageId }, after: { deleted: true, channelId, messageId }, requestId } }); return { deleted: true };
  }
}

export function installAdminRoutes(app: Express, service: AdminService): void {
  const requestId = (response: Response): string => String(response.getHeader('x-request-id'));
  const guard = (write = false) => async (request: Request, response: Response, next: (error?: unknown) => void) => {
    try {
      const admin = write ? (await service.requireCSRF(request)).admin : (await service.authenticate(request)).admin;
      if (!canAccessAdmin(admin.role)) throw new ProfileError(403, 'admin_forbidden', 'This administrator is not allowed to access the dashboard.');
      request.admin = admin;
      next();
    } catch (error) { next(error); }
  };
  app.get('/admin', (_request, response) => response.status(200).type('html').send(adminDashboardHTML));
  app.post('/admin/auth/login', async (request, response, next) => { try { const body = loginSchema.parse(request.body); const result = await service.login(body.email, body.password); setCookie(response, sessionCookie, result.session, sessionTTL); setCookie(response, csrfCookie, result.csrf, sessionTTL, false); response.status(200).json({ admin: result.admin, csrfToken: result.csrf }); } catch (error) { next(error); } });
  app.post('/admin/auth/logout', guard(true), async (request, response, next) => { try { await service.logout(request); clearCookie(response, sessionCookie); clearCookie(response, csrfCookie); response.status(204).send(); } catch (error) { next(error); } });
  app.get('/admin/api/reports', guard(), async (request, response, next) => { try { const query = z.object({ status: z.enum(['open', 'in_review', 'resolved', 'dismissed']).optional(), source: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.uuid().optional() }).strict().parse(request.query); response.json(await service.reports(query)); } catch (error) { next(error); } });
  app.get('/admin/api/reports/:id', guard(), async (request, response, next) => { try { response.json({ report: await service.report(String(request.params.id)) }); } catch (error) { next(error); } });
  app.post('/admin/api/reports/:id/status', guard(true), async (request, response, next) => { try { const body = statusSchema.parse(request.body); response.json({ report: await service.updateReport(request.admin!, String(request.params.id), body.status, body.reason, requestId(response)) }); } catch (error) { next(error); } });
  app.post('/admin/api/users/:id/suspend', guard(true), async (request, response, next) => { try { const body = reasonSchema.parse(request.body); response.json({ user: await service.suspend(request.admin!, String(request.params.id), body.reason, requestId(response), true) }); } catch (error) { next(error); } });
  app.post('/admin/api/users/:id/restore', guard(true), async (request, response, next) => { try { const body = reasonSchema.parse(request.body); response.json({ user: await service.suspend(request.admin!, String(request.params.id), body.reason, requestId(response), false) }); } catch (error) { next(error); } });
  app.post('/admin/api/events/:id/remove', guard(true), async (request, response, next) => { try { const body = reasonSchema.parse(request.body); response.json({ event: await service.removeEvent(request.admin!, String(request.params.id), body.reason, requestId(response)) }); } catch (error) { next(error); } });
  app.post('/admin/api/messages/:id/delete', guard(true), async (request, response, next) => { try { const body = deleteMessageSchema.parse(request.body); response.json(await service.deleteMessage(request.admin!, body.channelId, String(request.params.id), body.reason, requestId(response))); } catch (error) { next(error); } });
}

const adminDashboardHTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lauver Admin</title><style>
:root{font:16px system-ui,-apple-system,sans-serif;color:#241f1b;background:#f0ede8}body{margin:0}header{display:flex;justify-content:space-between;align-items:center;padding:18px 28px;background:#fff;border-bottom:1px solid #ddd4ca}main{max-width:1180px;margin:24px auto;padding:0 20px}.card{background:#fff;border:1px solid #ddd4ca;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 10px #3320100d}h1,h2{margin-top:0}button,select,input,textarea{font:inherit;border-radius:8px;border:1px solid #cfc4ba;padding:9px}button{background:#e8602c;color:#fff;border:0;cursor:pointer}button.secondary{background:#6d625a}button.danger{background:#b42318}button:disabled{opacity:.5;cursor:not-allowed}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.split{display:grid;grid-template-columns:minmax(280px,1fr) minmax(360px,1.4fr);gap:16px}.report{display:block;width:100%;text-align:left;background:#fff;color:#241f1b;border:0;border-bottom:1px solid #eee0d6;border-radius:0;padding:14px}.report:hover{background:#fff6ef}.muted{color:#6d625a;font-size:.9rem}.error{color:#b42318;white-space:pre-wrap}.hidden{display:none}pre{white-space:pre-wrap;overflow:auto;background:#f7f4f0;padding:12px;border-radius:8px}.pill{display:inline-block;padding:3px 8px;border-radius:99px;background:#f5d4c4;color:#81300f;font-size:.8rem}
@media(max-width:760px){.split{grid-template-columns:1fr}header{padding:14px 16px}main{margin:12px auto;padding:0 12px}}
</style></head><body>
<header><strong>Lauver Admin</strong><button id="logout" class="secondary hidden">Sign out</button></header>
<main><section id="login" class="card"><h1>Admin sign in</h1><form id="login-form" class="row"><input id="email" type="email" autocomplete="username" placeholder="Admin email" required><input id="password" type="password" autocomplete="current-password" placeholder="Password" required><button>Sign in</button></form><p id="login-error" class="error"></p></section>
<section id="dashboard" class="hidden"><div class="card"><div class="row"><h1 style="margin:0">Report queue</h1><select id="status"><option value="">All statuses</option><option>open</option><option>in_review</option><option>resolved</option><option>dismissed</option></select><input id="source" placeholder="Source (profile/chat/event)"><button id="refresh">Refresh</button></div><p id="queue-error" class="error"></p></div>
<div class="split"><section class="card"><div id="reports"><p class="muted">Sign in to load reports.</p></div><button id="next-page" class="secondary hidden">Load more</button></section><section id="detail" class="card"><h2>Select a report</h2><p class="muted">Evidence and moderation actions appear here.</p></section></div></section></main>
<script>
const $=id=>document.getElementById(id); let selected=null; let nextCursor=null;
function csrf(){return decodeURIComponent(document.cookie.split('; ').find(x=>x.startsWith('lauver_admin_csrf='))?.split('=').slice(1).join('=')||'')}
async function call(path,options={}){const r=await fetch(path,{credentials:'same-origin',...options,headers:{'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.method&&options.method!=='GET'?{'x-csrf-token':csrf()}:{}),...(options.headers||{})}});let b={};try{b=await r.json()}catch{}if(!r.ok)throw new Error(b.message||('Request failed ('+r.status+')'));return b}
function showDashboard(){ $('login').classList.add('hidden');$('dashboard').classList.remove('hidden');$('logout').classList.remove('hidden');loadReports() }
function showLogin(){ $('login').classList.remove('hidden');$('dashboard').classList.add('hidden');$('logout').classList.add('hidden') }
async function loadReports(append=false){try{const q=new URLSearchParams();if($('status').value)q.set('status',$('status').value);if($('source').value.trim())q.set('source',$('source').value.trim());if(append&&nextCursor)q.set('cursor',nextCursor);const data=await call('/admin/api/reports?'+q);const box=$('reports');if(!append){box.textContent=''}if(!data.reports.length&&!append){box.innerHTML='<p class="muted">No reports match these filters.</p>'}$('next-page').classList.toggle('hidden',!data.nextCursor);nextCursor=data.nextCursor;for(const r of data.reports){const b=document.createElement('button');b.className='report';b.dataset.id=r.id;const title=document.createElement('strong');title.textContent=(r.source||'report')+' · '+r.status;const meta=document.createElement('div');meta.className='muted';meta.textContent=r.reason+' · '+new Date(r.createdAt).toLocaleString();b.append(title,meta);b.onclick=()=>loadDetail(r.id);box.append(b)}}catch(e){$('queue-error').textContent=e.message}}
async function loadDetail(id){try{const data=await call('/admin/api/reports/'+encodeURIComponent(id));selected=data.report;const r=selected;const d=$('detail');d.textContent='';const h=document.createElement('h2');h.textContent='Report detail';const meta=document.createElement('p');meta.className='muted';meta.textContent=(r.source||'report')+' · '+r.status+' · '+new Date(r.createdAt).toLocaleString();const reason=document.createElement('p');reason.textContent='Reason: '+r.reason+(r.details?' — '+r.details:'');const pre=document.createElement('pre');pre.textContent=JSON.stringify(r.snapshot,null,2);d.append(h,meta,reason,document.createElement('hr'),pre);const actions=document.createElement('div');actions.className='row';for(const [label,status] of [['In Review','in_review'],['Resolve','resolved'],['Dismiss','dismissed']]){const b=document.createElement('button');b.textContent=label;b.disabled=(r.status==='resolved'||r.status==='dismissed')||(r.status==='open'&&status!=='in_review');b.onclick=()=>updateReport(r.id,status);actions.append(b)}d.append(actions);const target=r.targetUser;const snapshot=r.snapshot||{};const moderation=document.createElement('div');moderation.className='card';const mh=document.createElement('h3');mh.textContent='Target moderation';moderation.append(mh);if(target){for(const [label,path,kind] of [['Suspend user','/admin/api/users/'+target.id+'/suspend','danger'],['Restore user','/admin/api/users/'+target.id+'/restore','secondary']]){const b=document.createElement('button');b.textContent=label;b.className=kind;b.onclick=()=>moderate(path,label);moderation.append(b)}}if(r.targetType==='event'&&snapshot.id){const b=document.createElement('button');b.textContent='Remove event';b.className='danger';b.onclick=()=>moderate('/admin/api/events/'+snapshot.id+'/remove','Remove event');moderation.append(b)}if(snapshot.channelId&&snapshot.messageId){const b=document.createElement('button');b.textContent='Delete message';b.className='danger';b.onclick=()=>deleteMessage(snapshot.channelId,snapshot.messageId);moderation.append(b)}if(moderation.children.length>1)d.append(moderation)}catch(e){$('detail').innerHTML='<p class="error">'+e.message+'</p>'}}
async function updateReport(id,status){const reason=prompt('Reason for this status change:');if(!reason)return;try{await call('/admin/api/reports/'+id+'/status',{method:'POST',body:JSON.stringify({status,reason})});await loadReports();await loadDetail(id)}catch(e){alert(e.message)}}
async function moderate(path,label){const reason=prompt('Reason for '+label.toLowerCase()+':');if(!reason)return;try{await call(path,{method:'POST',body:JSON.stringify({reason})});alert(label+' completed.');await loadReports()}catch(e){alert(e.message)}}
async function deleteMessage(channelId,messageId){const reason=prompt('Reason for deleting this message:');if(!reason)return;try{await call('/admin/api/messages/'+messageId+'/delete',{method:'POST',body:JSON.stringify({channelId,messageId,reason})});alert('Message deleted.');await loadDetail(selected.id)}catch(e){alert(e.message)}}
$('login-form').onsubmit=async e=>{e.preventDefault();$('login-error').textContent='';try{await call('/admin/auth/login',{method:'POST',body:JSON.stringify({email:$('email').value,password:$('password').value})});showDashboard()}catch(e){$('login-error').textContent=e.message}};
$('logout').onclick=async()=>{try{await call('/admin/auth/logout',{method:'POST'})}finally{showLogin()}};$('refresh').onclick=()=>loadReports();$('next-page').onclick=()=>loadReports(true);$('status').onchange=()=>loadReports();
showLogin(); if(document.cookie.includes('lauver_admin_csrf=')){call('/admin/api/reports').then(()=>showDashboard()).catch(()=>showLogin())}
</script></body></html>`;

declare module 'express-serve-static-core' { interface Request { admin?: AdminIdentity } }
