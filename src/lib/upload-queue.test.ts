import { describe, expect, it, vi } from "vitest";
import { UploadError, UploadQueue, type UploadItem, type UploadTransport } from "./upload-queue";

const files = () => Array.from({ length: 5 }, (_, i) => new File(["hello"], `${i}.txt`, { type: "text/plain" }));
const metadata = { title: "Notes", description: "", tags: [] };
function transport(): UploadTransport {
  return {
    intent: vi.fn(async (file) => ({ resourceId: file.name, uploadUrl: "https://storage.test/upload", headers: {} })),
    put: vi.fn(async () => {}), complete: vi.fn(async () => ({ status: "scanning" })), cancel: vi.fn(async () => {}),
  };
}
describe("independent upload queue", () => {
  it("limits transfers to two and starts later files without waiting for scans", async () => {
    const api = transport();
    let active = 0; let maximum = 0;
    const release: Array<() => void> = [];
    api.put = vi.fn(() => new Promise<void>((resolve) => { active++; maximum = Math.max(maximum, active); release.push(() => { active--; resolve(); }); }));
    let state: UploadItem[] = [];
    const queue = new UploadQueue(files(), metadata, api, (items) => { state = items; });
    queue.start();
    await vi.waitFor(() => expect(release).toHaveLength(2));
    release[0]!();
    await vi.waitFor(() => expect(release).toHaveLength(3));
    expect(state[0]?.stage).toBe("scanning");
    release[1]!(); release[2]!();
    await vi.waitFor(() => expect(release).toHaveLength(5));
    release[3]!(); release[4]!();
    await vi.waitFor(() => expect(state.every((item) => item.stage === "scanning")).toBe(true));
    expect(maximum).toBe(2);
    queue.dispose();
  });
  it("continues after a failed file, and retries completion without reuploading", async () => {
    const api = transport(); let state: UploadItem[] = [];
    vi.mocked(api.complete).mockRejectedValueOnce(new UploadError("temporary failure"));
    const queue = new UploadQueue(files(), metadata, api, (items) => { state = items; });
    queue.start();
    await vi.waitFor(() => expect(state.filter((item) => item.stage === "scanning")).toHaveLength(4));
    queue.retry("0");
    await vi.waitFor(() => expect(state.every((item) => item.stage === "scanning")).toBe(true));
    expect(api.put).toHaveBeenCalledTimes(5);
    expect(api.intent).toHaveBeenCalledTimes(5);
    queue.dispose();
  });
  it("binds a challenge token to only the affected completion request", async () => {
    const api = transport(); let state: UploadItem[] = [];
    vi.mocked(api.complete).mockRejectedValueOnce(new UploadError("challenge", "complete"));
    const queue = new UploadQueue(files().slice(0, 2), metadata, api, (items) => { state = items; });
    queue.start();
    await vi.waitFor(() => expect(state[0]?.challenge).toBe("complete"));
    queue.retry("0"); expect(api.complete).toHaveBeenCalledTimes(2);
    queue.retry("0", "single-use-token");
    await vi.waitFor(() => expect(state[0]?.stage).toBe("scanning"));
    expect(api.complete).toHaveBeenLastCalledWith("0.txt", expect.any(AbortSignal), "single-use-token");
    expect(api.put).toHaveBeenCalledTimes(2);
    queue.dispose();
  });
  it("cancels a queued file without creating an intent for it", async () => {
    const api = transport(); let state: UploadItem[] = [];
    api.put = vi.fn((_file, _intent, signal) => new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const queue = new UploadQueue(files(), metadata, api, (items) => { state = items; });
    queue.start(); await queue.cancel("4");
    expect(state[4]?.stage).toBe("cancelled");
    expect(api.intent).toHaveBeenCalledTimes(2);
    queue.dispose();
  });
  it("cancels an accepted scan via the authenticated delete endpoint", async () => {
    const api = transport(); let state: UploadItem[] = [];
    const queue = new UploadQueue(files().slice(0, 1), metadata, api, (items) => { state = items; });
    queue.start(); await vi.waitFor(() => expect(state[0]?.stage).toBe("scanning"));
    await queue.cancel("0");
    queue.updateStatuses([{ id: "0.txt", status: "active" }]);
    expect(api.cancel).toHaveBeenCalledWith("0.txt");
    expect(state[0]?.stage).toBe("cancelled");
    queue.dispose();
  });
});
