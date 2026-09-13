import type { Express, NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import type { AuthServicing, AuthUser } from './auth.js';
import {
  type ProfileServicing,
  supportedSports,
  timeBuckets,
} from './profile.js';
import type { InMemoryRateLimiter } from './rate-limiter.js';

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
const photoUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(32),
  byteSize: z.number().int().positive().max(5 * 1_024 * 1_024),
}).strict();
const photoCompleteSchema = z.object({ objectKey: z.string().min(1).max(512) }).strict();
const userIDSchema = z.uuid();

export type ProfileRouteDependencies = {
  authService: AuthServicing;
  profileService: ProfileServicing;
  rateLimiter: InMemoryRateLimiter;
};

export function installProfileRoutes(app: Express, dependencies: ProfileRouteDependencies): void {
  app.get('/v1/me', authenticated(dependencies.authService, async (user, _request, response) => {
    response.status(200).json({ profile: await dependencies.profileService.getOwnProfile(user.id) });
  }));

  app.patch('/v1/me', authenticated(dependencies.authService, async (user, request, response) => {
    const body = parseBody(profilePatchSchema, request, response);
    if (body === null) return;
    response.status(200).json({
      profile: await dependencies.profileService.updateProfile(user.id, body),
    });
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

  app.post('/v1/me/photo/upload-url', authenticated(dependencies.authService, async (user, request, response) => {
    const body = parseBody(photoUploadSchema, request, response);
    if (body === null) return;
    if (!consumeUploadRateLimit(user.id, request, response, dependencies.rateLimiter)) return;
    response.status(201).json(await dependencies.profileService.createPhotoUpload({ userId: user.id, ...body }));
  }));

  app.post('/v1/me/photo/complete', authenticated(dependencies.authService, async (user, request, response) => {
    const body = parseBody(photoCompleteSchema, request, response);
    if (body === null) return;
    response.status(200).json({
      profile: await dependencies.profileService.completePhotoUpload(user.id, body.objectKey),
    });
  }));

  app.delete('/v1/me/photo', authenticated(dependencies.authService, async (user, _request, response) => {
    await dependencies.profileService.deletePhoto(user.id);
    response.status(204).send();
  }));
}

type AuthenticatedHandler = (
  user: AuthUser,
  request: Request,
  response: Response,
) => Promise<void>;

function authenticated(authService: AuthServicing, handler: AuthenticatedHandler) {
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

function consumeUploadRateLimit(
  userID: string,
  request: Request,
  response: Response,
  rateLimiter: InMemoryRateLimiter,
): boolean {
  try {
    rateLimiter.consume(`profile-photo:ip:${request.ip}`);
    rateLimiter.consume(`profile-photo:user:${userID}`);
    return true;
  } catch {
    response.status(429).json({
      code: 'rate_limited',
      message: 'Too many requests. Try again later',
      requestId: String(response.getHeader('x-request-id')),
    });
    return false;
  }
}
