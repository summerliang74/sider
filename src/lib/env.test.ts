import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getServerEnv, resetEnvForTests } from "./env";

const originalEnv = process.env;

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  APP_BASE_URL: "https://app.school.test",
  SESSION_SECRET: "session-secret-that-is-at-least-32-characters",
  SESSION_TOKEN_PEPPER: "session-pepper-that-is-at-least-32-characters",
  DATABASE_URL: "postgresql://user:password@db.test/app?sslmode=require",
  SHSID_ADMIN_SUBS: "launchpad:admin",
  SHSID_LAUNCHPAD_OIDC_DEV: "0",
  S3_ENDPOINT: "https://storage.test",
  S3_REGION: "test",
  S3_BUCKET: "test",
  S3_ACCESS_KEY_ID: "test-key",
  S3_SECRET_ACCESS_KEY: "test-secret",
  RATE_LIMIT_URL: "https://redis.test",
  RATE_LIMIT_TOKEN: "rate-limit-token-value",
  NEXT_PUBLIC_BOT_SITE_KEY: "site-key",
  BOT_VERIFY_URL: "https://challenge.test/verify",
  BOT_VERIFY_SECRET: "bot-secret-value-long-enough",
  MALWARE_SCAN_URL: "disabled",
  MALWARE_SCAN_TOKEN: "disabled",
  CRON_SECRET: "cron-secret-that-is-at-least-32-characters",
};

describe("server environment", () => {
  beforeEach(() => {
    process.env = { ...baseEnv };
    resetEnvForTests();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetEnvForTests();
  });

  it("parses Launchpad identity settings", () => {
    const env = getServerEnv();
    expect(env.adminSubs).toEqual(["launchpad:admin"]);
    expect(env.launchpadOidcDev).toBe("0");
  });

  it("rejects production Launchpad development mode", () => {
    process.env = { ...process.env, NODE_ENV: "production", SHSID_LAUNCHPAD_OIDC_DEV: "1" };
    expect(() => getServerEnv()).toThrow(/SHSID_LAUNCHPAD_OIDC_DEV/);
  });
});
