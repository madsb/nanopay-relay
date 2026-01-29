import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Database } from "./types.js";
import { config } from "../config.js";

const { Pool } = pg;

export const createDb = (databaseUrl = config.databaseUrl) => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool })
  });
};
