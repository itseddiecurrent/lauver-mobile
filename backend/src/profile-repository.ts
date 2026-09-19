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
  photos?: StoredPhoto[];
  sports: StoredSport[];
  trainingTimes: StoredTrainingTime[];
};
export type StoredPhoto = { id: string; objectKey: string; sortOrder: number; isPrimary: boolean };

export type ProfileReplacement = Omit<StoredProfile, 'photoKey'>;

export interface ProfileRepository {
  findProfile(userId: string, requireActiveUser?: boolean, viewerId?: string): Promise<StoredProfile | null>;
  replaceProfile(profile: ProfileReplacement): Promise<StoredProfile>;
  replacePhoto(userId: string, objectKey: string | null): Promise<string | null>;
  listPhotos?(userId: string): Promise<StoredPhoto[]>;
  deletePhotoById?(userId: string, photoId: string): Promise<string | null>;
  reorderPhotos?(userId: string, photoIds: string[]): Promise<void>;
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
        photos: { orderBy: { sortOrder: 'asc' } },
        user: {
          include: {
            sports: { orderBy: { sport: 'asc' } },
            trainingTimes: { orderBy: [{ weekday: 'asc' }, { timeBucket: 'asc' }] },
          },
        },
      },
    });
    if (profile === null) return null;
    return toStoredProfile(profile, profile.user.sports, profile.user.trainingTimes, profile.photos);
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
      return toStoredProfile(result, profile.sports, profile.trainingTimes, await transaction.profilePhoto.findMany({ where: { userId: profile.userId }, orderBy: { sortOrder: 'asc' } }));
    });
  }

  async replacePhoto(userId: string, objectKey: string | null): Promise<string | null> {
    return this.#client.$transaction(async (transaction) => {
      const existing = await transaction.profile.findUnique({ where: { userId } });
      const oldKey = existing?.photoKey ?? null;
      if (objectKey === null) await transaction.profilePhoto.deleteMany({ where: { userId } });
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

  async listPhotos(userId: string): Promise<StoredPhoto[]> {
    return this.#client.profilePhoto.findMany({ where: { userId }, orderBy: { sortOrder: 'asc' }, select: { id: true, objectKey: true, sortOrder: true, isPrimary: true } });
  }

  async deletePhotoById(userId: string, photoId: string): Promise<string | null> {
    return this.#client.$transaction(async (tx) => {
      const photo = await tx.profilePhoto.findFirst({ where: { id: photoId, userId } });
      if (!photo) return null;
      await tx.profilePhoto.delete({ where: { id: photo.id } });
      // Deletion intentionally leaves sort_order gaps. The editor sends one
      // final reorder after uploads finish, avoiding an O(n) renumbering pass
      // and the unique-key collisions that pass can cause.
      const first = await tx.profilePhoto.findFirst({ where: { userId }, orderBy: { sortOrder: 'asc' } });
      await tx.profilePhoto.updateMany({ where: { userId }, data: { isPrimary: false } });
      if (first) await tx.profilePhoto.update({ where: { id: first.id }, data: { isPrimary: true } });
      await tx.profile.update({ where: { userId }, data: { photoKey: first?.objectKey ?? null } });
      await tx.photoCleanupJob.create({ data: { objectKey: photo.objectKey } }).catch(() => undefined);
      return photo.objectKey;
    });
  }

  async reorderPhotos(userId: string, photoIds: string[]): Promise<void> {
    await this.#client.$transaction(async (tx) => {
      const photos = await tx.profilePhoto.findMany({ where: { userId }, select: { id: true } });
      if (photos.length !== photoIds.length || photos.some((p) => !photoIds.includes(p.id))) throw new Error('invalid_photo_order');

      // sort_order is unique per user. Move every row out of the final
      // range first so swapping/reordering cannot collide with a row that
      // still has one of the target sort_order values.
      await Promise.all(photoIds.map((id, index) => tx.profilePhoto.update({
        where: { id },
        data: { sortOrder: -(index + 1), isPrimary: false },
      })));
      for (const [index, id] of photoIds.entries()) {
        await tx.profilePhoto.update({ where: { id }, data: { sortOrder: index, isPrimary: index === 0 } });
      }
      const first = await tx.profilePhoto.findFirst({ where: { userId, sortOrder: 0 } });
      await tx.profile.update({ where: { userId }, data: { photoKey: first?.objectKey ?? null } });
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
      const count = await transaction.profilePhoto.count({ where: { userId } });
      if (count === 0) {
        const oldKey = existing?.photoKey ?? null;
        await transaction.profile.upsert({
          where: { userId },
          create: { userId, photoKey: finalObjectKey },
          update: { photoKey: finalObjectKey },
        });
        await transaction.profilePhoto.create({ data: { userId, objectKey: finalObjectKey, sortOrder: 0, isPrimary: true } });
        if (oldKey !== null && oldKey !== finalObjectKey) {
          await transaction.photoCleanupJob.upsert({
            where: { objectKey: oldKey },
            create: { objectKey: oldKey },
            update: { nextAttempt: new Date() },
          });
        }
      } else if (count < 9) {
        // Additional photos must not replace or clean up the existing primary.
        // `profiles.photo_key` remains the canonical first photo key.
        await transaction.profilePhoto.create({ data: { userId, objectKey: finalObjectKey, sortOrder: count, isPrimary: false } });
      } else {
        throw new Error('photo_limit_reached');
      }
      await transaction.profilePhotoUpload.delete({ where: { objectKey } });
      // The temporary upload must be removed after the durable profile photo
      // is committed. Keep this as a cleanup job so a lost response or a
      // concurrent completion cannot leave the upload object behind.
      if (objectKey !== finalObjectKey) {
        await transaction.photoCleanupJob.upsert({
          where: { objectKey },
          create: { objectKey },
          update: { nextAttempt: new Date() },
        });
      }
      return count === 0 ? existing?.photoKey ?? null : null;
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
  photos: Array<{ id: string; objectKey: string; sortOrder: number; isPrimary: boolean }> = [],
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
    photos: photos.map(({ id, objectKey, sortOrder, isPrimary }) => ({ id, objectKey, sortOrder, isPrimary })),
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
