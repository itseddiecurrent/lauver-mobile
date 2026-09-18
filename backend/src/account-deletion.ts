import type { Express } from 'express';
import type { PrismaClient, AccountDeletionStatus } from '@prisma/client';
import { z } from 'zod';

import type { AuthServicing } from './auth.js';
import { authenticated } from './profile-routes.js';

export type AccountDeletionResult = {
  status: 'pending';
  jobId: string;
};

export interface AccountDeletionServicing {
  begin(userId: string): Promise<AccountDeletionResult>;
}

export type AccountDeletionCleanup = {
  revokeApple(userId: string, encryptedRefreshToken: string): Promise<void>;
  revokeStrava(userId: string, encryptedRefreshToken: string): Promise<void>;
  deleteFirebaseUser(uid: string): Promise<void>;
  deleteStreamUser(userId: string): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
};

export class AccountDeletionService implements AccountDeletionServicing {
  constructor(private readonly database: PrismaClient, private readonly now = () => new Date()) {}

  async begin(userId: string): Promise<AccountDeletionResult> {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.accountDeletionJob.findUnique({
        where: { userId },
        select: { id: true, status: true },
      });

      if (existing !== null) {
        return { status: 'pending' as const, jobId: existing.id };
      }

      const now = this.now();
      await transaction.user.update({
        where: { id: userId },
        data: { status: 'DELETED' },
      });
      await transaction.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.emailToken.deleteMany({ where: { userId } });

      const job = await transaction.accountDeletionJob.create({
        data: {
          userId,
          status: 'PENDING' satisfies AccountDeletionStatus,
          nextAttemptAt: now,
        },
        select: { id: true },
      });
      return { status: 'pending' as const, jobId: job.id };
    });
  }

  async processNext(cleanup: AccountDeletionCleanup): Promise<boolean> {
    const job = await this.claimNext();
    if (job === null) return false;

    try {
      const user = await this.database.user.findUnique({
        where: { id: job.userId },
        include: {
          profile: { select: { photoKey: true } },
          identities: { include: { appleCredential: { select: { refreshTokenEncrypted: true } } } },
          stravaConnection: { select: { refreshTokenEncrypted: true } },
        },
      });

      if (user !== null) {
        const appleToken = user.identities.find((identity) => identity.appleCredential !== null)?.appleCredential?.refreshTokenEncrypted;
        if (appleToken !== undefined) await cleanup.revokeApple(user.id, appleToken);
        const firebaseIdentity = user.identities.find((identity) => identity.provider === 'FIREBASE');
        if (firebaseIdentity !== undefined) await cleanup.deleteFirebaseUser(firebaseIdentity.providerSubject);
        const stravaToken = user.stravaConnection?.refreshTokenEncrypted;
        if (stravaToken !== undefined) await cleanup.revokeStrava(user.id, stravaToken);
        await cleanup.deleteStreamUser(user.id);
        if (user.profile?.photoKey !== null && user.profile?.photoKey !== undefined) {
          await cleanup.deleteObject(user.profile.photoKey);
        }
        await this.database.$transaction(async (transaction) => {
          await transaction.user.delete({ where: { id: user.id } });
          await transaction.accountDeletionJob.update({
            where: { id: job.id },
            data: { status: 'COMPLETED', completedAt: this.now(), lastError: null },
          });
        });
      } else {
        await this.database.accountDeletionJob.update({
          where: { id: job.id },
          data: { status: 'COMPLETED', completedAt: this.now(), lastError: null },
        });
      }
    } catch (error) {
      await this.markRetry(job.id, job.attempts, error);
    }
    return true;
  }

  private async claimNext(): Promise<{ id: string; userId: string; attempts: number } | null> {
    return this.database.$transaction(async (transaction) => {
      const job = await transaction.accountDeletionJob.findFirst({
        where: {
          status: { in: ['PENDING', 'RETRY'] },
          nextAttemptAt: { lte: this.now() },
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, userId: true, attempts: true },
      });
      if (job === null) return null;
      const claimed = await transaction.accountDeletionJob.updateMany({
        where: { id: job.id, status: { in: ['PENDING', 'RETRY'] } },
        data: {
          status: 'PROCESSING',
          attempts: { increment: 1 },
          startedAt: this.now(),
          lastError: null,
        },
      });
      return claimed.count === 1 ? { ...job, attempts: job.attempts + 1 } : null;
    });
  }

  private async markRetry(jobId: string, attempts: number, error: unknown): Promise<void> {
    const delaySeconds = Math.min(2 ** Math.min(attempts, 10), 3_600);
    const message = error instanceof Error ? error.message.slice(0, 2_000) : 'Account deletion cleanup failed';
    await this.database.accountDeletionJob.update({
      where: { id: jobId },
      data: {
        status: 'RETRY',
        nextAttemptAt: new Date(this.now().getTime() + delaySeconds * 1_000),
        lastError: message,
      },
    });
  }
}

export function installAccountDeletionRoutes(
  app: Express,
  dependencies: { authService: AuthServicing; service: AccountDeletionServicing },
): void {
  app.delete('/v1/account', authenticated(dependencies.authService, async (user, request, response) => {
    const parsed = z.union([
      z.object({ confirmation: z.literal('DELETE'), currentPassword: z.string().min(1).max(128) }).strict(),
      z.object({
        confirmation: z.literal('DELETE'),
        appleCredential: z.object({
          identityToken: z.string().min(1).max(10_000),
          authorizationCode: z.string().min(1).max(2_000),
          nonce: z.string().min(32).max(128),
        }).strict(),
      }).strict(),
      z.object({
        confirmation: z.literal('DELETE'),
        googleCredential: z.object({ idToken: z.string().min(1).max(10_000) }).strict(),
      }).strict(),
    ]).safeParse(request.body);
    if (!parsed.success) {
      response.status(422).json({
        code: 'reauthentication_required',
        message: 'Confirm deletion and re-authenticate to continue',
        requestId: response.getHeader('x-request-id'),
      });
      return;
    }
    if ('currentPassword' in parsed.data) {
      await dependencies.authService.reauthenticatePassword(user.id, parsed.data.currentPassword);
    } else if ('appleCredential' in parsed.data) {
      await dependencies.authService.reauthenticateApple(user.id, parsed.data.appleCredential);
    } else {
      await dependencies.authService.reauthenticateGoogle(user.id, parsed.data.googleCredential.idToken);
    }
    response.status(202).json(await dependencies.service.begin(user.id));
  }));
}
