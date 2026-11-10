import { afterEach, describe, expect, it, vi } from "vitest";
import { browserUploadTransport, uploadStatusResponse } from "./upload-client";

const id = "93d52fa9-ce4e-4858-85a0-3a9f9564cdd8";
const file = new File(["hello"], "notes.txt", { type: "text/plain" });
const metadata = { title: "Notes", description: "", tags: [] };
const signal = () => new AbortController().signal;

describe("upload response boundaries", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("rejects an insecure upload destination before transferring file bytes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ resourceId: id, uploadUrl: "http://storage.test/file", headers: {} })));
    await expect(browserUploadTransport.intent(file, metadata, signal())).rejects.toThrow("could not be prepared");
  });
  it("rejects a completion response for a different resource", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id: "93d52fa9-ce4e-4858-85a0-3a9f9564cdd9", status: "active" })));
    await expect(browserUploadTransport.complete(id, signal())).rejects.toThrow("did not match");
  });
  it("turns an invalid error body into a safe retry message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(null, { status: 502 })));
    await expect(browserUploadTransport.intent(file, metadata, signal())).rejects.toThrow("Retry this file");
  });
  it("rejects malformed polling results instead of applying unrecognized statuses", () => {
    expect(uploadStatusResponse.safeParse({ items: [{ id, status: "public" }] }).success).toBe(false);
    expect(uploadStatusResponse.safeParse({ items: null }).success).toBe(false);
  });
});
