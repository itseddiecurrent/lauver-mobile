import { Prisma, type PrismaClient } from '@prisma/client';
import { visibleUserWhere } from './block-policy.js';

export type StoredSport = {
  sport: string;
  paceValue: number | null;
  paceUnit: string | null;
};

export type StoredTrainingTime = {
  weekday: number;
  timeBucket: string;
};

export type StoredProfile = {
  userId: string;
  displayName: string | null;
  bio: string | null;
  photoKey: string | null;
  cityName: string | null;
  regionCode: string | null;
  countryCode: string | null;
  cityLatitude: number | null;
  cityLongitude: number | null;
  isComplete: boolean;
  sports: StoredSport[];
  trainingTimes: StoredTrainingTime[];
};

export type ProfileReplacement = Omit<StoredProfile, 'photoKey'>;

export interface ProfileRepository {
  findProfile(userId: string, requireActiveUser?: boolean, viewerId?: string): Promise<StoredProfile | null>;
  replaceProfile(profile: ProfileReplacement): Promise<StoredProfile>;
  replacePhoto(userId: string, objectKey: string | null): Promise<string | null>;
  createPhotoUpload(input: {
    objectKey: string;
    userId: string;
    contentType: string;
    byteSize: number;
    expiresAt: Date;
  }): Promise<void>;
  findPhotoUpload(objectKey: string, userId: string): Promise<{
    contentType: string;
    byteSize: number;
    expiresAt: Date;
  } | null>;
  commitPhotoUpload(objectKey: string, userId: string, finalObjectKey: string): Promise<string | null>;
  discardPhotoUpload(objectKey: string, userId: string): Promise<void>;
  listExpiredPhotoUploads(limit: number, now: Date): Promise<Array<{ objectKey: string; userId: string }>>;
  listPhotoCleanupJobs(limit: number): Promise<string[]>;
  completePhotoCleanup(objectKey: string): Promise<void>;
  delayPhotoCleanup(objectKey: string, nextAttempt: Date): Promise<void>;
}

