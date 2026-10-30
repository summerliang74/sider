import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  sameOrigin: vi.fn(),
  ipLimit: vi.fn(),
  identityLimit: vi.fn(),
  bot: vi.fn(),
  password: vi.fn(),
  inviteHash: vi.fn(),
  register: vi.fn(),
  cookie: vi.fn(),
  metric: vi.fn(),
}));

vi.mock("@/src/lib/env", () => ({ getServerEnv: mocks.env }));
vi.mock("@/src/lib/security/request", () => ({
  requireSameOrigin: mocks.sameOrigin,
  getClientIp: () => "192.0.2.1",
}));
vi.mock("@/src/lib/security/rate-limit", () => ({
  enforceIpRateLimit: mocks.ipLimit,
  enforceRegistrationIdentityRateLimit: mocks.identityLimit,
}));
vi.mock("@/src/lib/security/bot", () => ({ verifyBotChallenge: mocks.bot }));
vi.mock("@/src/lib/security/responses", () => ({ securityErrorResponse: () => null }));
vi.mock("@/src/lib/auth/password", () => ({ hashPassword: mocks.password }));
vi.mock("@/src/lib/auth/session", () => ({ setSessionCookie: mocks.cookie }));
vi.mock("@/src/lib/registration-invites", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/lib/registration-invites")>();
  return {
    ...original,
    hashRegistrationInvite: mocks.inviteHash,
    registerInvitedUser: mocks.register,
  };
});
vi.mock("@/src/lib/telemetry", () => ({ recordMetric: mocks.metric }));

import { POST } from "./route";
import { InvalidInviteError, UsernameTakenError } from "@/src/lib/registration-invites";

const validBody = {
  username: "student01",
  displayName: "Alex Chen",
  password: "a long unique password",
  inviteCode: "sider_invite_example",
  botToken: "challenge-token",
  acceptTerms: true,
};

function request(body: unknown = validBody) {
  return new Request("https://app.school.test/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.school.test" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    mocks.env.mockReturnValue({ AUTH_MODE: "local", REGISTRATION_MODE: "invite" });
    mocks.sameOrigin.mockReturnValue(true);
    mocks.ipLimit.mockResolvedValue({ risky: false });
    mocks.identityLimit.mockResolvedValue(undefined);
    mocks.bot.mockResolvedValue(undefined);
    mocks.password.mockResolvedValue("password-hash");
    mocks.inviteHash.mockReturnValue("invite-hash");
    mocks.register.mockResolvedValue({
      user: { id: "123e4567-e89b-42d3-a456-426614174000", displayName: "Alex Chen", role: "student" },
      session: { token: "token", tokenHash: "hash", expiresAt: new Date() },
    });
  });

  it("does not expose the route outside local auth mode", async () => {
    mocks.env.mockReturnValue({ AUTH_MODE: "launchpad", REGISTRATION_MODE: "invite" });
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(mocks.sameOrigin).not.toHaveBeenCalled();
  });

  it("rejects closed registration before parsing or security dependencies", async () => {
    mocks.env.mockReturnValue({ AUTH_MODE: "local", REGISTRATION_MODE: "closed" });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "registration_closed" });
    expect(mocks.ipLimit).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before limits or hashing", async () => {
    mocks.sameOrigin.mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.ipLimit).not.toHaveBeenCalled();
    expect(mocks.password).not.toHaveBeenCalled();
  });

  it("rejects role injection before expensive work", async () => {
    const response = await POST(request({ ...validBody, role: "admin" }));
    expect(response.status).toBe(400);
    expect(mocks.ipLimit).not.toHaveBeenCalled();
    expect(mocks.password).not.toHaveBeenCalled();
  });

  it("runs limits and mandatory challenge before password hashing and transaction work", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(mocks.ipLimit).toHaveBeenCalledWith("register", "192.0.2.1");
    expect(mocks.identityLimit).toHaveBeenCalledWith("username", "student01");
    expect(mocks.identityLimit).toHaveBeenCalledWith("invite", validBody.inviteCode);
    expect(mocks.bot).toHaveBeenCalledWith({ required: true, token: validBody.botToken, action: "register", ip: "192.0.2.1" });
    expect(mocks.bot).toHaveBeenCalledBefore(mocks.password);
    expect(mocks.password).toHaveBeenCalledBefore(mocks.register);
    expect(mocks.cookie).toHaveBeenCalledOnce();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ user: { role: "student" }, redirectUrl: "/resources" });
  });

  it("returns one uniform error for unavailable invitation states", async () => {
    mocks.register.mockRejectedValue(new InvalidInviteError());
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid_invite" });
    expect(mocks.cookie).not.toHaveBeenCalled();
  });

  it("does not issue a cookie when the normalized username conflicts", async () => {
    mocks.register.mockRejectedValue(new UsernameTakenError());
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "username_taken" });
    expect(mocks.cookie).not.toHaveBeenCalled();
  });
});
