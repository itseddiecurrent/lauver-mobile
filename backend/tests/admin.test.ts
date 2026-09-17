import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createTestApp } from './helpers/test-app.js';
import type { AdminService } from '../src/admin.js';
import { ProfileError } from '../src/profile.js';

function adminStub() {
  return {
    login: vi.fn().mockResolvedValue({ admin: { id: '90000000-0000-4000-8000-000000000001', email: 'admin@example.com', role: 'ADMIN' }, session: 'session-token', csrf: 'csrf-token' }),
    authenticate: vi.fn().mockImplementation((request: { get(name: string): string | undefined }) => {
      if (!request.get('cookie')?.includes('lauver_admin_session=session-token')) throw new ProfileError(401, 'admin_auth_required', 'Admin authentication is required.');
      return { admin: { id: '90000000-0000-4000-8000-000000000001', email: 'admin@example.com', role: 'ADMIN' }, csrf: 'hash' };
    }),
    requireCSRF: vi.fn().mockImplementation((request: { get(name: string): string | undefined }) => {
      if (!request.get('cookie')?.includes('lauver_admin_session=session-token')) throw new ProfileError(401, 'admin_auth_required', 'Admin authentication is required.');
      if (!request.get('x-csrf-token')) throw new ProfileError(403, 'admin_csrf_failed', 'CSRF validation failed.');
      return { admin: { id: '90000000-0000-4000-8000-000000000001', email: 'admin@example.com', role: 'ADMIN' } };
    }),
    logout: vi.fn().mockResolvedValue(undefined),
    reports: vi.fn().mockResolvedValue({ reports: [], nextCursor: null }),
    report: vi.fn(), updateReport: vi.fn().mockResolvedValue({ id: '90000000-0000-4000-8000-000000000002', status: 'in_review' }),
    suspend: vi.fn(), removeEvent: vi.fn(), deleteMessage: vi.fn(),
  } as unknown as AdminService;
}

describe('Admin dashboard boundary', () => {
  it('serves an actionable dashboard shell instead of a placeholder', async () => {
    const response = await request(createTestApp({ adminService: adminStub() })).get('/admin');
    expect(response.status).toBe(200);
    expect(response.text).toContain('Admin sign in');
    expect(response.text).toContain('/admin/api/reports');
    expect(response.text).toContain('Target moderation');
  });

  it('does not expose a public report queue', async () => {
    const response = await request(createTestApp({ adminService: adminStub() })).get('/admin/api/reports');
    expect(response.status).toBe(401);
  });

  it('sets isolated secure session and readable CSRF cookie at login', async () => {
    const response = await request(createTestApp({ adminService: adminStub() }))
      .post('/admin/auth/login').send({ email: 'admin@example.com', password: 'password' });
    expect(response.status).toBe(200);
    const setCookies = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
    expect(setCookies).toEqual(expect.arrayContaining([
      expect.stringContaining('lauver_admin_session='),
      expect.stringContaining('lauver_admin_csrf='),
    ]));
    expect(setCookies.find(cookie => cookie.startsWith('lauver_admin_session='))).toContain('HttpOnly');
    expect(setCookies.find(cookie => cookie.startsWith('lauver_admin_csrf='))).not.toContain('HttpOnly');
  });

  it('requires the CSRF header for every admin write', async () => {
    const service = adminStub();
    const response = await request(createTestApp({ adminService: service }))
      .post('/admin/api/reports/90000000-0000-4000-8000-000000000002/status')
      .set('Cookie', ['lauver_admin_session=session-token', 'lauver_admin_csrf=csrf-token'])
      .send({ status: 'in_review', reason: 'review' });
    expect(response.status).toBe(403);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const updateReport = service.updateReport;
    expect(updateReport).not.toHaveBeenCalled();
  });

  it('allows a CSRF-protected report transition and logs out the admin session', async () => {
    const service = adminStub();
    const app = createTestApp({ adminService: service });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const updateReport = service.updateReport;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const logout = service.logout;
    const cookies = ['lauver_admin_session=session-token', 'lauver_admin_csrf=csrf-token'];
    await request(app).post('/admin/api/reports/90000000-0000-4000-8000-000000000002/status')
      .set('Cookie', cookies).set('x-csrf-token', 'csrf-token').send({ status: 'in_review', reason: 'review' }).expect(200);
    expect(updateReport).toHaveBeenCalledOnce();
    await request(app).post('/admin/auth/logout').set('Cookie', cookies).set('x-csrf-token', 'csrf-token').expect(204);
    expect(logout).toHaveBeenCalledOnce();
  });
});
