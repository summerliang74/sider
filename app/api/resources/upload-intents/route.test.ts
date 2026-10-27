import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sameOrigin: vi.fn(),
  ipLimit: vi.fn(),
  userLimit: vi.fn(),
  currentUser: vi.fn(),
  bot: vi.fn(),
  createIntent: vi.fn(),
  env: vi.fn(),
}));

vi.mock("@/src/lib/security/request", () => ({
  requireSameOrigin: mocks.sameOrigin,
  getClientIp: () => "192.0.2.1",
}));
vi.mock("@/src/lib/security/rate-limit", () => ({ enforceIpRateLimit: mocks.ipLimit, enforceUserRateLimit: mocks.userLimit }));
vi.mock("@/src/lib/security/responses", () => ({ securityErrorResponse: () => null }));
vi.mock("@/src/lib/security/bot", () => ({ verifyBotChallenge: mocks.bot }));
vi.mock("@/src/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/src/lib/resources-write", () => ({ createUploadIntent: mocks.createIntent }));
vi.mock("@/src/lib/env", () => ({ getServerEnv: mocks.env }));

import { POST } from "./route";

const user = { id: "123e4567-e89b-42d3-a456-426614174000", displayName: "Student", email: null, avatarUrl: null, org: "shsid", role: "student" };
const validBody = { title: "Guide", description: "Notes", tags: ["math"], originalFilename: "guide.pdf", sizeBytes: 512, mimeType: "application/pdf" };

function uploadRequest(body = validBody) {
  return new Request("https://app.school.test/api/resources/upload-intents", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.school.test" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/resources/upload-intents", () => {
  beforeEach(() => {
    mocks.sameOrigin.mockReturnValue(true);
    mocks.ipLimit.mockResolvedValue({ risky: false });
    mocks.userLimit.mockResolvedValue({ risky: false });
    mocks.currentUser.mockResolvedValue(user);
    mocks.bot.mockResolvedValue(undefined);
    mocks.createIntent.mockResolvedValue({ resourceId: user.id, uploadUrl: "https://storage.test/signed", expiresIn: 300, headers: { "content-type": "application/pdf" } });
    mocks.env.mockReturnValue({ UPLOAD_MAX_BYTES: 1024, malwareScanEnabled: true });
  });

  it("rejects cross-origin writes before limits, session lookup, or storage work", async () => {
    mocks.sameOrigin.mockReturnValue(false);
    const response = await POST(uploadRequest());
    expect(response.status).toBe(403);
    expect(mocks.ipLimit).not.toHaveBeenCalled();
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.createIntent).not.toHaveBeenCalled();
  });

  it("rejects an oversized file before creating a database or storage intent", async () => {
    const response = await POST(uploadRequest({ ...validBody, sizeBytes: 1025 }));
    expect(response.status).toBe(413);
    expect(mocks.createIntent).not.toHaveBeenCalled();
  });

  it("fails closed before limits, session lookup, or storage work when scanning is disabled", async () => {
    mocks.env.mockReturnValue({ UPLOAD_MAX_BYTES: 1024, malwareScanEnabled: false });
    const response = await POST(uploadRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "uploads_disabled" });
    expect(mocks.ipLimit).not.toHaveBeenCalled();
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.createIntent).not.toHaveBeenCalled();
  });

  it("creates an intent only after origin, limit, session, and bot policy checks", async () => {
    const response = await POST(uploadRequest());
    expect(response.status).toBe(201);
    expect(mocks.ipLimit).toHaveBeenCalledBefore(mocks.currentUser);
    expect(mocks.currentUser).toHaveBeenCalledBefore(mocks.userLimit);
    expect(mocks.bot).toHaveBeenCalledBefore(mocks.createIntent);
    expect(await response.json()).toMatchObject({ resourceId: user.id, expiresIn: 300 });
  });
});
