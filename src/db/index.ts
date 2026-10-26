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
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  const database = drizzle(client, { schema });

  if (env.NODE_ENV !== "production") {
    globalDatabase.shsidPostgres = client;
    globalDatabase.shsidDatabase = database;
  }

  return database;
}
