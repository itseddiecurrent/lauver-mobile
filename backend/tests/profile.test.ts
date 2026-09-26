import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import type { ProfilePhotoStorage, StoredObject } from '../src/object-storage.js';
import type {
  ProfileReplacement,
  ProfileRepository,
  StoredProfile,
} from '../src/profile-repository.js';
import { ProfileService } from '../src/profile.js';

class MemoryProfileRepository implements ProfileRepository {
  profile: StoredProfile | null = null;
  uploads = new Map<string, { userId: string; contentType: string; byteSize: number; expiresAt: Date }>();
  cleanup = new Set<string>();

  findProfile(userId: string): Promise<StoredProfile | null> {
    return Promise.resolve(this.profile?.userId === userId ? structuredClone(this.profile) : null);
  }

  replaceProfile(profile: ProfileReplacement): Promise<StoredProfile> {
    this.profile = { ...structuredClone(profile), photoKey: this.profile?.photoKey ?? null };
    return Promise.resolve(structuredClone(this.profile));
  }

  replacePhoto(userId: string, objectKey: string | null): Promise<string | null> {
    const oldKey = this.profile?.photoKey ?? null;
    if (objectKey === null) {
      for (const photo of this.profile?.photos ?? []) this.cleanup.add(photo.objectKey);
      this.profile = { ...(this.profile ?? emptyStoredProfile(userId)), photoKey: null, photos: [] };
      if (oldKey !== null) this.cleanup.add(oldKey);
      return Promise.resolve(oldKey);
    }
    this.profile = { ...(this.profile ?? emptyStoredProfile(userId)), photoKey: objectKey };
    if (oldKey !== null && oldKey !== objectKey) this.cleanup.add(oldKey);
    return Promise.resolve(oldKey);
  }

  createPhotoUpload(input: {
    objectKey: string;
    userId: string;
    contentType: string;
    byteSize: number;
    expiresAt: Date;
  }): Promise<void> {
    this.uploads.set(input.objectKey, input);
    return Promise.resolve();
  }

  findPhotoUpload(objectKey: string, userId: string) {
    const upload = this.uploads.get(objectKey);
    if (upload?.userId !== userId) return Promise.resolve(null);
    return Promise.resolve({
      contentType: upload.contentType,
      byteSize: upload.byteSize,
      expiresAt: upload.expiresAt,
    });
  }

  commitPhotoUpload(objectKey: string, userId: string, finalObjectKey: string): Promise<string | null> {
    const upload = this.uploads.get(objectKey);
    if (upload?.userId !== userId) return Promise.resolve(null);
    this.uploads.delete(objectKey);
    this.cleanup.add(objectKey);
    const profile = this.profile ?? emptyStoredProfile(userId);
    const photos = profile.photos ?? [];
    if (photos.length === 0) {
      const oldKey = profile.photoKey;
      this.profile = {
        ...profile,
        photoKey: finalObjectKey,
        photos: [{ id: 'photo-1', objectKey: finalObjectKey, sortOrder: 0, isPrimary: true }],
      };
      if (oldKey !== null && oldKey !== finalObjectKey) this.cleanup.add(oldKey);
      return Promise.resolve(oldKey);
    }
    this.profile = {
      ...profile,
      photos: [...photos, { id: `photo-${photos.length + 1}`, objectKey: finalObjectKey, sortOrder: photos.length, isPrimary: false }],
    };
    return Promise.resolve(null);
  }

  discardPhotoUpload(objectKey: string, userId: string): Promise<void> {
    if (this.uploads.get(objectKey)?.userId === userId) this.uploads.delete(objectKey);
    return Promise.resolve();
  }

  schedulePhotoCleanup(objectKey: string): Promise<void> {
    this.cleanup.add(objectKey);
    return Promise.resolve();
  }

