import 'dotenv/config';

import { createServer } from 'node:http';

import { createApp } from './app.js';
import { AppleAuthorizationProvider, AppleTokenCipher } from './apple-auth.js';
import { AuthService, NoopPasswordResetDelivery } from './auth.js';
import { loadConfig } from './config.js';
import { createDatabase } from './database.js';
import { createLogger } from './logger.js';
import { ResendPasswordResetDelivery } from './password-reset-delivery.js';
import { InMemoryRateLimiter } from './rate-limiter.js';
import { shutdownServer } from './server-lifecycle.js';

const config = loadConfig();
const logger = createLogger(config.logLevel, config.nodeEnvironment);
const database = createDatabase(config.databaseURL);
const passwordResetDelivery = config.passwordResetDelivery === 'resend'
  ? new ResendPasswordResetDelivery(config.resendAPIKey!, config.passwordResetFromEmail!)
  : new NoopPasswordResetDelivery();
const appleProvider = config.appleAuthEnabled
  ? new AppleAuthorizationProvider({
      clientID: config.appleClientID!,
      teamID: config.appleTeamID!,
      keyID: config.appleKeyID!,
      privateKey: config.applePrivateKey!,
    })
  : undefined;
const appleTokenCipher = config.appleAuthEnabled
  ? new AppleTokenCipher(config.appleTokenEncryptionKey!)
  : undefined;
const authService = new AuthService({
  repository: database.authRepository,
  appleProvider,
  appleTokenCipher,
  passwordResetDelivery,
  onPasswordResetDeliveryFailure: (error) => {
    logger.warn({ err: error }, 'Password-reset delivery failed');
  },
  accessTokenSecret: config.authAccessTokenSecret,
  accessTokenTTLSeconds: config.authAccessTokenTTLSeconds,
  refreshTokenTTLSeconds: config.authRefreshTokenTTLSeconds,
  passwordResetTTLSeconds: config.authPasswordResetTTLSeconds,
});
const server = createServer(
  createApp({
    database,
    corsAllowedOrigins: config.corsAllowedOrigins,
    logger,
    authService,
    authRateLimiter: new InMemoryRateLimiter(
      config.authRateLimitWindowMilliseconds,
      config.authRateLimitMaxAttempts,
    ),
  }),
);

server.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port }, 'Lauver API listening');
});

let shuttingDown = false;
function handleSignal(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  void shutdownServer(
    server,
    database,
    logger,
    signal,
    config.shutdownTimeoutMilliseconds,
  ).catch((error: unknown) => {
    logger.error({ err: error }, 'Server shutdown failed');
    process.exitCode = 1;
  });
}

process.once('SIGINT', () => handleSignal('SIGINT'));
process.once('SIGTERM', () => handleSignal('SIGTERM'));
