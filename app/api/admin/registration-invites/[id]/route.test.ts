import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  authorize: vi.fn(),
  sameOrigin: vi.fn(),
  revoke: vi.fn(),
  metric: vi.fn(),
}));

vi.mock("@/src/lib/env", () => ({ getServerEnv: mocks.env }));
vi.mock("@/src/lib/security/admin", () => ({ authorizeAdminRequest: mocks.authorize }));
vi.mock("@/src/lib/security/request", () => ({ requireSameOrigin: mocks.sameOrigin }));
vi.mock("@/src/lib/registration-invites", () => ({ revokeRegistrationInvite: mocks.revoke }));
vi.mock("@/src/lib/telemetry", () => ({ recordMetric: mocks.metric }));

import { DELETE } from "./route";

const id = "223e4567-e89b-42d3-a456-426614174000";
const admin = { id: "123e4567-e89b-42d3-a456-426614174000", role: "admin" };

function request() {
  return new Request(`https://app.school.test/api/admin/registration-invites/${id}`, {
    method: "DELETE",
    headers: { origin: "https://app.school.test" },
  });
}

describe("DELETE /api/admin/registration-invites/:id", () => {
  beforeEach(() => {
    mocks.env.mockReturnValue({ AUTH_MODE: "local" });
    mocks.authorize.mockResolvedValue({ user: admin });
    mocks.sameOrigin.mockReturnValue(true);
    mocks.revoke.mockResolvedValue(true);
  });

  it("uses the dedicated revoke limit and records a successful revocation", async () => {
    const response = await DELETE(request(), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledWith(expect.any(Request), "invite_revoke");
    expect(mocks.revoke).toHaveBeenCalledWith(id, admin.id);
    expect(await response.json()).toEqual({ status: "revoked" });
  });

  it("uses one immutable response for consumed, expired, revoked, or missing invitations", async () => {
    mocks.revoke.mockResolvedValue(false);
    const response = await DELETE(request(), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "invite_unavailable" });
  });

  it("rejects invalid identifiers without database work", async () => {
    const response = await DELETE(request(), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(response.status).toBe(409);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
});
