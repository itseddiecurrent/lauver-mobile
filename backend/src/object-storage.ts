import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type StoredObject = {
  bytes: Uint8Array;
  contentType: string | null;
};

export interface ProfilePhotoStorage {
  createUploadURL(input: {
    objectKey: string;
    contentType: string;
    byteSize: number;
    expiresInSeconds: number;
  }): Promise<string>;
  readObject(objectKey: string): Promise<StoredObject | null>;
  writeObject(objectKey: string, bytes: Uint8Array, contentType: string): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
  publicURL(objectKey: string): string;
}

export class ObjectStorageUnavailableError extends Error {
  constructor() {
    super('Profile photo storage is unavailable');
    this.name = 'ObjectStorageUnavailableError';
  }
}

export class UnavailableProfilePhotoStorage implements ProfilePhotoStorage {
  createUploadURL(): Promise<string> {
    return Promise.reject(new ObjectStorageUnavailableError());
  }

  readObject(): Promise<StoredObject | null> {
    return Promise.reject(new ObjectStorageUnavailableError());
  }

  writeObject(): Promise<void> {
    return Promise.reject(new ObjectStorageUnavailableError());
  }

  deleteObject(): Promise<void> {
    return Promise.reject(new ObjectStorageUnavailableError());
  }

  publicURL(_objectKey: string): string {
    void _objectKey;
    throw new ObjectStorageUnavailableError();
  }
}

export type S3ProfilePhotoStorageOptions = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyID: string;
  secretAccessKey: string;
  publicBaseURL: string;
  forcePathStyle: boolean;
};

export class S3ProfilePhotoStorage implements ProfilePhotoStorage {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #publicBaseURL: string;

  constructor(options: S3ProfilePhotoStorageOptions) {
    this.#bucket = options.bucket;
    this.#publicBaseURL = options.publicBaseURL.replace(/\/$/, '');
    this.#client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: options.accessKeyID,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  createUploadURL(input: {
    objectKey: string;
    contentType: string;
    byteSize: number;
    expiresInSeconds: number;
  }): Promise<string> {
    return getSignedUrl(
      this.#client,
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: input.objectKey,
        ContentType: input.contentType,
        ContentLength: input.byteSize,
      }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  async readObject(objectKey: string): Promise<StoredObject | null> {
    try {
      const response = await this.#client.send(new GetObjectCommand({
        Bucket: this.#bucket,
        Key: objectKey,
        // Bound memory even if a client uploads more than the declared maximum.
        Range: `bytes=0-${5 * 1_024 * 1_024}`,
      }));
      if (response.Body === undefined) return null;
      return {
        bytes: await response.Body.transformToByteArray(),
        contentType: response.ContentType ?? null,
      };
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw error;
    }
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({
      Bucket: this.#bucket,
      Key: objectKey,
    }));
  }

  async writeObject(objectKey: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.#client.send(new PutObjectCommand({
      Bucket: this.#bucket,
      Key: objectKey,
      Body: bytes,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));
  }

  publicURL(objectKey: string): string {
    const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
    // Supabase's public object endpoint is rooted at
    // `/storage/v1/object/public`, with the bucket as the next path segment.
    // A custom CDN base, on the other hand, normally already maps directly to
    // the bucket and must keep the old `${base}/${key}` shape.
    const baseURL = this.#publicBaseURL.endsWith('/storage/v1/object/public')
      ? `${this.#publicBaseURL}/${encodeURIComponent(this.#bucket)}`
      : this.#publicBaseURL;
    return `${baseURL}/${encodedKey}`;
  }
}

function isMissingObject(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === 'NoSuchKey' || candidate.$metadata?.httpStatusCode === 404;
}
