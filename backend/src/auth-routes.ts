import { createHash } from 'node:crypto';

import type { Express, Request, Response } from 'express';
import { z } from 'zod';

import { type AuthServicing, normalizeEmail } from './auth.js';
import { type ErrorResponse } from './app.js';
import type { InMemoryRateLimiter } from './rate-limiter.js';

const emailSchema = z.email().max(320);
const passwordSchema = z
  .string()
  .min(12)
  .max(128)
  .regex(/[A-Za-z]/)
  .regex(/[0-9]/);
const emailPasswordSchema = z.object({ email: emailSchema, password: passwordSchema }).strict();
const appleSignInSchema = z.object({
  identityToken: z.string().min(1).max(10_000),
  authorizationCode: z.string().min(1).max(2_000),
  nonce: z.string().min(32).max(128),
  email: emailSchema.nullable().default(null),
  givenName: z.string().trim().min(1).max(100).nullable().default(null),
  familyName: z.string().trim().min(1).max(100).nullable().default(null),
}).strict();
const googleSignInSchema = z.object({ idToken: z.string().min(1).max(10_000) }).strict();
const refreshSchema = z.object({ refreshToken: z.string().min(1).max(512) }).strict();
const forgotPasswordSchema = z.object({ email: emailSchema }).strict();
const resetPasswordSchema = z.object({
  token: z.string().min(32).max(512),
  password: passwordSchema,
}).strict();

export type AuthRouteDependencies = {
  authService: AuthServicing;
  rateLimiter: InMemoryRateLimiter;
};

export function installAuthRoutes(app: Express, dependencies: AuthRouteDependencies): void {
  app.post('/v1/auth/register', async (request, response, next) => {
    const body = parseBody(emailPasswordSchema, request, response);
    if (body === null) return;
    if (!consumeRateLimit('register', request, body.email, response, dependencies.rateLimiter)) return;
    try {
      response.status(201).json(await dependencies.authService.register(body.email, body.password));
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/auth/login', async (request, response, next) => {
    const body = parseBody(emailPasswordSchema, request, response);
    if (body === null) return;
    if (!consumeRateLimit('login', request, body.email, response, dependencies.rateLimiter)) return;
    try {
      response.status(200).json(await dependencies.authService.login(body.email, body.password));
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/auth/apple', async (request, response, next) => {
    const body = parseBody(appleSignInSchema, request, response);
    if (body === null) return;
    if (!consumeRateLimit('apple', request, body.nonce, response, dependencies.rateLimiter)) return;
    try {
      response.status(200).json(await dependencies.authService.signInWithApple(body));
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/auth/google', async (request, response, next) => {
    const body = parseBody(googleSignInSchema, request, response);
    if (body === null) return;
    if (!consumeRateLimit('google', request, body.idToken, response, dependencies.rateLimiter)) return;
    try {
      response.status(200).json(await dependencies.authService.signInWithGoogle(body.idToken));
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/auth/refresh', async (request, response, next) => {
    const body = parseBody(refreshSchema, request, response);
    if (body === null) return;
    try {
      response.status(200).json(await dependencies.authService.refresh(body.refreshToken));
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/auth/logout', async (request, response, next) => {
    const body = parseBody(refreshSchema, request, response);
    if (body === null) return;
    try {
      await dependencies.authService.logout(body.refreshToken);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/auth/password/forgot', async (request, response, next) => {
    const body = parseBody(forgotPasswordSchema, request, response);
    if (body === null) return;
    if (!consumeRateLimit('forgot', request, body.email, response, dependencies.rateLimiter)) return;
    try {
      await dependencies.authService.forgotPassword(body.email);
      response.status(202).json({
        message: 'If the account is eligible, reset instructions will be sent',
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/auth/password/reset', async (request, response, next) => {
    const body = parseBody(resetPasswordSchema, request, response);
    if (body === null) return;
    if (!consumeRateLimit('reset', request, body.token, response, dependencies.rateLimiter)) return;
    try {
      await dependencies.authService.resetPassword(body.token, body.password);
      response.status(200).json({ message: 'Password reset completed' });
    } catch (error) {
      next(error);
    }
  });

  app.get('/v1/auth/session', async (request, response, next) => {
    const authorization = request.get('authorization');
    const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    try {
      response.status(200).json({ user: await dependencies.authService.restore(accessToken) });
    } catch (error) {
      next(error);
    }
  });
}

function parseBody<T extends z.ZodType>(
  schema: T,
  request: Request,
  response: Response,
): z.infer<T> | null {
  const parsed = schema.safeParse(request.body);
  if (parsed.success) return parsed.data;
  response.status(422).json({
    code: 'validation_failed',
    message: 'The request could not be validated',
    requestId: response.getHeader('x-request-id'),
  });
  return null;
}

function consumeRateLimit(
  operation: string,
  request: Request,
  subject: string,
  response: Response<ErrorResponse>,
  rateLimiter: InMemoryRateLimiter,
): boolean {
  try {
    const normalizedSubject = normalizeEmail(subject);
    const subjectHash = createHash('sha256').update(normalizedSubject, 'utf8').digest('hex');
    rateLimiter.consume(`${operation}:ip:${request.ip}`);
    rateLimiter.consume(`${operation}:subject:${subjectHash}`);
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
