import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getServerEnv } from "@/src/lib/env";

import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const globalDatabase = globalThis as typeof globalThis & {
  shsidPostgres?: ReturnType<typeof postgres>;
  shsidDatabase?: Database;
};

export function getDatabase(): Database {
  if (globalDatabase.shsidDatabase) return globalDatabase.shsidDatabase;

  const env = getServerEnv();
  const client = postgres(env.DATABASE_URL, {
    max: env.DATABASE_MAX_CONNECTIONS,
    // This is a long-running Node process. Keep warm connections around so a
    // quiet site does not pay the Neon TLS/connection setup cost on every
    // request.
    idle_timeout: 300,
    connect_timeout: 10,
    prepare: false,
  });
  const database = drizzle(client, { schema });

  // Reuse one pool in production as well as development. Without these
  // assignments every getDatabase() call creates a new postgres.js pool.
  globalDatabase.shsidPostgres = client;
  globalDatabase.shsidDatabase = database;

  return database;
}

export async function closeDatabaseForTests(): Promise<void> {
  if (process.env.NODE_ENV !== "test") throw new Error("database_test_shutdown_forbidden");
  await globalDatabase.shsidPostgres?.end({ timeout: 5 });
  delete globalDatabase.shsidPostgres;
  delete globalDatabase.shsidDatabase;
}
