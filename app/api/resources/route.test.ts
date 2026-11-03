import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ipLimit: vi.fn(),
  userLimit: vi.fn(),
  currentUser: vi.fn(),
  bot: vi.fn(),
  list: vi.fn(),
  metric: vi.fn(),
}));

vi.mock("@/src/lib/security/rate-limit", () => ({
  enforceIpRateLimit: mocks.ipLimit,
  enforceUserRateLimit: mocks.userLimit,
}));
vi.mock("@/src/lib/security/request", () => ({ getClientIp: () => "192.0.2.1" }));
vi.mock("@/src/lib/security/bot", () => ({ verifyBotChallenge: mocks.bot }));
vi.mock("@/src/lib/security/responses", () => ({
  securityErrorResponse: (error: unknown) => error instanceof Error && error.message === "rate_limited"
    ? Response.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "60" } })
    : null,
}));
vi.mock("@/src/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/src/lib/resources", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/lib/resources")>();
  return { ...original, listActiveResources: mocks.list };
});
vi.mock("@/src/lib/telemetry", () => ({ recordMetric: mocks.metric }));

import { GET } from "./route";

const user = { id: "123e4567-e89b-42d3-a456-426614174000", displayName: "Student", email: null, avatarUrl: null, org: "shsid", role: "student" };

describe("GET /api/resources", () => {
  beforeEach(() => {
    mocks.ipLimit.mockResolvedValue({ risky: false });
    mocks.userLimit.mockResolvedValue({ risky: false });
    mocks.currentUser.mockResolvedValue(user);
    mocks.bot.mockResolvedValue(undefined);
    mocks.list.mockResolvedValue({ items: [], nextCursor: null });
  });

  it("rejects at the coarse IP limit before session or database work", async () => {
    mocks.ipLimit.mockRejectedValue(new Error("rate_limited"));
    const response = await GET(new Request("https://app.school.test/api/resources"));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("does not run user limits or resource queries for an invalid session", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const response = await GET(new Request("https://app.school.test/api/resources"));
    expect(response.status).toBe(401);
    expect(mocks.userLimit).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("runs both limit layers and returns no-store results for an eligible user", async () => {
    const publishedAt = new Date("2026-10-27T00:00:00.000Z");
    mocks.list.mockResolvedValue({
      items: [{ id: user.id, title: "Guide", description: "", tags: [], originalFilename: "guide.pdf", mimeType: "application/pdf", sizeBytes: 1024, publishedAt, authorName: "Student" }],
      nextCursor: "next",
    });
    const response = await GET(new Request("https://app.school.test/api/resources?q=guide&type=pdf"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.ipLimit).toHaveBeenCalledWith("search", "192.0.2.1");
    expect(mocks.userLimit).toHaveBeenCalledWith("search", user.id);
    expect(mocks.bot).toHaveBeenCalledWith(expect.objectContaining({ required: false, action: "search" }));
    expect(mocks.list).toHaveBeenCalledWith({ q: "guide", fileType: "pdf", collection: undefined, cursor: undefined });
    expect(await response.json()).toMatchObject({ items: [{ title: "Guide", publishedAt: publishedAt.toISOString() }], nextCursor: "next" });
  });

  it("rejects an unsupported file type filter", async () => {
    const response = await GET(new Request("https://app.school.test/api/resources?type=exe"));
    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("forwards the Peer Advisors collection filter", async () => {
    const response = await GET(new Request("https://app.school.test/api/resources?collection=peer-advisors"));
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({ q: "", fileType: undefined, collection: "peer-advisors", cursor: undefined });
  });

  it("rejects an unsupported resource collection", async () => {
    const response = await GET(new Request("https://app.school.test/api/resources?collection=staff-only"));
    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("combines a tag with text search and file type", async () => {
    const response = await GET(new Request("https://app.school.test/api/resources?q=guide&type=pdf&tag=PA"));
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ q: "guide", fileType: "pdf", tag: "PA" }));
  });

  it("rejects oversized tag filters", async () => {
    const response = await GET(new Request("https://app.school.test/api/resources?tag=" + "x".repeat(31)));
    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
