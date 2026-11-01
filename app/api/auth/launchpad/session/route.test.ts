import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sameOrigin: vi.fn(),
  ipLimit: vi.fn(),
  bot: vi.fn(),
  userinfo: vi.fn(),
  upsert: vi.fn(),
  createSession: vi.fn(),
  metric: vi.fn(),
}));

vi.mock("@/src/lib/security/request", () => ({
  requireSameOrigin: mocks.sameOrigin,
  getClientIp: () => "192.0.2.1",
}));
vi.mock("@/src/lib/security/rate-limit", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/lib/security/rate-limit")>();
  return { ...original, enforceIpRateLimit: mocks.ipLimit };
});
vi.mock("@/src/lib/security/bot", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/lib/security/bot")>();
  return { ...original, verifyBotChallenge: mocks.bot };
});
vi.mock("@/src/lib/auth/launchpad", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/lib/auth/launchpad")>();
  return { ...original, fetchLaunchpadUser: mocks.userinfo };
});
vi.mock("@/src/lib/auth/users", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/lib/auth/users")>();
  return { ...original, admitAndUpsertUser: mocks.upsert };
});
vi.mock("@/src/lib/auth/session", () => ({ createSession: mocks.createSession }));
vi.mock("@/src/lib/telemetry", () => ({ recordMetric: mocks.metric }));

import { LaunchpadAccessTokenError } from "@/src/lib/auth/launchpad";
import { AdmissionError } from "@/src/lib/auth/users";
import { BotChallengeError } from "@/src/lib/security/bot";
import { POST } from "./route";

const profile = {
  sub: "launchpad-user-1",
  email: "student@example.edu",
  name: "Student One",
  picture: null,
  org: "school",
  verified: true,
  allows: {},
};

function request(body: unknown = { accessToken: "access-token", returnTo: "/resources" }) {
  return new Request("https://app.school.test/api/auth/launchpad/session", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.school.test" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/launchpad/session", () => {
  beforeEach(() => {
    mocks.sameOrigin.mockReturnValue(true);
    mocks.ipLimit.mockResolvedValue({ risky: false });
    mocks.bot.mockResolvedValue(undefined);
    mocks.userinfo.mockResolvedValue(profile);
    mocks.upsert.mockResolvedValue("user-id");
    mocks.createSession.mockResolvedValue({
      token: "sider-access-token",
      tokenHash: "sider-access-token-hash",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });
  });

  it("rejects cross-origin and open-redirect requests", async () => {
    mocks.sameOrigin.mockReturnValue(false);
    expect((await POST(request())).status).toBe(403);

    mocks.sameOrigin.mockReturnValue(true);
    const openRedirect = await POST(request({ accessToken: "token", returnTo: "//evil.test" }));
    expect(openRedirect.status).toBe(400);
    expect(mocks.userinfo).not.toHaveBeenCalled();
  });

  it("exchanges the platform token for an opaque Sider bearer token", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({
      accessToken: "sider-access-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
      redirectUrl: "/resources",
    });
    expect(mocks.userinfo).toHaveBeenCalledWith("access-token");
    expect(mocks.upsert).toHaveBeenCalledWith(profile);
    expect(mocks.createSession).toHaveBeenCalledWith("user-id");
    expect(mocks.metric).toHaveBeenCalledWith("auth.succeeded");
  });

  it("returns a bot challenge without creating a session", async () => {
    mocks.bot.mockRejectedValue(new BotChallengeError("required"));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "bot_challenge_required" });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("rejects an expired SDK token without creating a session", async () => {
    mocks.userinfo.mockRejectedValue(new LaunchpadAccessTokenError("invalid"));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_token" });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("still rejects a locally suspended account", async () => {
    mocks.upsert.mockRejectedValue(new AdmissionError("suspended"));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "suspended" });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
