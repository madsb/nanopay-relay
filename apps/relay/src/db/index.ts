import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './types';
import { config } from '../config';

export const createDb = (databaseUrl = config.databaseUrl) => {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool })
  });
};

export type { Database } from './types';
