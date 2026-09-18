import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { AccountDeletionService, type AccountDeletionCleanup } from '../src/account-deletion.js';
import { createAuthServiceStub, createTestApp } from './helpers/test-app.js';

describe('DELETE /v1/account', () => {
  it('requires an authenticated user and starts deletion for that user', async () => {
    const begin = vi.fn().mockResolvedValue({ status: 'pending', jobId: 'job-id' });
    const restore = vi.fn().mockResolvedValue({ id: 'user-id', email: 'runner@example.com' });
    const reauthenticatePassword = vi.fn().mockResolvedValue(undefined);
    const response = await request(createTestApp({
      authService: createAuthServiceStub({ restore, reauthenticatePassword }),
      accountDeletionService: { begin },
    }))
      .delete('/v1/account')
      .set('Authorization', 'Bearer access-token')
      .send({ confirmation: 'DELETE', currentPassword: 'correct-password' });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'pending', jobId: 'job-id' });
    expect(restore).toHaveBeenCalledWith('access-token');
    expect(reauthenticatePassword).toHaveBeenCalledWith('user-id', 'correct-password');
    expect(begin).toHaveBeenCalledWith('user-id');
  });

  it('does not expose the deletion route without the service wired', async () => {
    const response = await request(createTestApp()).delete('/v1/account');

    expect(response.status).toBe(404);
  });

  it('requires the explicit DELETE confirmation phrase', async () => {
    const begin = vi.fn();
    const response = await request(createTestApp({
      authService: createAuthServiceStub({ restore: vi.fn().mockResolvedValue({ id: 'user-id', email: 'runner@example.com' }), reauthenticatePassword: vi.fn() }),
      accountDeletionService: { begin },
    }))
      .delete('/v1/account')
      .send({ confirmation: 'delete' });

    expect(response.status).toBe(422);
    expect((response.body as { code?: string }).code).toBe('confirmation_required');
    expect(begin).not.toHaveBeenCalled();
  });
});

describe('account deletion worker', () => {
  function cleanup(deleteStreamUser: (userId: string) => Promise<void> = vi.fn<(userId: string) => Promise<void>>().mockResolvedValue(undefined)): AccountDeletionCleanup {
    return {
      revokeApple: vi.fn().mockResolvedValue(undefined),
      revokeStrava: vi.fn().mockResolvedValue(undefined),
      deleteStreamUser,
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('deletes local user data only after external cleanup succeeds', async () => {
    const transaction = {
      accountDeletionJob: {
        findFirst: vi.fn().mockResolvedValue({ id: 'job-id', userId: 'user-id', attempts: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      user: { delete: vi.fn().mockResolvedValue(undefined) },
    };
    const database = {
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) => Promise.resolve(callback(transaction))),
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-id',
          profile: { photoKey: null },
          identities: [],
          stravaConnection: null,
        }),
      },
      accountDeletionJob: { update: vi.fn().mockResolvedValue(undefined) },
    };
    const service = new AccountDeletionService(database as unknown as PrismaClient, () => new Date('2026-09-17T00:00:00.000Z'));
    const deleteStreamUser = vi.fn<(userId: string) => Promise<void>>().mockResolvedValue(undefined);
    const external = cleanup(deleteStreamUser);

    await expect(service.processNext(external)).resolves.toBe(true);
    expect(transaction.user.delete).toHaveBeenCalledWith({ where: { id: 'user-id' } });
    expect(transaction.accountDeletionJob.update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'job-id' },
      data: { status: 'COMPLETED' },
    });
    expect(deleteStreamUser.mock.calls).toContainEqual(['user-id']);
  });

  it('keeps the deleted user and schedules retry when external cleanup fails', async () => {
    const transaction = {
      accountDeletionJob: {
        findFirst: vi.fn().mockResolvedValue({ id: 'job-id', userId: 'user-id', attempts: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const database = {
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) => Promise.resolve(callback(transaction))),
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-id',
          profile: { photoKey: null },
          identities: [],
          stravaConnection: null,
        }),
      },
      accountDeletionJob: { update: vi.fn().mockResolvedValue(undefined) },
    };
    const service = new AccountDeletionService(database as unknown as PrismaClient, () => new Date('2026-09-17T00:00:00.000Z'));
    const deleteStreamUser = vi.fn<(userId: string) => Promise<void>>().mockRejectedValue(new Error('stream unavailable'));
    const external = cleanup(deleteStreamUser);

    await expect(service.processNext(external)).resolves.toBe(true);
    expect(database.accountDeletionJob.update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'job-id' },
      data: { status: 'RETRY', lastError: 'stream unavailable' },
    });
  });
});
