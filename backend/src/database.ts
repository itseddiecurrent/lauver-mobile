import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { PrismaDiscoverRepository } from './discover.js';
import { SafetyService } from './safety.js';
import { PrismaAuthRepository, type AuthRepository } from './auth-repository.js';
import { PrismaProfileRepository, type ProfileRepository } from './profile-repository.js';
import { PgStravaRepository } from './strava-repository.js';

export interface Database {
  checkHealth(): Promise<void>;
  disconnect(): Promise<void>;
}

export class PrismaDatabase implements Database {
  readonly client: PrismaClient;
  readonly authRepository: AuthRepository;
  readonly profileRepository: ProfileRepository;
  readonly discoverRepository: PrismaDiscoverRepository;
  readonly safetyService: SafetyService;
  readonly stravaRepository: PgStravaRepository;

  constructor(databaseURL: string) {
    const databaseURLObject = new URL(databaseURL);
    const adapter = new PrismaPg({
      connectionString: databaseURL,
      connectionTimeoutMillis: 3_000,
      max: 10,
      // Render's externally reachable Postgres endpoint requires TLS. The
      // certificate chain is validated by Render's managed endpoint, while
      // explicit SSL here also keeps Prisma's pg adapter consistent with psql.
      ...(databaseURLObject.searchParams.has('sslmode') ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    this.client = new PrismaClient({ adapter });
    this.authRepository = new PrismaAuthRepository(this.client);
    this.profileRepository = new PrismaProfileRepository(this.client);
    this.discoverRepository = new PrismaDiscoverRepository(this.client);
    this.safetyService = new SafetyService(this.client);
    this.stravaRepository = new PgStravaRepository(databaseURL);
  }

  async checkHealth(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  async disconnect(): Promise<void> {
    await this.stravaRepository.close();
    await this.client.$disconnect();
  }
}

export function createDatabase(databaseURL: string): PrismaDatabase {
  return new PrismaDatabase(databaseURL);
}
