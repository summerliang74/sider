import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sameOrigin: vi.fn(),
  ipLimit: vi.fn(),
  userLimit: vi.fn(),
  currentUser: vi.fn(),
  upload: vi.fn(),
  env: vi.fn(),
}));

vi.mock("@/src/lib/security/request", () => ({ requireSameOrigin: mocks.sameOrigin, getClientIp: () => "192.0.2.1" }));
vi.mock("@/src/lib/security/rate-limit", () => ({ enforceIpRateLimit: mocks.ipLimit, enforceUserRateLimit: mocks.userLimit }));
vi.mock("@/src/lib/security/responses", () => ({ securityErrorResponse: () => null }));
vi.mock("@/src/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/src/lib/resources-write", () => ({ uploadPendingResource: mocks.upload }));
vi.mock("@/src/lib/env", () => ({ getServerEnv: mocks.env }));

import { PUT } from "./route";

const id = "123e4567-e89b-42d3-a456-426614174000";
const user = { id, displayName: "Student", email: null, avatarUrl: null, org: "shsid", role: "student" };

function request() {
  return new Request(`https://app.school.test/api/resources/${id}/upload`, {
    method: "PUT",
    headers: { origin: "https://app.school.test", "content-type": "text/plain", "content-length": "4" },
    body: "test",
  });
}

describe("PUT /api/resources/[id]/upload", () => {
  beforeEach(() => {
    mocks.sameOrigin.mockReturnValue(true);
    mocks.ipLimit.mockResolvedValue({ risky: false });
    mocks.userLimit.mockResolvedValue({ risky: false });
    mocks.currentUser.mockResolvedValue(user);
    mocks.upload.mockResolvedValue("uploaded");
    mocks.env.mockReturnValue({ UPLOAD_MAX_BYTES: 1024, malwareScanEnabled: true });
  });

  it("rejects cross-origin uploads before consuming limits", async () => {
    mocks.sameOrigin.mockReturnValue(false);
    const response = await PUT(request(), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(403);
    expect(mocks.ipLimit).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("streams an authenticated upload after binding its declared length and type", async () => {
    const response = await PUT(request(), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(204);
    expect(mocks.ipLimit).toHaveBeenCalledWith("upload_transfer", "192.0.2.1");
    expect(mocks.userLimit).toHaveBeenCalledWith("upload_transfer", user.id);
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({
      resourceId: id,
      user,
      contentType: "text/plain",
      contentLength: 4,
    }));
  });

  it("rejects a transfer that does not match its pending intent", async () => {
    mocks.upload.mockResolvedValue("mismatch");
    const response = await PUT(request(), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(409);
  });
});
