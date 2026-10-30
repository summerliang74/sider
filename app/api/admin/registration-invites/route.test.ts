import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  authorize: vi.fn(),
  sameOrigin: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  decode: vi.fn(),
  metric: vi.fn(),
}));

vi.mock("@/src/lib/env", () => ({ getServerEnv: mocks.env }));
vi.mock("@/src/lib/security/admin", () => ({ authorizeAdminRequest: mocks.authorize }));
vi.mock("@/src/lib/security/request", () => ({ requireSameOrigin: mocks.sameOrigin }));
vi.mock("@/src/lib/registration-invites", () => ({
  createRegistrationInvite: mocks.create,
  listRegistrationInvites: mocks.list,
  decodeInviteCursor: mocks.decode,
}));
vi.mock("@/src/lib/telemetry", () => ({ recordMetric: mocks.metric }));

import { GET, POST } from "./route";

const admin = { id: "123e4567-e89b-42d3-a456-426614174000", role: "admin" };

function postRequest(body: unknown = { expiresInHours: 72, note: "Grade 11" }) {
  return new Request("https://app.school.test/api/admin/registration-invites", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.school.test" },
    body: JSON.stringify(body),
  });
}

describe("/api/admin/registration-invites", () => {
  beforeEach(() => {
    mocks.env.mockReturnValue({ AUTH_MODE: "local" });
    mocks.authorize.mockResolvedValue({ user: admin });
    mocks.sameOrigin.mockReturnValue(true);
    mocks.decode.mockReturnValue(null);
    mocks.list.mockResolvedValue({ items: [], nextCursor: null });
    mocks.create.mockResolvedValue({
      id: "223e4567-e89b-42d3-a456-426614174000",
      code: "sider_invite_secret",
      expiresAt: new Date("2026-11-02T00:00:00.000Z"),
    });
  });

  it("does not expose invitation management outside local auth mode", async () => {
    mocks.env.mockReturnValue({ AUTH_MODE: "launchpad" });
    const response = await GET(new Request("https://app.school.test/api/admin/registration-invites"));
    expect(response.status).toBe(404);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it("lists metadata without synthesizing or exposing invitation codes", async () => {
    const response = await GET(new Request("https://app.school.test/api/admin/registration-invites"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("sider_invite_");
  });

  it("rejects cross-origin creation before authorization or database work", async () => {
    mocks.sameOrigin.mockReturnValue(false);
    const response = await POST(postRequest());
    expect(response.status).toBe(403);
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("returns the plaintext code only in the successful create response", async () => {
    const response = await POST(postRequest());
    expect(response.status).toBe(201);
    expect(mocks.authorize).toHaveBeenCalledWith(expect.any(Request), "invite_create");
    expect(await response.json()).toEqual({
      invite: {
        id: "223e4567-e89b-42d3-a456-426614174000",
        code: "sider_invite_secret",
        expiresAt: "2026-11-02T00:00:00.000Z",
      },
    });
  });
});
