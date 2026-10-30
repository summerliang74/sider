import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  sameOrigin: vi.fn(),
  ipLimit: vi.fn(),
  bot: vi.fn(),
  userinfo: vi.fn(),
  discovery: vi.fn(),
  upsert: vi.fn(),
  session: vi.fn(),
  securityResponse: vi.fn(),
  metric: vi.fn(),
}));

vi.mock("@/src/lib/env", () => ({ getServerEnv: mocks.env }));
vi.mock("@/src/lib/security/request", () => ({
  requireSameOrigin: mocks.sameOrigin,
  getClientIp: () => "192.0.2.1",
}));
vi.mock("@/src/lib/security/rate-limit", () => ({ enforceIpRateLimit: mocks.ipLimit }));
vi.mock("@/src/lib/security/bot", () => ({ verifyBotChallenge: mocks.bot }));
vi.mock("@/src/lib/security/responses", () => ({ securityErrorResponse: mocks.securityResponse }));
vi.mock("@/src/lib/auth/launchpad", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/lib/auth/launchpad")>();
  return { ...original, fetchLaunchpadUser: mocks.userinfo };
});
vi.mock("@/src/lib/auth/discovery", () => ({ isOrgDiscoveryEligible: mocks.discovery }));
vi.mock("@/src/lib/auth/users", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/lib/auth/users")>();
  return { ...original, admitAndUpsertUser: mocks.upsert };
});
vi.mock("@/src/lib/auth/session", () => ({ issueSession: mocks.session }));
vi.mock("@/src/lib/telemetry", () => ({ recordMetric: mocks.metric }));

import { LaunchpadAccessTokenError } from "@/src/lib/auth/launchpad";
import { AdmissionError } from "@/src/lib/auth/users";
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
    mocks.env.mockReturnValue({
      AUTH_MODE: "launchpad",
      NODE_ENV: "test",
      SESSION_SECRET: "test-session-secret",
      orgDiscoveryEmail: null,
    });
    mocks.sameOrigin.mockReturnValue(true);
    mocks.ipLimit.mockResolvedValue({ risky: false });
    mocks.bot.mockResolvedValue(undefined);
    mocks.userinfo.mockResolvedValue(profile);
    mocks.discovery.mockReturnValue(false);
    mocks.upsert.mockResolvedValue("user-id");
    mocks.session.mockResolvedValue(undefined);
    mocks.securityResponse.mockReturnValue(null);
  });

  it("does not expose the route outside Launchpad auth mode", async () => {
    mocks.env.mockReturnValue({ AUTH_MODE: "local" });
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(mocks.userinfo).not.toHaveBeenCalled();
  });

  it("rejects cross-origin and open-redirect requests", async () => {
    mocks.sameOrigin.mockReturnValue(false);
    const crossOrigin = await POST(request());
    expect(crossOrigin.status).toBe(403);

    mocks.sameOrigin.mockReturnValue(true);
    const openRedirect = await POST(request({ accessToken: "token", returnTo: "//evil.test" }));
    expect(openRedirect.status).toBe(400);
    expect(mocks.userinfo).not.toHaveBeenCalled();
  });

  it("validates the SDK token and issues an application session", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ redirectUrl: "/resources" });
    expect(mocks.userinfo).toHaveBeenCalledWith("access-token");
    expect(mocks.upsert).toHaveBeenCalledWith(profile);
    expect(mocks.session).toHaveBeenCalledOnce();
    expect(mocks.metric).toHaveBeenCalledWith("auth.succeeded");
  });

  it("preserves organization discovery before creating a user", async () => {
    mocks.discovery.mockReturnValue(true);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redirectUrl: "/auth/discovery" });
    expect(response.headers.get("set-cookie")).toContain("shsid_org_discovery=");
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.metric).toHaveBeenCalledWith("auth.org_discovery");
  });

  it("rejects an expired SDK token without creating a session", async () => {
    mocks.userinfo.mockRejectedValue(new LaunchpadAccessTokenError("invalid"));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_token" });
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("keeps existing organization and account admission checks", async () => {
    mocks.upsert.mockRejectedValue(new AdmissionError("org_not_allowed"));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "org_not_allowed" });
    expect(mocks.session).not.toHaveBeenCalled();
  });
});
