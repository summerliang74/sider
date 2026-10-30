import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sameOrigin: vi.fn(),
  ipLimit: vi.fn(),
  userLimit: vi.fn(),
  currentUser: vi.fn(),
  resourceRows: vi.fn(),
  challenge: vi.fn(),
  createDownloadUrl: vi.fn(),
  metric: vi.fn(),
}));

vi.mock("@/src/lib/security/request", () => ({ requireSameOrigin: mocks.sameOrigin, getClientIp: () => "192.0.2.1" }));
vi.mock("@/src/lib/security/rate-limit", () => ({ enforceIpRateLimit: mocks.ipLimit, enforceUserRateLimit: mocks.userLimit }));
vi.mock("@/src/lib/security/responses", () => ({ securityErrorResponse: () => null }));
vi.mock("@/src/lib/security/bot", () => ({ verifyBotChallenge: mocks.challenge }));
vi.mock("@/src/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/src/lib/storage", () => ({ createDownloadUrl: mocks.createDownloadUrl }));
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
  return new Request(`https://app.school.test/api/resources/${id}/download`, {
    method: "POST",
    headers: { origin: "https://app.school.test", "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("POST /api/resources/[id]/download", () => {
  beforeEach(() => {
    mocks.sameOrigin.mockReturnValue(true);
    mocks.ipLimit.mockResolvedValue({ risky: false });
    mocks.userLimit.mockResolvedValue({ risky: false });
    mocks.currentUser.mockResolvedValue(user);
    mocks.resourceRows.mockResolvedValue([{ objectKey: "active/resource/document.docx", filename: "AP CSP.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }]);
    mocks.challenge.mockResolvedValue(undefined);
    mocks.createDownloadUrl.mockResolvedValue({ url: "https://example.test/signed-download", expiresIn: 120 });
  });

  it("starts session validation while the IP limiter is still pending", async () => {
    const ipLimit = deferred<{ risky: boolean }>();
    mocks.ipLimit.mockReturnValue(ipLimit.promise);

    const responsePromise = POST(request(), { params: Promise.resolve({ id }) });
    await vi.waitFor(() => expect(mocks.currentUser).toHaveBeenCalledOnce());
    ipLimit.resolve({ risky: false });

    expect((await responsePromise).status).toBe(200);
  });

  it("queries the resource while the user limiter is still pending", async () => {
    const userLimit = deferred<{ risky: boolean }>();
    mocks.userLimit.mockReturnValue(userLimit.promise);

    const responsePromise = POST(request(), { params: Promise.resolve({ id }) });
    await vi.waitFor(() => expect(mocks.resourceRows).toHaveBeenCalledOnce());
    userLimit.resolve({ risky: false });

    const response = await responsePromise;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ url: "https://example.test/signed-download", expiresIn: 120 });
  });
});
