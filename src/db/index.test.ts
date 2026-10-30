import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: { end: vi.fn() },
  database: { marker: "database" },
  postgres: vi.fn(),
  drizzle: vi.fn(),
}));

vi.mock("postgres", () => ({ default: mocks.postgres }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: mocks.drizzle }));
vi.mock("@/src/lib/env", () => ({
  getServerEnv: () => ({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://database.test/app",
    DATABASE_MAX_CONNECTIONS: 5,
  }),
}));

import { closeDatabaseForTests, getDatabase } from "./index";

describe("getDatabase", () => {
  beforeEach(async () => {
    await closeDatabaseForTests();
    mocks.postgres.mockReturnValue(mocks.client);
    mocks.drizzle.mockReturnValue(mocks.database);
  });

  afterEach(async () => {
    await closeDatabaseForTests();
  });

  it("reuses one production connection pool", () => {
    const first = getDatabase();
    const second = getDatabase();

    expect(second).toBe(first);
    expect(mocks.postgres).toHaveBeenCalledTimes(1);
    expect(mocks.postgres).toHaveBeenCalledWith(
      "postgresql://database.test/app",
      expect.objectContaining({ idle_timeout: 300, max: 5 }),
    );
    expect(mocks.drizzle).toHaveBeenCalledTimes(1);
  });
});
