import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export interface Database {
  checkHealth(): Promise<void>;
  disconnect(): Promise<void>;
}

export class PrismaDatabase implements Database {
  readonly #client: PrismaClient;

  constructor(databaseURL: string) {
    const adapter = new PrismaPg({
      connectionString: databaseURL,
      connectionTimeoutMillis: 3_000,
      max: 10,
    });

    this.#client = new PrismaClient({ adapter });
  }

  async checkHealth(): Promise<void> {
    await this.#client.$queryRaw`SELECT 1`;
  }

  async disconnect(): Promise<void> {
    await this.#client.$disconnect();
  }
}

export function createDatabase(databaseURL: string): Database {
  return new PrismaDatabase(databaseURL);
}
