import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getServerEnv, resetEnvForTests } from "./env";

const originalEnv = process.env;

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  AUTH_MODE: "local",
  LOCAL_AUTH_USERNAME: "admin",
  LOCAL_AUTH_PASSWORD: "local-password-that-is-at-least-32-characters",
  APP_BASE_URL: "https://app.school.test",
  SESSION_SECRET: "session-secret-that-is-at-least-32-characters",
  SESSION_TOKEN_PEPPER: "session-pepper-that-is-at-least-32-characters",
  DATABASE_URL: "postgresql://user:password@db.test/app?sslmode=require",
  SHSID_ALLOWED_ORGS: "local",
  SHSID_ADMIN_SUBS: "local:admin",
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

describe("registration environment", () => {
  beforeEach(() => {
    process.env = { ...baseEnv };
    resetEnvForTests();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetEnvForTests();
  });

  it("defaults registration to closed without requiring an invitation pepper", () => {
    expect(getServerEnv().REGISTRATION_MODE).toBe("closed");
  });

  it("requires a distinct strong invitation pepper when registration is open", () => {
    process.env.REGISTRATION_MODE = "invite";
    expect(() => getServerEnv()).toThrow(/REGISTRATION_INVITE_PEPPER/);
    resetEnvForTests();
    process.env.REGISTRATION_INVITE_PEPPER = "invite-pepper-that-is-at-least-32-characters";
    expect(getServerEnv().REGISTRATION_MODE).toBe("invite");
  });

  it("rejects reuse of a session secret as the invitation pepper", () => {
    process.env.REGISTRATION_MODE = "invite";
    process.env.REGISTRATION_INVITE_PEPPER = baseEnv.SESSION_TOKEN_PEPPER;
    expect(() => getServerEnv()).toThrow(/distinct from session secrets/);
  });

  it("rejects unknown registration modes", () => {
    process.env.REGISTRATION_MODE = "public";
    expect(() => getServerEnv()).toThrow(/REGISTRATION_MODE/);
  });

  it("defaults emergency challenge mode off and accepts an explicit switch", () => {
    expect(getServerEnv().REGISTRATION_FORCE_CHALLENGE).toBe(false);
    resetEnvForTests();
    process.env.REGISTRATION_FORCE_CHALLENGE = "true";
    expect(getServerEnv().REGISTRATION_FORCE_CHALLENGE).toBe(true);
  });
});
