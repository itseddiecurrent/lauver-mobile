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
  const guard = (write = false) => async (request: Request, response: Response, next: (error?: unknown) => void) => { try { request.admin = write ? (await service.requireCSRF(request)).admin : (await service.authenticate(request)).admin; next(); } catch (error) { next(error); } };
  app.get('/admin', (_request, response) => response.status(200).type('html').send('<!doctype html><title>Lauver Admin</title><main><h1>Lauver Admin</h1><p>Use the authenticated admin API.</p></main>'));
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

declare module 'express-serve-static-core' { interface Request { admin?: AdminIdentity } }
