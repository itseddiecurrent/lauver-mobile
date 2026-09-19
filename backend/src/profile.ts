import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

import type {
  ProfileRepository,
  ProfileReplacement,
  StoredProfile,
  StoredSport,
  StoredTrainingTime,
} from './profile-repository.js';
import {
  ObjectStorageUnavailableError,
  type ProfilePhotoStorage,
} from './object-storage.js';

export const supportedSports = [
  'running',
  'trail_running',
  'cycling',
  'swimming',
  'walking',
  'hiking',
  'rowing',
] as const;
export type Sport = typeof supportedSports[number];

export const timeBuckets = ['morning', 'midday', 'evening'] as const;
export type TimeBucket = typeof timeBuckets[number];

export type ProfilePatch = {
  displayName?: string | null;
  bio?: string | null;
  city?: {
    name: string;
    regionCode: string | null;
    countryCode: string;
    latitude: number;
    longitude: number;
  } | null;
  sports?: Array<{ sport: Sport; paceValue: number | null }>;
  trainingTimes?: Array<{ weekday: number; timeBucket: TimeBucket }>;
};

export type ProfileResponse = {
  id: string;
  displayName: string | null;
  bio: string | null;
  photoURL: string | null;
  photos: Array<{ id: string; url: string; sortOrder: number; isPrimary: boolean }>;
  city: {
    name: string;
    regionCode: string | null;
    countryCode: string;
    latitude?: number;
    longitude?: number;
  } | null;
  sports: StoredSport[];
  trainingTimes: StoredTrainingTime[];
  isComplete: boolean;
};

