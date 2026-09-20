import { describe, expect, it } from 'vitest';

import { S3ProfilePhotoStorage } from '../src/object-storage.js';

const options = {
  endpoint: 'https://storage.example.test/s3',
  region: 'us-west-2',
  bucket: 'profile-photos',
  accessKeyID: 'test-access-key',
  secretAccessKey: 'test-secret-key',
  forcePathStyle: true,
};

describe('S3ProfilePhotoStorage public URLs', () => {
  it('includes the bucket for Supabase public object URLs', () => {
    const storage = new S3ProfilePhotoStorage({
      ...options,
      publicBaseURL: 'https://project.supabase.co/storage/v1/object/public',
    });

    expect(storage.publicURL('profile-photos/user/photo id.jpg'))
      .toBe('https://project.supabase.co/storage/v1/object/public/profile-photos/profile-photos/user/photo%20id.jpg');
  });

  it('keeps custom CDN URLs rooted at the configured base', () => {
    const storage = new S3ProfilePhotoStorage({
      ...options,
      publicBaseURL: 'https://photos.example.test',
    });

    expect(storage.publicURL('profile-photos/user/photo.jpg'))
      .toBe('https://photos.example.test/profile-photos/user/photo.jpg');
  });
});
