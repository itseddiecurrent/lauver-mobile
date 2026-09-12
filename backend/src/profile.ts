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
  getPublicProfile(userId: string): Promise<ProfileResponse>;
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
  completePhotoUpload(userId: string, objectKey: string): Promise<ProfileResponse>;
  deletePhoto(userId: string): Promise<void>;
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

  async getPublicProfile(userId: string): Promise<ProfileResponse> {
    const profile = await this.#repository.findProfile(userId, true);
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

  async completePhotoUpload(userId: string, objectKey: string): Promise<ProfileResponse> {
    const upload = await this.#repository.findPhotoUpload(objectKey, userId);
    if (upload === null) {
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
    const finalObjectKey = `profile-photos/${userId}/${randomUUID()}.jpg`;
    await this.#storage.writeObject(finalObjectKey, sanitized, 'image/jpeg');
    let committed: string | null;
    try {
      committed = await this.#repository.commitPhotoUpload(objectKey, userId, finalObjectKey);
    } catch (error) {
      await Promise.allSettled([this.#storage.deleteObject(finalObjectKey)]);
      throw error;
    }
    if (committed === null && await this.#repository.findPhotoUpload(objectKey, userId) === null) {
      // A first photo has no previous key, so a null result can still be success.
      const current = await this.#repository.findProfile(userId);
      if (current?.photoKey !== finalObjectKey) {
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
  fastBoundary: number;
  moderateBoundary: number;
  higherIsFaster: boolean;
};

const paceDefinitions: Record<Sport, PaceDefinition> = {
  running: { unit: 'min/km', minimum: 2, maximum: 15, fastBoundary: 4.5, moderateBoundary: 6.5, higherIsFaster: false },
  trail_running: { unit: 'min/km', minimum: 3, maximum: 30, fastBoundary: 6, moderateBoundary: 9, higherIsFaster: false },
  cycling: { unit: 'km/h', minimum: 5, maximum: 80, fastBoundary: 30, moderateBoundary: 20, higherIsFaster: true },
  swimming: { unit: 'min/100m', minimum: 0.5, maximum: 10, fastBoundary: 1.5, moderateBoundary: 2.5, higherIsFaster: false },
  walking: { unit: 'min/km', minimum: 5, maximum: 30, fastBoundary: 9, moderateBoundary: 13, higherIsFaster: false },
  hiking: { unit: 'min/km', minimum: 5, maximum: 60, fastBoundary: 12, moderateBoundary: 20, higherIsFaster: false },
  rowing: { unit: 'min/500m', minimum: 0.8, maximum: 10, fastBoundary: 1.8, moderateBoundary: 2.5, higherIsFaster: false },
};

function normalizeSport(input: { sport: Sport; paceValue: number | null }): StoredSport {
  const definition = paceDefinitions[input.sport];
  if (input.paceValue === null) {
    return { sport: input.sport, paceValue: null, paceUnit: null, paceBracket: null };
  }
  if (input.paceValue < definition.minimum || input.paceValue > definition.maximum) {
    throw new ProfileError(
      422,
      'invalid_pace',
      `${input.sport} pace must be between ${definition.minimum} and ${definition.maximum} ${definition.unit}`,
    );
  }
  let paceBracket: string;
  if (definition.higherIsFaster) {
    paceBracket = input.paceValue >= definition.fastBoundary
      ? 'fast'
      : input.paceValue >= definition.moderateBoundary ? 'moderate' : 'easy';
  } else {
    paceBracket = input.paceValue <= definition.fastBoundary
      ? 'fast'
      : input.paceValue <= definition.moderateBoundary ? 'moderate' : 'easy';
  }
  return {
    sport: input.sport,
    paceValue: Math.round(input.paceValue * 100) / 100,
    paceUnit: definition.unit,
    paceBracket,
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
