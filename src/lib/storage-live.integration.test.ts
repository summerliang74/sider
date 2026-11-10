import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createUploadUrl, copyObject, deleteObject, headObject, createDownloadUrl } from "./storage";
import { getServerEnv } from "./env";

// Opt-in adapter contract test against the configured private store. All writes
// use unique synthetic pending/<uuid>/ keys; no user objects are read or changed.
describe.skipIf(process.env.TEST_LIVE_STORAGE !== "1")("live private storage upload contract", () => {
  const id = randomUUID(); const keys = ["upload", "snapshot", "wrong-size", "wrong-type", "boundary"].map((name) => `pending/${id}/test-${name}`);
  afterAll(async () => { await Promise.all(keys.map((key) => deleteObject(key))); });
  it("accepts signed PUT and pins a snapshot while ingress remains writable", async () => {
    const signed = await createUploadUrl({ objectKey: keys[0]!, resourceId: id, mimeType: "text/plain", sizeBytes: 5 });
    const uploaded = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: "hello" });
    expect(uploaded.status).toBe(200);
    const original = await headObject(keys[0]!);
    expect(original).toMatchObject({ resourceId: id, contentType: "text/plain", contentLength: 5 });
    await copyObject(keys[0]!, keys[1]!, original.etag);
    expect((await fetch(signed.url, { method: "PUT", headers: signed.headers, body: "other" })).ok).toBe(true);
    await expect(copyObject(keys[0]!, keys[1]!, original.etag)).rejects.toThrow();
    const read = await createDownloadUrl({ objectKey: keys[1]!, filename: "test.txt" });
    expect(await (await fetch(read.url)).text()).toBe("hello");
    expect((await fetch(read.url.split("?")[0]!)).ok).toBe(false);
  }, 60_000);
  it("rejects mismatched size and type in signed upload requests", async () => {
    for (const [index, body, type] of [[2, "too-long", "text/plain"], [3, "hello", "application/pdf"]] as const) {
      const signed = await createUploadUrl({ objectKey: keys[index]!, resourceId: id, mimeType: "text/plain", sizeBytes: 5 });
      const result = await fetch(signed.url, { method: "PUT", headers: { ...signed.headers, "content-type": type }, body });
      expect(result.ok).toBe(false);
    }
  }, 60_000);
  it("permits the application origin's browser preflight", async () => {
    const signed = await createUploadUrl({ objectKey: keys[0]!, resourceId: id, mimeType: "text/plain", sizeBytes: 5 });
    const result = await fetch(signed.url, { method: "OPTIONS", headers: {
      Origin: getServerEnv().APP_BASE_URL, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type,x-amz-meta-resource",
    } });
    expect(result.ok).toBe(true);
    expect(result.headers.get("access-control-allow-origin")).toBe(getServerEnv().APP_BASE_URL);
    expect(result.headers.get("access-control-allow-methods")?.toUpperCase().split(/\s*,\s*/)).toContain("PUT");
    const allowedHeaders = result.headers.get("access-control-allow-headers")?.toLowerCase().split(/\s*,\s*/);
    expect(allowedHeaders).toEqual(expect.arrayContaining(["content-type", "x-amz-meta-resource"]));
    const unapproved = await fetch(signed.url, { method: "OPTIONS", headers: {
      Origin: "https://unapproved-upload-origin.invalid", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type,x-amz-meta-resource",
    } });
    expect([null, ""]).toContain(unapproved.headers.get("access-control-allow-origin"));
  }, 30_000);
  it("accepts a synthetic 50 MiB text upload", async () => {
    const size = 50 * 1024 * 1024;
    const signed = await createUploadUrl({ objectKey: keys[4]!, resourceId: id, mimeType: "text/plain", sizeBytes: size });
    const result = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: Buffer.alloc(size, 97), signal: AbortSignal.timeout(120_000) });
    expect(result.ok).toBe(true);
    expect((await headObject(keys[4]!)).contentLength).toBe(size);
  }, 130_000);
});
