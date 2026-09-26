import type { Express, NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';

import type { AuthServicing, AuthUser } from './auth.js';
import {
  type ProfileServicing,
  supportedSports,
  timeBuckets,
} from './profile.js';
import { RateLimitExceededError, type InMemoryRateLimiter } from './rate-limiter.js';

const sportSchema = z.enum(supportedSports);
const timeBucketSchema = z.enum(timeBuckets);
const citySchema = z.object({
  name: z.string().trim().min(1).max(120),
  regionCode: z.string().trim().min(1).max(16).nullable(),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
}).strict();
const profilePatchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).nullable().optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  city: citySchema.nullable().optional(),
  sports: z.array(z.object({
    sport: sportSchema,
    paceValue: z.number().finite().positive().nullable(),
  }).strict()).max(supportedSports.length).refine(
    (sports) => new Set(sports.map((sport) => sport.sport)).size === sports.length,
    { message: 'Sports must be unique' },
  ).optional(),
  trainingTimes: z.array(z.object({
    weekday: z.number().int().min(1).max(7),
    timeBucket: timeBucketSchema,
  }).strict()).max(21).refine(
    (times) => new Set(times.map((time) => `${time.weekday}:${time.timeBucket}`)).size === times.length,
    { message: 'Training times must be unique' },
  ).optional(),
}).strict();
const photoReorderSchema = z.object({ photoIds: z.array(z.uuid()).min(1).max(9) }).strict();
const userIDSchema = z.uuid();
const multipartPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 5 * 1_024 * 1_024, fields: 4 },
});

export type ProfileRouteDependencies = {
  authService: AuthServicing;
  profileService: ProfileServicing;
  rateLimiter: InMemoryRateLimiter;
};

export function installProfileRoutes(app: Express, dependencies: ProfileRouteDependencies): void {
  app.get('/v1/me', authenticated(dependencies.authService, async (user, _request, response) => {
    response.status(200).json({ profile: await dependencies.profileService.getOwnProfile(user.id) });
  }));

  app.get('/v1/me/preview', authenticated(dependencies.authService, async (user, _request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({ profile: await dependencies.profileService.getOwnProfilePreview(user.id) });
  }));

  app.patch('/v1/me', authenticated(dependencies.authService, async (user, request, response) => {
    const body = parseBody(profilePatchSchema, request, response);
    if (body === null) return;
    response.status(200).json({
      profile: await dependencies.profileService.updateProfile(user.id, body),
    });
  }));

  // The API owns the complete upload lifecycle.  Native clients send one
  // multipart part named `photo` and the requested one-based `photoOrder`;
  // they never receive object-storage credentials or a signed URL.
  app.post('/v1/me/photos', authenticated(dependencies.authService, async (user, request, response) => {
    if (!consumePhotoBatchRateLimit(user.id, request, response, dependencies.rateLimiter)) return;
    await parseMultipartPhoto(request, response);
    if (response.headersSent) return;
    const file = request.file;
    const fields = request.body as Record<string, unknown>;
    const photoOrder = typeof fields.photoOrder === 'string' ? Number(fields.photoOrder) : Number.NaN;
    if (file === undefined || !Number.isInteger(photoOrder) || photoOrder < 1 || photoOrder > 9) {
      validationResponse(response);
      return;
    }
    const uploaded = await dependencies.profileService.uploadPhotoStream(
      user.id, file.buffer, file.mimetype, photoOrder,
    );
    response.status(201).json(uploaded);
  }));

  app.get('/v1/users/:userId', authenticated(dependencies.authService, async (user, request, response) => {
    const userID = userIDSchema.safeParse(request.params.userId);
    if (!userID.success) {
      validationResponse(response);
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({ profile: await dependencies.profileService.getPublicProfile(userID.data, user.id) });
  }));

  app.delete('/v1/me/photo', authenticated(dependencies.authService, async (user, _request, response) => {
    await dependencies.profileService.deletePhoto(user.id);
    response.status(204).send();
  }));

  app.delete('/v1/me/photos/:photoId', authenticated(dependencies.authService, async (user, request, response) => {
    const photoID = userIDSchema.safeParse(request.params.photoId);
    if (!photoID.success || dependencies.profileService.deletePhotoById === undefined) {
      validationResponse(response);
      return;
    }
    await dependencies.profileService.deletePhotoById(user.id, photoID.data);
    response.status(204).send();
  }));

  app.patch('/v1/me/photos/order', authenticated(dependencies.authService, async (user, request, response) => {
    const body = parseBody(photoReorderSchema, request, response);
    if (body === null || dependencies.profileService.reorderPhotos === undefined) return;
    response.status(200).json({ profile: await dependencies.profileService.reorderPhotos(user.id, body.photoIds) });
  }));
}

function parseMultipartPhoto(request: Request, response: Response): Promise<void> {
  return new Promise((resolve) => {
    multipartPhoto.single('photo')(request, response, (error: unknown) => {
      if (error !== undefined && error !== null) {
        validationResponse(response);
      }
      resolve();
    });
  });
}

type AuthenticatedHandler = (
  user: AuthUser,
  request: Request,
  response: Response,
) => Promise<void>;

export function authenticated(authService: AuthServicing, handler: AuthenticatedHandler) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const authorization = request.get('authorization');
    const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    try {
      const user = await authService.restore(accessToken);
      await handler(user, request, response);
    } catch (error) {
      next(error);
    }
  };
}

function parseBody<T extends z.ZodType>(
  schema: T,
  request: Request,
  response: Response,
): z.infer<T> | null {
  const parsed = schema.safeParse(request.body);
  if (parsed.success) return parsed.data;
  validationResponse(response);
  return null;
}

function validationResponse(response: Response): void {
  response.status(422).json({
    code: 'validation_failed',
    message: 'The request could not be validated',
    requestId: response.getHeader('x-request-id'),
  });
}

function consumePhotoBatchRateLimit(
  userID: string,
  request: Request,
  response: Response,
  rateLimiter: InMemoryRateLimiter,
): boolean {
  try {
    rateLimiter.consume(`profile-photo-batch:ip:${request.ip}`);
    rateLimiter.consume(`profile-photo-batch:user:${userID}`);
    return true;
  } catch (error) {
    const retryAfter = error instanceof RateLimitExceededError ? error.retryAfterSeconds : 60;
    response.setHeader('Retry-After', String(retryAfter));
    response.status(429).json({
      code: 'rate_limited',
      message: 'Too many photo batches. Try again later',
      retryAfter,
      requestId: String(response.getHeader('x-request-id')),
    });
    return false;
  }
}
