import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sameOrigin: vi.fn(),
  ipLimit: vi.fn(),
  userLimit: vi.fn(),
  currentUser: vi.fn(),
  resourceRows: vi.fn(),
  challenge: vi.fn(),
  getObjectPreview: vi.fn(),
  metric: vi.fn(),
}));

vi.mock("@/src/lib/security/request", () => ({ requireSameOrigin: mocks.sameOrigin, getClientIp: () => "192.0.2.1" }));
vi.mock("@/src/lib/security/rate-limit", () => ({ enforceIpRateLimit: mocks.ipLimit, enforceUserRateLimit: mocks.userLimit }));
vi.mock("@/src/lib/security/responses", () => ({ securityErrorResponse: () => null }));
vi.mock("@/src/lib/security/bot", () => ({ verifyBotChallenge: mocks.challenge }));
vi.mock("@/src/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/src/lib/storage", () => ({ getObjectPreview: mocks.getObjectPreview }));
vi.mock("@/src/lib/telemetry", () => ({ recordMetric: mocks.metric }));
vi.mock("@/src/db", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: mocks.resourceRows }),
      }),
    }),
  }),
}));

import { POST } from "./route";

const id = "123e4567-e89b-42d3-a456-426614174000";
const user = { id, displayName: "Student", email: null, avatarUrl: null, org: "shsid", role: "student" };

function request() {
  return new Request(`https://app.school.test/api/resources/${id}/preview`, {
    method: "POST",
    headers: { origin: "https://app.school.test", "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

describe("POST /api/resources/[id]/preview", () => {
  beforeEach(() => {
    mocks.sameOrigin.mockReturnValue(true);
    mocks.ipLimit.mockResolvedValue({ risky: false });
    mocks.userLimit.mockResolvedValue({ risky: false });
    mocks.currentUser.mockResolvedValue(user);
    mocks.resourceRows.mockResolvedValue([{
      objectKey: "active/resource/document.docx",
      filename: "AP CSP.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 4,
    }]);
    mocks.challenge.mockResolvedValue(undefined);
    mocks.getObjectPreview.mockResolvedValue({
      body: new Blob(["test"]).stream(),
      contentLength: 4,
    });
  });

  it("streams a private inline preview for an authenticated viewer", async () => {
    const response = await POST(request(), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(200);
    expect(mocks.ipLimit).toHaveBeenCalledBefore(mocks.currentUser);
    expect(mocks.currentUser).toHaveBeenCalledBefore(mocks.userLimit);
    expect(mocks.userLimit).toHaveBeenCalledBefore(mocks.challenge);
    expect(mocks.challenge).toHaveBeenCalledBefore(mocks.resourceRows);
    expect(mocks.resourceRows).toHaveBeenCalledBefore(mocks.getObjectPreview);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("inline");
    expect(response.headers.get("content-type")).toContain("wordprocessingml.document");
    await expect(response.text()).resolves.toBe("test");
  });

  it("does not stream unsupported file formats", async () => {
    mocks.resourceRows.mockResolvedValue([{
      objectKey: "active/resource/slides.pptx",
      filename: "slides.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      sizeBytes: 4,
    }]);

    const response = await POST(request(), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(415);
    expect(mocks.getObjectPreview).not.toHaveBeenCalled();
  });

  it("stops before session, resource, and object reads when the IP limiter rejects", async () => {
    mocks.ipLimit.mockRejectedValue(new Error("ip_limit_unavailable"));

    const response = await POST(request(), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(503);
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.resourceRows).not.toHaveBeenCalled();
    expect(mocks.getObjectPreview).not.toHaveBeenCalled();
  });

  it("stops before resource and object reads when the user limiter rejects", async () => {
    mocks.userLimit.mockRejectedValue(new Error("user_limit_unavailable"));

    const response = await POST(request(), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(503);
    expect(mocks.challenge).not.toHaveBeenCalled();
    expect(mocks.resourceRows).not.toHaveBeenCalled();
    expect(mocks.getObjectPreview).not.toHaveBeenCalled();
  });

  it("stops before resource and object reads when the challenge rejects", async () => {
    mocks.challenge.mockRejectedValue(new Error("challenge_rejected"));

    const response = await POST(request(), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(503);
    expect(mocks.resourceRows).not.toHaveBeenCalled();
    expect(mocks.getObjectPreview).not.toHaveBeenCalled();
  });
});
