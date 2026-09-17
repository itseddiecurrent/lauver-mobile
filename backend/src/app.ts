import { randomUUID } from 'node:crypto';

import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

import { installDiscoverRoutes, type DiscoverServicing } from './discover.js';
import { AuthError } from './auth.js';
import type { AuthServicing } from './auth.js';
import { installAuthRoutes } from './auth-routes.js';
import type { Database } from './database.js';
import type { InMemoryRateLimiter } from './rate-limiter.js';
import { ProfileError, type ProfileServicing } from './profile.js';
import { installProfileRoutes } from './profile-routes.js';
import { installSafetyRoutes, type SafetyServicing } from './safety.js';
import { installStravaRoutes, type StravaServicing } from './strava.js';
import { StravaError } from './strava-provider.js';
import { installHealthKitRoutes } from './healthkit.js';
import type { HealthKitService } from './healthkit.js';
import { installStreamRoutes } from './stream.js';
import type { StreamService } from './stream.js';
import { EventError, installEventRoutes } from './events.js';
import type { EventService } from './events.js';
import { installAdminRoutes, type AdminService } from './admin.js';

export type HealthResponse = {
  status: 'ok';
  service: 'lauver-api';
};

export type ReadyResponse = {
  status: 'ready';
  service: 'lauver-api';
  database: 'ok';
};

export type ErrorResponse = {
  code: string;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
};

export type AppDependencies = {
  database: Database;
  corsAllowedOrigins: readonly string[];
  logger: Logger;
  authService: AuthServicing;
  authRateLimiter: InMemoryRateLimiter;
  profileService: ProfileServicing;
  discoverService: DiscoverServicing;
  profileRateLimiter: InMemoryRateLimiter;
  safetyService: SafetyServicing;
  safetyRateLimiter: InMemoryRateLimiter;
  stravaService?: StravaServicing;
  healthKitService?: HealthKitService;
  streamService?: StreamService;
  eventService?: EventService;
  adminService?: AdminService;
};

class CorsOriginError extends Error {
  constructor() {
    super('Origin is not allowed');
    this.name = 'CorsOriginError';
  }
}

function requestId(response: Response): string {
  const value = response.getHeader('x-request-id');

  if (typeof value !== 'string') {
    throw new Error('Request ID middleware was not installed');
  }

  return value;
}

function isMalformedJSON(error: unknown): boolean {
  return error instanceof SyntaxError && 'type' in error && error.type === 'entity.parse.failed';
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    pinoHttp({
      logger: dependencies.logger,
      genReqId: (_request, response) => {
        const id = randomUUID();
        response.setHeader('x-request-id', id);
        return id;
      },
      serializers: {
        req: (request: { url?: string }) => ({ ...request, url: request.url?.split('?')[0], query: undefined }),
        res: (response: { headers?: Record<string, unknown> }) => ({ ...response,
          headers: response.headers ? { ...response.headers, ...(typeof response.headers.location === 'string'
            ? { location: response.headers.location.split('?')[0] } : {}) } : undefined }),
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (origin === undefined || dependencies.corsAllowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new CorsOriginError());
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_request: Request, response: Response<HealthResponse>) => {
    response.status(200).json({
      status: 'ok',
      service: 'lauver-api',
    });
  });

  app.get('/readyz', async (request: Request, response: Response<ReadyResponse | ErrorResponse>) => {
    try {
      await dependencies.database.checkHealth();
      response.status(200).json({
        status: 'ready',
        service: 'lauver-api',
        database: 'ok',
      });
    } catch (error) {
      request.log.warn({ err: error }, 'Database readiness check failed');
      response.status(503).json({
        code: 'service_unavailable',
        message: 'Service is not ready',
        requestId: requestId(response),
      });
    }
  });

  installAuthRoutes(app, {
    authService: dependencies.authService,
    rateLimiter: dependencies.authRateLimiter,
  });
  installDiscoverRoutes(app, dependencies);
  installSafetyRoutes(app, dependencies);
  if (dependencies.stravaService) installStravaRoutes(app, { authService: dependencies.authService, stravaService: dependencies.stravaService });
  if (dependencies.healthKitService) installHealthKitRoutes(app, { authService: dependencies.authService, service: dependencies.healthKitService });
  if (dependencies.streamService) installStreamRoutes(app, { authService: dependencies.authService, service: dependencies.streamService, safetyService: dependencies.safetyService });
  if (dependencies.eventService) installEventRoutes(app, dependencies.authService, dependencies.eventService);
  if (dependencies.adminService) installAdminRoutes(app, dependencies.adminService);
  installProfileRoutes(app, {
    authService: dependencies.authService,
    profileService: dependencies.profileService,
    rateLimiter: dependencies.profileRateLimiter,
  });

  app.use((_request: Request, response: Response<ErrorResponse>) => {
    response.status(404).json({
      code: 'not_found',
      message: 'Route not found',
      requestId: requestId(response),
    });
  });

  app.use((error: unknown, request: Request, response: Response<ErrorResponse>, _next: NextFunction) => {
    void _next;

    if (error instanceof CorsOriginError) {
      response.status(403).json({
        code: 'origin_not_allowed',
        message: 'Origin is not allowed',
        requestId: requestId(response),
      });
      return;
    }

    if (isMalformedJSON(error)) {
      response.status(400).json({
        code: 'invalid_json',
        message: 'Request body must contain valid JSON',
        requestId: requestId(response),
      });
      return;
    }

    if (error instanceof AuthError) {
      response.status(error.statusCode).json({
        code: error.code,
        message: error.publicMessage,
        requestId: requestId(response),
      });
      return;
    }

    if (error instanceof ProfileError || error instanceof StravaError) {
      response.status(error.statusCode).json({
        code: error.code,
        message: error.publicMessage,
        requestId: requestId(response),
      });
      return;
    }

    if (error instanceof EventError) {
      response.status(error.statusCode).json({ code: error.code, message: error.publicMessage, requestId: requestId(response) });
      return;
    }

    request.log.error({ err: error }, 'Unhandled request error');
    response.status(500).json({
      code: 'internal_error',
      message: 'An unexpected error occurred',
      requestId: requestId(response),
    });
  });

  return app;
}
