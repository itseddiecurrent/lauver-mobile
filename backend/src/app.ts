import { randomUUID } from 'node:crypto';

import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

import type { Database } from './database.js';

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
  app.use(
    pinoHttp({
      logger: dependencies.logger,
      genReqId: (_request, response) => {
        const id = randomUUID();
        response.setHeader('x-request-id', id);
        return id;
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

    request.log.error({ err: error }, 'Unhandled request error');
    response.status(500).json({
      code: 'internal_error',
      message: 'An unexpected error occurred',
      requestId: requestId(response),
    });
  });

  return app;
}
