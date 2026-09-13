import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { PrismaDiscoverRepository } from './discover.js';
import { PrismaAuthRepository, type AuthRepository } from './auth-repository.js';
import { PrismaProfileRepository, type ProfileRepository } from './profile-repository.js';

export interface Database {
  checkHealth(): Promise<void>;
  disconnect(): Promise<void>;
}

export class PrismaDatabase implements Database {
  readonly #client: PrismaClient;
  readonly authRepository: AuthRepository;
  readonly profileRepository: ProfileRepository;
  readonly discoverRepository: PrismaDiscoverRepository;

  constructor(databaseURL: string) {
    const adapter = new PrismaPg({
      connectionString: databaseURL,
      connectionTimeoutMillis: 3_000,
      max: 10,
    });

    this.#client = new PrismaClient({ adapter });
    this.authRepository = new PrismaAuthRepository(this.#client);
    this.profileRepository = new PrismaProfileRepository(this.#client);
    this.discoverRepository = new PrismaDiscoverRepository(this.#client);
  }

  async checkHealth(): Promise<void> {
    await this.#client.$queryRaw`SELECT 1`;
  }

  async disconnect(): Promise<void> {
    await this.#client.$disconnect();
  }
}

export function createDatabase(databaseURL: string): PrismaDatabase {
  return new PrismaDatabase(databaseURL);
}
