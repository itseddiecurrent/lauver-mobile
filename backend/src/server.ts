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
import { S3ProfilePhotoStorage, UnavailableProfilePhotoStorage } from './object-storage.js';
import { DiscoverService } from './discover.js';
import { ProfileService } from './profile.js';
import { StravaService } from './strava.js';
import { StravaProvider, StravaTokenCipher } from './strava-provider.js';
import { HealthKitService } from './healthkit.js';
import { StreamService } from './stream.js';
import { EventService } from './events.js';
import { AdminService } from './admin.js';

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
const photoStorage = config.profilePhotoStorageEnabled
  ? new S3ProfilePhotoStorage({
      endpoint: config.objectStorageEndpoint!,
      region: config.objectStorageRegion!,
      bucket: config.objectStorageBucket!,
      accessKeyID: config.objectStorageAccessKeyID!,
      secretAccessKey: config.objectStorageSecretAccessKey!,
      publicBaseURL: config.objectStoragePublicBaseURL!,
      forcePathStyle: config.objectStorageForcePathStyle,
    })
  : new UnavailableProfilePhotoStorage();
const profileService = new ProfileService({
  repository: database.profileRepository,
  storage: photoStorage,
});
const stravaService = new StravaService(database.stravaRepository,
  config.strava ? new StravaProvider(config.strava) : undefined,
  config.strava ? new StravaTokenCipher(config.strava.tokenEncryptionKey) : undefined);
void stravaService.processCleanup().catch(() => { logger.warn('Initial Strava cleanup failed'); });
const stravaCleanupInterval = setInterval(() => {
  void stravaService.processCleanup().catch(() => { logger.warn('Scheduled Strava cleanup failed'); });
}, 60_000);
stravaCleanupInterval.unref();
void profileService.processPhotoCleanup().catch((error: unknown) => {
  logger.warn({ err: error }, 'Initial profile-photo cleanup failed');
});
const photoCleanupInterval = setInterval(() => {
  void profileService.processPhotoCleanup().catch((error: unknown) => {
    logger.warn({ err: error }, 'Scheduled profile-photo cleanup failed');
  });
}, 5 * 60 * 1_000);
photoCleanupInterval.unref();
const streamService = config.stream ? new StreamService(database.client, config.stream.apiKey, config.stream.apiSecret, config.stream.tokenTTLSeconds) : undefined;
const adminService = new AdminService(database.client, streamService);
if (streamService) database.safetyService.onBlocking = (actor, target) => streamService.blockPair(actor, target);
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
    discoverService: new DiscoverService(database.discoverRepository, photoStorage, config.authAccessTokenSecret),
    profileService,
    stravaService,
    healthKitService: new HealthKitService(database.client),
    streamService,
    eventService: new EventService(database.client, streamService),
    adminService,
    safetyService: database.safetyService,
    safetyRateLimiter: new InMemoryRateLimiter(60_000, 20),
    profileRateLimiter: new InMemoryRateLimiter(
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
  clearInterval(photoCleanupInterval);
  clearInterval(stravaCleanupInterval);

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
