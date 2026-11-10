import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sameOrigin: vi.fn(), ip: vi.fn(), userLimit: vi.fn(), user: vi.fn(), challenge: vi.fn(), complete: vi.fn() }));
vi.mock("@/src/lib/env", () => ({ getServerEnv: () => ({ malwareScanEnabled: true }) }));
vi.mock("@/src/lib/auth/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/src/lib/security/request", () => ({ requireSameOrigin: mocks.sameOrigin, getClientIp: () => "192.0.2.1" }));
vi.mock("@/src/lib/security/rate-limit", () => ({ enforceIpRateLimit: mocks.ip, enforceUserRateLimit: mocks.userLimit }));
vi.mock("@/src/lib/security/bot", () => ({ verifyBotChallenge: mocks.challenge }));
vi.mock("@/src/lib/security/responses", () => ({ securityErrorResponse: () => null }));
vi.mock("@/src/lib/resources-write", () => ({ completeUpload: mocks.complete }));
vi.mock("@/src/lib/telemetry", () => ({ recordMetric: vi.fn() }));
import { POST } from "./route";

describe("asynchronous upload completion route", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const call = () => POST(new Request("https://app.test/api/resources/id/complete", { method: "POST", body: "{}" }), { params: Promise.resolve({ id }) });
  beforeEach(() => { vi.clearAllMocks(); mocks.sameOrigin.mockReturnValue(true); mocks.ip.mockResolvedValue({ risky: false }); mocks.userLimit.mockResolvedValue({ risky: false }); mocks.user.mockResolvedValue({ id }); mocks.challenge.mockResolvedValue(undefined); mocks.complete.mockResolvedValue({ id, status: "scanning" }); });
  it("returns 202 for an accepted scan with no-store", async () => { const response = await call(); expect(response.status).toBe(202); expect(response.headers.get("cache-control")).toContain("no-store"); await expect(response.json()).resolves.toEqual({ id, status: "scanning" }); });
  it("returns the published state on a duplicate completion", async () => { mocks.complete.mockResolvedValue({ id, status: "active" }); expect((await call()).status).toBe(200); });
  it("rejects cross-origin callers before auth or storage", async () => { mocks.sameOrigin.mockReturnValue(false); expect((await call()).status).toBe(403); expect(mocks.ip).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled(); });
  it("runs the coarse limiter before session work", async () => { mocks.ip.mockRejectedValue(new Error("rate_store_unavailable")); expect((await call()).status).toBe(503); expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled(); });
  it("stops before completion on failed challenge", async () => { mocks.challenge.mockRejectedValue(new Error("challenge")); expect((await call()).status).toBe(503); expect(mocks.complete).not.toHaveBeenCalled(); });
  it("rejects mismatched objects without claiming successful completion", async () => { mocks.complete.mockRejectedValue(new Error("object_mismatch")); expect((await call()).status).toBe(409); });
});