  listExpiredPhotoUploads(limit: number, now: Date): Promise<Array<{ objectKey: string; userId: string }>> {
    return Promise.resolve([...this.uploads.entries()]
      .filter(([, upload]) => upload.expiresAt <= now)
      .slice(0, limit)
      .map(([objectKey, upload]) => ({ objectKey, userId: upload.userId })));
  }

  listPhotoCleanupJobs(limit: number): Promise<string[]> {
    return Promise.resolve([...this.cleanup].slice(0, limit));
  }

  completePhotoCleanup(objectKey: string): Promise<void> {
    this.cleanup.delete(objectKey);
    return Promise.resolve();
  }

  delayPhotoCleanup(_objectKey: string, _nextAttempt: Date): Promise<void> {
    void _objectKey;
    void _nextAttempt;
    return Promise.resolve();
  }
}

class MemoryPhotoStorage implements ProfilePhotoStorage {
  objects = new Map<string, StoredObject>();
  deleted: string[] = [];
  deleteError: Error | null = null;

  createUploadURL(input: { objectKey: string }): Promise<string> {
    return Promise.resolve(`https://uploads.example/${input.objectKey}`);
  }

  readObject(objectKey: string): Promise<StoredObject | null> {
    return Promise.resolve(this.objects.get(objectKey) ?? null);
  }

  deleteObject(objectKey: string): Promise<void> {
    if (this.deleteError !== null) return Promise.reject(this.deleteError);
    this.deleted.push(objectKey);
    this.objects.delete(objectKey);
    return Promise.resolve();
  }

  writeObject(objectKey: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(objectKey, { bytes, contentType });
    return Promise.resolve();
  }

  publicURL(objectKey: string): string {
    return `https://photos.example/${objectKey}`;
  }
}