export class ProfileError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly publicMessage: string;

  constructor(statusCode: number, code: string, publicMessage: string) {
    super(publicMessage);
    this.name = 'ProfileError';
    this.statusCode = statusCode;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export interface ProfileServicing {
  getOwnProfile(userId: string): Promise<ProfileResponse>;
  getOwnProfilePreview(userId: string): Promise<ProfileResponse>;
  getPublicProfile(userId: string, viewerId: string): Promise<ProfileResponse>;
  updateProfile(userId: string, patch: ProfilePatch): Promise<ProfileResponse>;
  createPhotoUpload(input: {
    userId: string;
    fileName: string;
    contentType: string;
    byteSize: number;
  }): Promise<{
    objectKey: string;
    uploadURL: string;
    expiresIn: number;
    requiredHeaders: { 'Content-Type': string };
  }>;
  createPhotoUploads?(inputs: Array<{
    clientID: string;
    userId: string;
    fileName: string;
    contentType: string;
    byteSize: number;
  }>): Promise<Array<{
    clientID: string;
    objectKey: string;
    uploadURL: string;
    expiresIn: number;
    requiredHeaders: { 'Content-Type': string };
  }>>;
  completePhotoUpload(userId: string, objectKey: string): Promise<ProfileResponse>;
  deletePhoto(userId: string): Promise<void>;
  deletePhotoById?(userId: string, photoId: string): Promise<void>;
  reorderPhotos?(userId: string, photoIds: string[]): Promise<ProfileResponse>;
  processPhotoCleanup(): Promise<void>;
}

const maximumPhotoBytes = 5 * 1_024 * 1_024;
const photoUploadTTLSeconds = 600;

export class ProfileService implements ProfileServicing {
  readonly #repository: ProfileRepository;
  readonly #storage: ProfilePhotoStorage;
  readonly #now: () => Date;

  constructor(options: {
    repository: ProfileRepository;
    storage: ProfilePhotoStorage;
    now?: () => Date;
  }) {
    this.#repository = options.repository;
    this.#storage = options.storage;
    this.#now = options.now ?? (() => new Date());
  }

  async getOwnProfile(userId: string): Promise<ProfileResponse> {
    const profile = await this.#repository.findProfile(userId);
    return this.#response(profile ?? emptyProfile(userId), true);
  }

  async getOwnProfilePreview(userId: string): Promise<ProfileResponse> {
    const profile = await this.#repository.findProfile(userId);
    // Reuse the public projection and deliberately omit coordinates, even for
    // the owner. This keeps Preview My Profile in lockstep with other-user UI.
    return this.#response(profile ?? emptyProfile(userId), false);
  }

  async getPublicProfile(userId: string, viewerId: string): Promise<ProfileResponse> {
    const profile = await this.#repository.findProfile(userId, true, viewerId);
    if (profile === null || !profile.isComplete) {
      throw new ProfileError(404, 'profile_not_found', 'Profile not found');
    }
    return this.#response(profile, false);
  }

  async updateProfile(userId: string, patch: ProfilePatch): Promise<ProfileResponse> {
    const current = await this.#repository.findProfile(userId) ?? emptyProfile(userId);
    const displayName = patch.displayName === undefined
      ? current.displayName
      : normalizeOptionalText(patch.displayName);
    const bio = patch.bio === undefined ? current.bio : normalizeOptionalText(patch.bio);
    const city = patch.city === undefined
      ? storedCity(current)
      : patch.city;
    const sports = patch.sports === undefined
      ? current.sports
      : patch.sports.map(normalizeSport);
    const trainingTimes = patch.trainingTimes === undefined
      ? current.trainingTimes
      : uniqueTrainingTimes(patch.trainingTimes);
    const replacement: ProfileReplacement = {
      userId,
      displayName,
      bio,
      cityName: city?.name ?? null,
      regionCode: city?.regionCode ?? null,
      countryCode: city?.countryCode ?? null,
      cityLatitude: city?.latitude ?? null,
      cityLongitude: city?.longitude ?? null,
      sports,
      trainingTimes,
      isComplete: displayName !== null && city !== null && sports.length > 0 && trainingTimes.length > 0,
    };
    return this.#response(await this.#repository.replaceProfile(replacement), true);
  }

  async createPhotoUpload(input: {
    userId: string;
    fileName: string;
    contentType: string;
    byteSize: number;
  }): Promise<{
    objectKey: string;
    uploadURL: string;
    expiresIn: number;
    requiredHeaders: { 'Content-Type': string };
  }> {
    const contentType = normalizePhotoMetadata(input.fileName, input.contentType, input.byteSize);
    const extension = canonicalExtension(contentType);
    const objectKey = `profile-photo-uploads/${input.userId}/${randomUUID()}.${extension}`;
    const expiresAt = new Date(this.#now().getTime() + photoUploadTTLSeconds * 1_000);
    let uploadURL: string;
    try {
      uploadURL = await this.#storage.createUploadURL({
        objectKey,
        contentType,
        byteSize: input.byteSize,
        expiresInSeconds: photoUploadTTLSeconds,
      });
    } catch (error) {
      if (error instanceof ObjectStorageUnavailableError) {
        throw new ProfileError(503, 'photo_storage_unavailable', 'Profile photo uploads are unavailable');
      }
      throw error;
    }
    await this.#repository.createPhotoUpload({
      objectKey,
      userId: input.userId,
      contentType,
      byteSize: input.byteSize,
      expiresAt,
    });
    return {
      objectKey,
      uploadURL,
      expiresIn: photoUploadTTLSeconds,
      requiredHeaders: { 'Content-Type': contentType },
    };
  }

  async createPhotoUploads(inputs: Array<{
    clientID: string;
    userId: string;
    fileName: string;
    contentType: string;
    byteSize: number;
  }>): Promise<Array<{
    clientID: string;
    objectKey: string;
    uploadURL: string;
    expiresIn: number;
    requiredHeaders: { 'Content-Type': string };
  }>> {
    return Promise.all(inputs.map(async (input) => ({
      clientID: input.clientID,
      ...(await this.createPhotoUpload(input)),
    })));
  }

  async completePhotoUpload(userId: string, objectKey: string): Promise<ProfileResponse> {
    // Preserve the upload UUID so a repeated completion can recognize its result,
    // even after the pending upload and temporary object have been cleaned up.
    const prefix = `profile-photo-uploads/${userId}/`;
    const fileName = objectKey.startsWith(prefix) ? objectKey.slice(prefix.length) : '';
    const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpeg|jpg|png|heic|heif)$/i.exec(fileName);
    if (match === null) {
      throw new ProfileError(422, 'invalid_photo_upload', 'The photo upload is invalid or expired');
    }
    const finalObjectKey = `profile-photos/${userId}/${match[1]}.jpg`;
    const upload = await this.#repository.findPhotoUpload(objectKey, userId);
    if (upload === null) {
      const current = await this.#repository.findProfile(userId);
      if (current?.photoKey === finalObjectKey) return this.getOwnProfile(userId);
      throw new ProfileError(422, 'invalid_photo_upload', 'The photo upload is invalid or expired');
    }
    if (upload.expiresAt <= this.#now()) {
      await Promise.allSettled([
        this.#storage.deleteObject(objectKey),
        this.#repository.discardPhotoUpload(objectKey, userId),
      ]);
      throw new ProfileError(422, 'invalid_photo_upload', 'The photo upload is invalid or expired');
    }
    const object = await this.#storage.readObject(objectKey);
    if (object === null) {
      const current = await this.#repository.findProfile(userId);
      if (current?.photoKey === finalObjectKey) return this.getOwnProfile(userId);
      throw new ProfileError(422, 'photo_upload_missing', 'The uploaded photo could not be found');
    }
    let sanitized: Uint8Array;
    try {
      validateUploadedObject(object.bytes, object.contentType, upload.contentType, upload.byteSize);
      sanitized = await sanitizeImage(object.bytes, upload.contentType);
    } catch (error) {
      await Promise.allSettled([
        this.#storage.deleteObject(objectKey),
        this.#repository.discardPhotoUpload(objectKey, userId),
      ]);
      throw error;
    }
    await this.#storage.writeObject(finalObjectKey, sanitized, 'image/jpeg');
    let committed: string | null;
    try {
      committed = await this.#repository.commitPhotoUpload(objectKey, userId, finalObjectKey);
    } catch (error) {
      if (error instanceof Error && error.message === 'photo_limit_reached') {
        await Promise.allSettled([this.#storage.deleteObject(objectKey), this.#storage.deleteObject(finalObjectKey), this.#repository.discardPhotoUpload(objectKey, userId)]);
        throw new ProfileError(422, 'photo_limit_reached', 'You can publish up to 9 profile photos');
      }
      // Another completion may have committed this same upload concurrently.
      const current = await this.#repository.findProfile(userId);
      if (current?.photoKey === finalObjectKey) return this.getOwnProfile(userId);
      await Promise.allSettled([this.#storage.deleteObject(finalObjectKey)]);
      throw error;
    }
    if (committed === null && await this.#repository.findPhotoUpload(objectKey, userId) === null) {
      // A first photo has no previous key, and appended photos intentionally
      // return no old primary key. In both cases the committed photo reference
      // is the durable source of truth.
      const current = await this.#repository.findProfile(userId);
      const committedPhoto = current?.photoKey === finalObjectKey
        || current?.photos?.some((photo) => photo.objectKey === finalObjectKey) === true;
      if (!committedPhoto) {
        await Promise.allSettled([this.#storage.deleteObject(finalObjectKey)]);
        throw new ProfileError(422, 'invalid_photo_upload', 'The photo upload is invalid or expired');
      }
    }
    await this.processPhotoCleanup();
    return this.getOwnProfile(userId);
  }

  async deletePhoto(userId: string): Promise<void> {
    await this.#repository.replacePhoto(userId, null);
    await this.processPhotoCleanup();
  }

  async deletePhotoById(userId: string, photoId: string): Promise<void> {
    if (this.#repository.deletePhotoById === undefined) {
      throw new ProfileError(501, 'photo_operation_unavailable', 'Photo management is unavailable');
    }
    const key = await this.#repository.deletePhotoById(userId, photoId);
    if (key !== null) await this.processPhotoCleanup();
  }

  async reorderPhotos(userId: string, photoIds: string[]): Promise<ProfileResponse> {
    if (this.#repository.reorderPhotos === undefined) {
      throw new ProfileError(501, 'photo_operation_unavailable', 'Photo management is unavailable');
    }
    await this.#repository.reorderPhotos(userId, photoIds);
    return this.getOwnProfile(userId);
  }

  async processPhotoCleanup(): Promise<void> {
    const expiredUploads = await this.#repository.listExpiredPhotoUploads(20, this.#now());
    await Promise.all(expiredUploads.map(async ({ objectKey, userId }) => {
      try {
        await this.#storage.deleteObject(objectKey);
        await this.#repository.discardPhotoUpload(objectKey, userId);
      } catch {
        // Keep the pending record so the next worker pass retries object deletion.
      }
    }));
    const keys = await this.#repository.listPhotoCleanupJobs(20);
    await Promise.all(keys.map(async (objectKey) => {
      try {
        await this.#storage.deleteObject(objectKey);
        await this.#repository.completePhotoCleanup(objectKey);
      } catch {
        await this.#repository.delayPhotoCleanup(
          objectKey,
          new Date(this.#now().getTime() + 5 * 60 * 1_000),
        );
      }
    }));
  }

  #response(profile: StoredProfile, includeCoordinates: boolean): ProfileResponse {
    return {
      id: profile.userId,
      displayName: profile.displayName,
      bio: profile.bio,
      photoURL: profile.photoKey === null ? null : this.#storage.publicURL(profile.photoKey),
      photos: (profile.photos ?? []).map((photo) => ({
        id: photo.id,
        url: this.#storage.publicURL(photo.objectKey),
        sortOrder: photo.sortOrder,
        isPrimary: photo.isPrimary,
      })),
      city: profile.cityName === null || profile.countryCode === null
        ? null
        : {
            name: profile.cityName,
            regionCode: profile.regionCode,
            countryCode: profile.countryCode,
            ...(includeCoordinates && profile.cityLatitude !== null && profile.cityLongitude !== null
              ? { latitude: profile.cityLatitude, longitude: profile.cityLongitude }
              : {}),
          },
      sports: profile.sports,
      trainingTimes: profile.trainingTimes,
      isComplete: profile.isComplete,
    };
  }
}

function emptyProfile(userId: string): StoredProfile {
  return {
    userId,
    displayName: null,
    bio: null,
    photoKey: null,
    photos: [],
    cityName: null,
    regionCode: null,
    countryCode: null,
    cityLatitude: null,
    cityLongitude: null,
    sports: [],
    trainingTimes: [],
    isComplete: false,
  };
}

function storedCity(profile: StoredProfile): NonNullable<ProfilePatch['city']> | null {
  if (
    profile.cityName === null ||
    profile.countryCode === null ||
    profile.cityLatitude === null ||
    profile.cityLongitude === null
  ) return null;
  return {
    name: profile.cityName,
    regionCode: profile.regionCode,
    countryCode: profile.countryCode,
    latitude: profile.cityLatitude,
    longitude: profile.cityLongitude,
  };
}

function normalizeOptionalText(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

type PaceDefinition = {
  unit: string;
  minimum: number;
  maximum: number;
};

export const paceDefinitions: Record<Sport, PaceDefinition> = {
  running: { unit: 'min/km', minimum: 2, maximum: 15 },
  trail_running: { unit: 'min/km', minimum: 3, maximum: 30 },
  cycling: { unit: 'km/h', minimum: 5, maximum: 80 },
  swimming: { unit: 'min/100m', minimum: 0.5, maximum: 10 },
  walking: { unit: 'min/km', minimum: 5, maximum: 30 },
  hiking: { unit: 'min/km', minimum: 5, maximum: 60 },
  rowing: { unit: 'min/500m', minimum: 0.8, maximum: 10 },
};

// Preserve whole-second duration paces in the database and use the same
// precision for inclusive Discover bounds (minutes are the API's stored unit).
export function normalizedPaceValue(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeSport(input: { sport: Sport; paceValue: number | null }): StoredSport {
  const definition = paceDefinitions[input.sport];
  if (input.paceValue === null) {
    return { sport: input.sport, paceValue: null, paceUnit: null };
  }
  if (input.paceValue < definition.minimum || input.paceValue > definition.maximum) {
    throw new ProfileError(
      422,
      'invalid_pace',
      `${input.sport} pace must be between ${definition.minimum} and ${definition.maximum} ${definition.unit}`,
    );
  }
  return {
    sport: input.sport,
    paceValue: normalizedPaceValue(definition.unit === 'km/h'
      ? input.paceValue : Math.round(input.paceValue * 60) / 60),
    paceUnit: definition.unit,
  };
}

function uniqueTrainingTimes(times: Array<{ weekday: number; timeBucket: TimeBucket }>): StoredTrainingTime[] {
  const seen = new Set<string>();
  return times.filter((time) => {
    const key = `${time.weekday}:${time.timeBucket}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.weekday - right.weekday || left.timeBucket.localeCompare(right.timeBucket));
}

function normalizePhotoMetadata(fileName: string, contentType: string, byteSize: number): string {
  if (!Number.isInteger(byteSize) || byteSize <= 0 || byteSize > maximumPhotoBytes) {
    throw new ProfileError(422, 'invalid_photo_size', 'Photo must be no larger than 5 MB');
  }
  const normalizedType = contentType.toLowerCase();
  const extension = fileName.split('.').pop()?.toLowerCase();
  const allowedExtensions: Record<string, readonly string[]> = {
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/heic': ['heic'],
    'image/heif': ['heif'],
  };
  if (extension === undefined || !allowedExtensions[normalizedType]?.includes(extension)) {
    throw new ProfileError(422, 'invalid_photo_type', 'Photo must be a JPEG, PNG, HEIC, or HEIF image');
  }
  return normalizedType;
}

function canonicalExtension(contentType: string): string {
  if (contentType === 'image/jpeg') return 'jpg';
  return contentType.slice('image/'.length);
}

function validateUploadedObject(
  bytes: Uint8Array,
  storedContentType: string | null,
  expectedContentType: string,
  expectedByteSize: number,
): void {
  if (bytes.length !== expectedByteSize || bytes.length > maximumPhotoBytes) {
    throw new ProfileError(422, 'invalid_photo_size', 'Uploaded photo size does not match the request');
  }
  const normalizedStored = storedContentType?.split(';')[0]?.trim().toLowerCase() ?? null;
  const expectedFamily = heifFamily(expectedContentType);
  const storedFamily = normalizedStored === null ? null : heifFamily(normalizedStored);
  if (storedFamily !== null && storedFamily !== expectedFamily) {
    throw new ProfileError(422, 'invalid_photo_content', 'Uploaded file content is not the declared image type');
  }
}

async function sanitizeImage(bytes: Uint8Array, expectedContentType: string): Promise<Uint8Array> {
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 4096 * 4096 });
    const metadata = await image.metadata();
    const actualContentType = metadata.format === 'heif' ? 'image/heic' : `image/${metadata.format ?? ''}`;
    if (actualContentType !== heifFamily(expectedContentType)) {
      throw new ProfileError(422, 'invalid_photo_content', 'Uploaded file content is not the declared image type');
    }
    if (
      metadata.width === undefined || metadata.height === undefined ||
      metadata.width < 128 || metadata.height < 128 ||
      metadata.width > 4096 || metadata.height > 4096
    ) {
      throw new ProfileError(422, 'invalid_photo_dimensions', 'Photo dimensions must be between 128 and 4096 pixels');
    }
    // Re-encoding strips EXIF/GPS and other metadata before the object becomes public.
    return await image
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'cover', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    throw new ProfileError(422, 'invalid_photo_content', 'Uploaded file is not a supported image');
  }
}

function heifFamily(contentType: string): string {
  return contentType === 'image/heif' ? 'image/heic' : contentType;
}
