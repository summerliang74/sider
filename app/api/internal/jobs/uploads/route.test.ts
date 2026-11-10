import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock("@/src/lib/env", () => ({ getServerEnv: () => ({ malwareScanEnabled: true, CRON_SECRET: "worker-test-secret-with-32-characters" }) }));
vi.mock("@/src/lib/upload-worker", () => ({ processNextUploadScan: mocks.process }));
import { POST } from "./route";
describe("upload worker endpoint", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("does not access the queue without the internal secret", async () => {
    const response = await POST(new Request("https://app.test/api/internal/jobs/uploads", { method: "POST" }));
    expect(response.status).toBe(401); expect(mocks.process).not.toHaveBeenCalled();
  });
  it("processes one task for an authenticated worker", async () => {
    mocks.process.mockResolvedValue({ processed: true, committed: true });
    const response = await POST(new Request("https://app.test/api/internal/jobs/uploads", { method: "POST", headers: { authorization: "Bearer worker-test-secret-with-32-characters" } }));
    expect(response.status).toBe(200); expect(mocks.process).toHaveBeenCalledTimes(1);
  });
});