describe('ProfileService', () => {
  it('immediately removes a failed pending upload and is safe to repeat', async () => {
    const repository = new MemoryProfileRepository();
    const storage = new MemoryPhotoStorage();
    const service = new ProfileService({ repository, storage });
    const upload = await service.createPhotoUpload({
      userId: 'user-1', fileName: 'photo.jpg', contentType: 'image/jpeg', byteSize: 100,
    });
    storage.objects.set(upload.objectKey, { bytes: new Uint8Array(100), contentType: 'image/jpeg' });

    await service.cancelPhotoUpload('user-1', upload.objectKey);
    await service.cancelPhotoUpload('user-1', upload.objectKey);

    expect(repository.uploads.has(upload.objectKey)).toBe(false);
    expect(storage.objects.has(upload.objectKey)).toBe(false);
    expect(storage.deleted).toEqual([upload.objectKey]);
  });

  it('queues cleanup when object storage is temporarily unavailable during cancellation', async () => {
    const repository = new MemoryProfileRepository();
    const storage = new MemoryPhotoStorage();
    const service = new ProfileService({ repository, storage });
    const upload = await service.createPhotoUpload({
      userId: 'user-1', fileName: 'photo.jpg', contentType: 'image/jpeg', byteSize: 100,
    });
    storage.deleteError = new Error('TLS handshake failed');

    await expect(service.cancelPhotoUpload('user-1', upload.objectKey)).resolves.toBeUndefined();
    expect(repository.uploads.has(upload.objectKey)).toBe(false);
    expect(repository.cleanup.has(upload.objectKey)).toBe(true);
  });

  it('stores duration paces as displayed whole seconds and preserves decimal cycling speed', async () => {
    const service = new ProfileService({ repository: new MemoryProfileRepository(), storage: new MemoryPhotoStorage() });
    const profile = await service.updateProfile('user-1', {
      sports: [{ sport: 'running', paceValue: 5.02 }, { sport: 'cycling', paceValue: 25.123456 }],
    });
    expect(profile.sports).toEqual([
      { sport: 'running', paceValue: 5.016667, paceUnit: 'min/km' },
      { sport: 'cycling', paceValue: 25.123456, paceUnit: 'km/h' },
    ]);
  });

  it('derives pace units and marks required profile fields complete without subjective classifications', async () => {
    const repository = new MemoryProfileRepository();
    const service = new ProfileService({ repository, storage: new MemoryPhotoStorage() });

    const profile = await service.updateProfile('user-1', {
      displayName: ' Alex Runner ',
      bio: 'Early miles.',
      city: {
        name: 'Shanghai',
        regionCode: 'SH',
        countryCode: 'CN',
        latitude: 31.2304,
        longitude: 121.4737,
      },
      sports: [
        { sport: 'running', paceValue: 4.25 },
        { sport: 'cycling', paceValue: 24 },
        { sport: 'swimming', paceValue: null },
      ],
      trainingTimes: [
        { weekday: 1, timeBucket: 'morning' },
        { weekday: 1, timeBucket: 'morning' },
      ],
    });

    expect(profile.displayName).toBe('Alex Runner');
    expect(profile.isComplete).toBe(true);
    expect(profile.sports).toEqual([
      { sport: 'running', paceValue: 4.25, paceUnit: 'min/km' },
      { sport: 'cycling', paceValue: 24, paceUnit: 'km/h' },
      { sport: 'swimming', paceValue: null, paceUnit: null },
    ]);
    expect(profile.trainingTimes).toEqual([{ weekday: 1, timeBucket: 'morning' }]);
  });

  it.each([
    ['running', -1],
    ['running', 20],
    ['cycling', 100],
    ['swimming', 0.1],
    ['rowing', 20],
  ] as const)('rejects an extreme %s pace of %s', async (sport, paceValue) => {
    const service = new ProfileService({
      repository: new MemoryProfileRepository(),
      storage: new MemoryPhotoStorage(),
    });
    await expect(service.updateProfile('user-1', {
      sports: [{ sport, paceValue }],
    })).rejects.toMatchObject({ code: 'invalid_pace', statusCode: 422 });
  });

  it('never exposes city center coordinates from another-user responses', async () => {
    const repository = new MemoryProfileRepository();
    repository.profile = {
      ...emptyStoredProfile('user-2'),
      displayName: 'Taylor',
      cityName: 'Shanghai',
      countryCode: 'CN',
      cityLatitude: 31.2304,
      cityLongitude: 121.4737,
      sports: [{ sport: 'running', paceValue: 6, paceUnit: 'min/km' }],
      trainingTimes: [{ weekday: 2, timeBucket: 'evening' }],
      isComplete: true,
    };
    const service = new ProfileService({ repository, storage: new MemoryPhotoStorage() });

    const publicProfile = await service.getPublicProfile('user-2', 'user-1');

    expect(publicProfile.city).toEqual({ name: 'Shanghai', regionCode: null, countryCode: 'CN' });
    expect(JSON.stringify(publicProfile)).not.toContain('latitude');
    expect(JSON.stringify(publicProfile)).not.toContain('longitude');
  });

  it('rejects disguised extensions before issuing an upload URL', async () => {
    const service = new ProfileService({
      repository: new MemoryProfileRepository(),
      storage: new MemoryPhotoStorage(),
    });
    await expect(service.createPhotoUpload({
      userId: 'user-1',
      fileName: 'avatar.txt',
      contentType: 'image/png',
      byteSize: 24,
    })).rejects.toMatchObject({ code: 'invalid_photo_type' });
  });

  it('inspects image bytes, replaces the avatar, and deletes the previous object', async () => {
    const repository = new MemoryProfileRepository();
    repository.profile = { ...emptyStoredProfile('user-1'), photoKey: 'profile-photos/user-1/old.png' };
    const storage = new MemoryPhotoStorage();
    const service = new ProfileService({ repository, storage });
    const image = await pngImage(300, 200);
    const upload = await service.createPhotoUpload({
      userId: 'user-1',
      fileName: 'avatar.png',
      contentType: 'image/png',
      byteSize: image.length,
    });
    storage.objects.set(upload.objectKey, { bytes: image, contentType: 'image/png' });

    const profile = await service.completePhotoUpload('user-1', upload.objectKey);

    expect(profile.photoId).toBe('photo-1');
    expect(profile.photoURL).toMatch(/^https:\/\/photos\.example\/profile-photos\/user-1\/.+\.jpg$/);
    const finalKey = profile.photoURL?.replace('https://photos.example/', '');
    if (finalKey === undefined) throw new Error('Expected a final photo URL');
    const finalObject = storage.objects.get(finalKey);
    if (finalObject === undefined) throw new Error('Expected a sanitized stored object');
    expect(finalObject.contentType).toBe('image/jpeg');
    expect((await sharp(finalObject.bytes).metadata()).format).toBe('jpeg');
    expect(storage.deleted).toContain('profile-photos/user-1/old.png');
    expect(storage.deleted).toContain(upload.objectKey);
    expect(repository.cleanup.size).toBe(0);
  });

  it('returns the committed photo when completion is retried after a lost response', async () => {
    const repository = new MemoryProfileRepository();
    const storage = new MemoryPhotoStorage();
    const service = new ProfileService({ repository, storage });
    const image = await pngImage(300, 200);
    const upload = await service.createPhotoUpload({
      userId: 'user-1', fileName: 'avatar.png', contentType: 'image/png', byteSize: image.length,
    });
    storage.objects.set(upload.objectKey, { bytes: image, contentType: 'image/png' });
    const first = await service.completePhotoUpload('user-1', upload.objectKey);
    expect(repository.uploads.has(upload.objectKey)).toBe(false);
    expect(storage.objects.has(upload.objectKey)).toBe(false);

    expect(await service.completePhotoUpload('user-1', upload.objectKey)).toEqual(first);
    expect(storage.objects.size).toBe(1);
    await expect(service.completePhotoUpload('user-2', upload.objectKey))
      .rejects.toMatchObject({ code: 'invalid_photo_upload' });
    const replacement = await service.createPhotoUpload({
      userId: 'user-1', fileName: 'replacement.png', contentType: 'image/png', byteSize: image.length,
    });
    storage.objects.set(replacement.objectKey, { bytes: image, contentType: 'image/png' });
    await service.completePhotoUpload('user-1', replacement.objectKey);
    const retriedAfterAppend = await service.completePhotoUpload('user-1', upload.objectKey);
    expect(retriedAfterAppend.photoURL).toBe(first.photoURL);
    expect(retriedAfterAppend.photos).toHaveLength(2);
    expect(storage.objects.size).toBe(2);
    await service.deletePhoto('user-1');
    await expect(service.completePhotoUpload('user-1', replacement.objectKey))
      .rejects.toMatchObject({ code: 'invalid_photo_upload' });
    expect(storage.objects.size).toBe(0);
  });

  it('preserves existing profile photos when appending another photo', async () => {
    const repository = new MemoryProfileRepository();
    const storage = new MemoryPhotoStorage();
    const service = new ProfileService({ repository, storage });
    const image = await pngImage(300, 200);

    for (const name of ['first.png', 'second.png']) {
      const upload = await service.createPhotoUpload({
        userId: 'user-1', fileName: name, contentType: 'image/png', byteSize: image.length,
      });
      storage.objects.set(upload.objectKey, { bytes: image, contentType: 'image/png' });
      await service.completePhotoUpload('user-1', upload.objectKey);
    }

    expect(repository.profile?.photos?.map(photo => photo.sortOrder)).toEqual([0, 1]);
    expect(repository.profile?.photos?.map(photo => photo.objectKey)).toHaveLength(2);
    expect(storage.deleted.filter(key => key.startsWith('profile-photos/'))).toHaveLength(0);
  });

  it('concurrent completion retries preserve a single final object', async () => {
    const repository = new MemoryProfileRepository();
    const commit = repository.commitPhotoUpload.bind(repository);
    repository.commitPhotoUpload = (objectKey, userId, finalKey) => {
      // Prisma's transaction can fail when another request already deleted the row.
      if (!repository.uploads.has(objectKey)) return Promise.reject(new Error('Upload already committed'));
      return commit(objectKey, userId, finalKey);
    };
    const storage = new MemoryPhotoStorage();
    const service = new ProfileService({ repository, storage });
    const image = await pngImage(300, 200);
    const upload = await service.createPhotoUpload({
      userId: 'user-1', fileName: 'avatar.png', contentType: 'image/png', byteSize: image.length,
    });
    storage.objects.set(upload.objectKey, { bytes: image, contentType: 'image/png' });
    const [first, second] = await Promise.all([
      service.completePhotoUpload('user-1', upload.objectKey),
      service.completePhotoUpload('user-1', upload.objectKey),
    ]);
    expect(first.photoURL).toBe(second.photoURL);
    expect(storage.objects.has(repository.profile?.photoKey ?? '')).toBe(true);
    expect(storage.objects.size).toBe(1);
  });

  it('rejects non-image upload content and removes the invalid object', async () => {
    const repository = new MemoryProfileRepository();
    const storage = new MemoryPhotoStorage();
    const service = new ProfileService({ repository, storage });
    const upload = await service.createPhotoUpload({
      userId: 'user-1',
      fileName: 'avatar.png',
      contentType: 'image/png',
      byteSize: 24,
    });
    storage.objects.set(upload.objectKey, { bytes: new Uint8Array(24), contentType: 'image/png' });

    await expect(service.completePhotoUpload('user-1', upload.objectKey))
      .rejects.toMatchObject({ code: 'invalid_photo_content' });
    expect(storage.deleted).toContain(upload.objectKey);
    expect(repository.uploads.has(upload.objectKey)).toBe(false);
  });

  it('rejects a decodable image outside the allowed dimension range', async () => {
    const repository = new MemoryProfileRepository();
    const storage = new MemoryPhotoStorage();
    const service = new ProfileService({ repository, storage });
    const image = await pngImage(64, 64);
    const upload = await service.createPhotoUpload({
      userId: 'user-1',
      fileName: 'avatar.png',
      contentType: 'image/png',
      byteSize: image.length,
    });
    storage.objects.set(upload.objectKey, { bytes: image, contentType: 'image/png' });

    await expect(service.completePhotoUpload('user-1', upload.objectKey))
      .rejects.toMatchObject({ code: 'invalid_photo_dimensions' });
    expect(storage.deleted).toContain(upload.objectKey);
  });

  it('removes abandoned expired uploads during background cleanup', async () => {
    const repository = new MemoryProfileRepository();
    const storage = new MemoryPhotoStorage();
    const now = new Date('2026-09-10T10:00:00.000Z');
    repository.uploads.set('profile-photos/user-1/expired.png', {
      userId: 'user-1',
      contentType: 'image/png',
      byteSize: 24,
      expiresAt: new Date(now.getTime() - 1),
    });
    storage.objects.set('profile-photos/user-1/expired.png', {
      bytes: new Uint8Array(24),
      contentType: 'image/png',
    });
    const service = new ProfileService({ repository, storage, now: () => now });

    await service.processPhotoCleanup();

    expect(storage.deleted).toContain('profile-photos/user-1/expired.png');
    expect(repository.uploads.size).toBe(0);
  });
});

function emptyStoredProfile(userId: string): StoredProfile {
  return {
    userId,
    displayName: null,
    bio: null,
    photoKey: null,
    cityName: null,
    regionCode: null,
    countryCode: null,
    cityLatitude: null,
    cityLongitude: null,
    isComplete: false,
    sports: [],
    trainingTimes: [],
  };
}

async function pngImage(width: number, height: number): Promise<Uint8Array> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 232, g: 96, b: 44 },
    },
  }).png().toBuffer();
}