export class PrismaProfileRepository implements ProfileRepository {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async findProfile(userId: string, requireActiveUser = false, viewerId?: string): Promise<StoredProfile | null> {
    const profile = await this.#client.profile.findFirst({
      where: {
        userId,
        ...(viewerId !== undefined ? { user: visibleUserWhere(viewerId) } : requireActiveUser ? { user: { status: 'ACTIVE' } } : {}),
      },
      include: {
        user: {
          include: {
            sports: { orderBy: { sport: 'asc' } },
            trainingTimes: { orderBy: [{ weekday: 'asc' }, { timeBucket: 'asc' }] },
          },
        },
      },
    });
    if (profile === null) return null;
    return toStoredProfile(profile, profile.user.sports, profile.user.trainingTimes);
  }

  async replaceProfile(profile: ProfileReplacement): Promise<StoredProfile> {
    return this.#client.$transaction(async (transaction) => {
      await transaction.profile.upsert({
        where: { userId: profile.userId },
        create: {
          userId: profile.userId,
          displayName: profile.displayName,
          bio: profile.bio,
          cityName: profile.cityName,
          regionCode: profile.regionCode,
          countryCode: profile.countryCode,
          cityLatitude: decimal(profile.cityLatitude),
          cityLongitude: decimal(profile.cityLongitude),
          isComplete: profile.isComplete,
        },
        update: {
          displayName: profile.displayName,
          bio: profile.bio,
          cityName: profile.cityName,
          regionCode: profile.regionCode,
          countryCode: profile.countryCode,
          cityLatitude: decimal(profile.cityLatitude),
          cityLongitude: decimal(profile.cityLongitude),
          isComplete: profile.isComplete,
        },
      });
      await transaction.userSport.deleteMany({ where: { userId: profile.userId } });
      if (profile.sports.length > 0) {
        await transaction.userSport.createMany({
          data: profile.sports.map((sport) => ({
            userId: profile.userId,
            sport: sport.sport,
            paceValue: decimal(sport.paceValue),
            paceUnit: sport.paceUnit,
          })),
        });
      }
      await transaction.trainingTime.deleteMany({ where: { userId: profile.userId } });
      if (profile.trainingTimes.length > 0) {
        await transaction.trainingTime.createMany({
          data: profile.trainingTimes.map((time) => ({
            userId: profile.userId,
            weekday: time.weekday,
            timeBucket: time.timeBucket,
          })),
        });
      }
      const result = await transaction.profile.findUniqueOrThrow({ where: { userId: profile.userId } });
      return toStoredProfile(result, profile.sports, profile.trainingTimes);
    });
  }

  async replacePhoto(userId: string, objectKey: string | null): Promise<string | null> {
    return this.#client.$transaction(async (transaction) => {
      const existing = await transaction.profile.findUnique({ where: { userId } });
      const oldKey = existing?.photoKey ?? null;
      await transaction.profile.upsert({
        where: { userId },
        create: { userId, photoKey: objectKey },
        update: { photoKey: objectKey },
      });
      if (oldKey !== null && oldKey !== objectKey) {
        await transaction.photoCleanupJob.upsert({
          where: { objectKey: oldKey },
          create: { objectKey: oldKey },
          update: { nextAttempt: new Date() },
        });
      }
      return oldKey;
    });
  }

  async createPhotoUpload(input: {
    objectKey: string;
    userId: string;
    contentType: string;
    byteSize: number;
    expiresAt: Date;
  }): Promise<void> {
    await this.#client.profilePhotoUpload.create({ data: input });
  }

  async findPhotoUpload(objectKey: string, userId: string): Promise<{
    contentType: string;
    byteSize: number;
    expiresAt: Date;
  } | null> {
    return this.#client.profilePhotoUpload.findFirst({
      where: { objectKey, userId },
      select: { contentType: true, byteSize: true, expiresAt: true },
    });
  }

  async commitPhotoUpload(objectKey: string, userId: string, finalObjectKey: string): Promise<string | null> {
    return this.#client.$transaction(async (transaction) => {
      const upload = await transaction.profilePhotoUpload.findFirst({ where: { objectKey, userId } });
      if (upload === null) return null;
      const existing = await transaction.profile.findUnique({ where: { userId } });
      const oldKey = existing?.photoKey ?? null;
      await transaction.profile.upsert({
        where: { userId },
        create: { userId, photoKey: finalObjectKey },
        update: { photoKey: finalObjectKey },
      });
      await transaction.profilePhotoUpload.delete({ where: { objectKey } });
      await transaction.photoCleanupJob.upsert({
        where: { objectKey },
        create: { objectKey },
        update: { nextAttempt: new Date() },
      });
      if (oldKey !== null && oldKey !== finalObjectKey) {
        await transaction.photoCleanupJob.upsert({
          where: { objectKey: oldKey },
          create: { objectKey: oldKey },
          update: { nextAttempt: new Date() },
        });
      }
      return oldKey;
    });
  }

  async discardPhotoUpload(objectKey: string, userId: string): Promise<void> {
    await this.#client.profilePhotoUpload.deleteMany({ where: { objectKey, userId } });
  }

  async listExpiredPhotoUploads(
    limit: number,
    now: Date,
  ): Promise<Array<{ objectKey: string; userId: string }>> {
    return this.#client.profilePhotoUpload.findMany({
      where: { expiresAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { objectKey: true, userId: true },
    });
  }

  async listPhotoCleanupJobs(limit: number): Promise<string[]> {
    const jobs = await this.#client.photoCleanupJob.findMany({
      where: { nextAttempt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { objectKey: true },
    });
    return jobs.map((job) => job.objectKey);
  }

  async completePhotoCleanup(objectKey: string): Promise<void> {
    await this.#client.photoCleanupJob.deleteMany({ where: { objectKey } });
  }

  async delayPhotoCleanup(objectKey: string, nextAttempt: Date): Promise<void> {
    await this.#client.photoCleanupJob.updateMany({
      where: { objectKey },
      data: { attempts: { increment: 1 }, nextAttempt },
    });
  }
}

type ProfileRow = {
  userId: string;
  displayName: string | null;
  bio: string | null;
  photoKey: string | null;
  cityName: string | null;
  regionCode: string | null;
  countryCode: string | null;
  cityLatitude: Prisma.Decimal | null;
  cityLongitude: Prisma.Decimal | null;
  isComplete: boolean;
};

function toStoredProfile(
  profile: ProfileRow,
  sports: Array<{ sport: string; paceValue: Prisma.Decimal | number | null; paceUnit: string | null }>,
  trainingTimes: StoredTrainingTime[],
): StoredProfile {
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    bio: profile.bio,
    photoKey: profile.photoKey,
    cityName: profile.cityName,
    regionCode: profile.regionCode,
    countryCode: profile.countryCode,
    cityLatitude: profile.cityLatitude?.toNumber() ?? null,
    cityLongitude: profile.cityLongitude?.toNumber() ?? null,
    isComplete: profile.isComplete,
    sports: sports.map((sport) => ({
      sport: sport.sport,
      paceValue: sport.paceValue instanceof Prisma.Decimal ? sport.paceValue.toNumber() : sport.paceValue,
      paceUnit: sport.paceUnit,
    })),
    trainingTimes: trainingTimes.map((time) => ({ weekday: time.weekday, timeBucket: time.timeBucket })),
  };
}

function decimal(value: number | null): Prisma.Decimal | null {
  return value === null ? null : new Prisma.Decimal(value);
}
