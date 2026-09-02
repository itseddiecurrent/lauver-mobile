import pino, { type DestinationStream, type Logger } from 'pino';

export function createLogger(
  level: string,
  environment: string,
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      level,
      base: {
        environment,
        service: 'lauver-api',
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'request.headers.authorization',
          'request.headers.cookie',
          'req.body.password',
          'req.body.refreshToken',
          'req.body.token',
          'request.body.password',
          'request.body.refreshToken',
          'request.body.token',
        ],
        censor: '[Redacted]',
      },
    },
    destination,
  );
}
