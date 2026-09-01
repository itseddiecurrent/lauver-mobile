import { randomUUID } from 'node:crypto';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';

export type HealthResponse = {
  status: 'ok';
  service: 'lauver-api';
};

export type ErrorResponse = {
  code: string;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
};

function requestId(response: Response): string {
  const value = response.getHeader('x-request-id');

  if (typeof value !== 'string') {
    throw new Error('Request ID middleware was not installed');
  }

  return value;
}

function isMalformedJSON(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  );
}

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('x-request-id', randomUUID());
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_request: Request, response: Response<HealthResponse>) => {
    response.status(200).json({
      status: 'ok',
      service: 'lauver-api',
    });
  });

  app.use((_request: Request, response: Response<ErrorResponse>) => {
    response.status(404).json({
      code: 'not_found',
      message: 'Route not found',
      requestId: requestId(response),
    });
  });

  app.use((error: unknown, _request: Request, response: Response<ErrorResponse>, _next: NextFunction) => {
    void _next;

    if (isMalformedJSON(error)) {
      response.status(400).json({
        code: 'invalid_json',
        message: 'Request body must contain valid JSON',
        requestId: requestId(response),
      });
      return;
    }

    console.error('Unhandled request error', error);
    response.status(500).json({
      code: 'internal_error',
      message: 'An unexpected error occurred',
      requestId: requestId(response),
    });
  });

  return app;
}
