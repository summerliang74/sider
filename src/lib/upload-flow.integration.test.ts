import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

const objects = vi.hoisted(() => new Map<string, { contentLength: number; contentType: string; resourceId: string; etag: string }>());
const scanner = vi.hoisted(() => vi.fn());
vi.mock("@/src/lib/env", () => ({ getServerEnv: () => ({
  DATABASE_URL: process.env.TEST_DATABASE_URL, DATABASE_MAX_CONNECTIONS: 5,
  CRON_SECRET: "integration-cron-secret-with-32-characters", RESOURCE_DELETE_RETENTION_DAYS: 7,
}) }));
vi.mock("@/src/lib/storage", () => ({
  headObject: vi.fn(async (key: string) => { const value = objects.get(key); if (!value) throw new Error("missing"); return { ...value }; }),
  copyObject: vi.fn(async (source: string, target: string, etag?: string) => {
    const value = objects.get(source); if (!value || (etag && value.etag !== etag)) throw new Error("precondition_failed");
    objects.set(target, { ...value });
  }),
  deleteObject: vi.fn(async (key: string) => { objects.delete(key); }),
}));
vi.mock("@/src/lib/scanner", () => ({ scanObject: scanner }));
vi.mock("@/src/lib/telemetry", () => ({ recordMetric: vi.fn() }));

import { getDatabase, closeDatabaseForTests } from "@/src/db";
import { resources, uploadScanJobs, users } from "@/src/db/schema";
import { enqueueUploadScan } from "./upload-completion";
import { claimScanJob, settleScanJob, scanOutputKey } from "./upload-scan-jobs";
import { processNextUploadScan } from "./upload-worker";
import { copyObject, headObject } from "./storage";
import { POST as cleanup } from "@/app/api/internal/jobs/cleanup/route";

// Explicit opt-in: the runner must supply the independently verified temporary
// branch host. This suite never falls back to the application's DATABASE_URL.
describe.skipIf(!process.env.TEST_DATABASE_URL)("upload flow on isolated PostgreSQL", () => {
  const userId = randomUUID(); const ids: string[] = [];
  const user = { id: userId, role: "student" as const, displayName: "Upload test", email: null, avatarUrl: null, org: "test" };
  beforeAll(async () => {
    const host = new URL(process.env.TEST_DATABASE_URL!).hostname;
    if (!process.env.TEST_DATABASE_HOST || host !== process.env.TEST_DATABASE_HOST) throw new Error("isolated_database_host_not_confirmed");
    const db = getDatabase();
    const [existing] = await db.execute<{ count: string }>(sql`select count(*)::text as count from users`);
    if (existing?.count !== "0") throw new Error("integration_requires_empty_schema_only_database");
    const [table] = await db.execute<{ name: string | null }>(sql`select to_regclass('public.upload_scan_jobs')::text as name`);
    if (!table?.name) {
      const migration = await readFile("drizzle/0006_upload_scan_queue.sql", "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await db.execute(sql.raw(statement));
    }
    await db.insert(users).values({ id: userId, launchpadSub: `test:${userId}`, displayName: "Upload test", org: "test", verified: false });
  }, 60_000);
  beforeEach(async () => {
    const db = getDatabase();
    if (ids.length) await db.delete(resources).where(inArray(resources.id, ids));
    ids.length = 0; objects.clear(); vi.clearAllMocks();
    await db.update(users).set({ status: "active" }).where(eq(users.id, userId));
    scanner.mockResolvedValue({ status: "clean", detectedMimeType: "text/plain", sha256: "a".repeat(64) });
  });
  afterAll(async () => {
    if (ids.length) await getDatabase().delete(resources).where(inArray(resources.id, ids));
    await getDatabase().delete(users).where(eq(users.id, userId));
    await closeDatabaseForTests();
  });
  async function fixture() {
    const id = randomUUID(); ids.push(id);
    const source = `pending/${id}/ingress`;
    await getDatabase().insert(resources).values({ id, authorId: userId, title: "Test", description: "", tags: [], originalFilename: "notes.txt", objectKey: source, mimeType: "text/plain", sizeBytes: 5 });
    objects.set(source, { contentLength: 5, contentType: "text/plain", resourceId: id, etag: '"original"' });
    return { id, source };
  }
  async function resource(id: string) { return (await getDatabase().select().from(resources).where(eq(resources.id, id)))[0]!; }
  async function job(id: string) { return (await getDatabase().select().from(uploadScanJobs).where(eq(uploadScanJobs.resourceId, id)))[0]!; }
  async function due(id: string) { await getDatabase().update(uploadScanJobs).set({ availableAt: new Date(0) }).where(eq(uploadScanJobs.resourceId, id)); }

  it("publishes the scanned snapshot even if the signed ingress is overwritten", async () => {
    const { id, source } = await fixture();
    expect((await enqueueUploadScan(id, user))?.status).toBe("scanning");
    expect(scanner).not.toHaveBeenCalled();
    objects.set(source, { ...objects.get(source)!, etag: '"malicious-replacement"' });
    await processNextUploadScan();
    const published = await resource(id);
    expect(published.status).toBe("active");
    expect(objects.get(published.objectKey)?.etag).toBe('"original"');
    expect(scanner).toHaveBeenCalledWith({ resourceId: id, objectKey: (await job(id)).snapshotKey });
  });
  it("makes simultaneous completions idempotent and keeps exactly one job", async () => {
    const { id } = await fixture();
    const results = await Promise.all([enqueueUploadScan(id, user), enqueueUploadScan(id, user)]);
    expect(results.map((result) => result?.status)).toEqual(["scanning", "scanning"]);
    expect(await getDatabase().select().from(uploadScanJobs).where(eq(uploadScanJobs.resourceId, id))).toHaveLength(1);
    expect(objects.size).toBe(2);
  });
  it("recovers a queued job after the application database pool restarts", async () => {
    const { id } = await fixture(); await enqueueUploadScan(id, user);
    await closeDatabaseForTests();
    await processNextUploadScan();
    expect((await resource(id)).status).toBe("active");
  });
  it("enforces one scanner lease across simultaneous claimers", async () => {
    const first = await fixture(); const second = await fixture();
    await enqueueUploadScan(first.id, user); await enqueueUploadScan(second.id, user);
    const claims = await Promise.all([claimScanJob(), claimScanJob()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await claimScanJob()).toBeNull();
  });
  it("rejects an expired worker result after a replacement worker claims the job", async () => {
    const { id } = await fixture(); await enqueueUploadScan(id, user);
    const old = (await claimScanJob())!;
    await getDatabase().update(uploadScanJobs).set({ leaseUntil: new Date(0) }).where(eq(uploadScanJobs.resourceId, id));
    const replacement = (await claimScanJob())!;
    expect(replacement.leaseToken).not.toBe(old.leaseToken);
    expect(await settleScanJob(old, { status: "active", objectKey: "stale", mimeType: "text/plain", sha256: "a".repeat(64) })).toBe(false);
    expect((await resource(id)).status).toBe("scanning");
  });
  it("retries scanner outages three times then quarantines without publishing", async () => {
    const { id } = await fixture(); await enqueueUploadScan(id, user);
    scanner.mockResolvedValue({ status: "error" });
    for (let attempt = 1; attempt <= 3; attempt++) {
      await processNextUploadScan();
      expect((await resource(id)).status).toBe(attempt < 3 ? "scanning" : "quarantined");
      await due(id);
    }
    expect((await job(id)).status).toBe("failed"); expect(scanner).toHaveBeenCalledTimes(3);
  });
  it("never retries an infected file", async () => {
    const { id } = await fixture(); await enqueueUploadScan(id, user);
    scanner.mockResolvedValue({ status: "infected" }); await processNextUploadScan();
    expect((await resource(id)).moderationReason).toBe("malware_detected");
    expect((await job(id)).status).toBe("failed");
    expect((await processNextUploadScan()).processed).toBe(false);
  });
  it("does not scan or republish a cancelled resource", async () => {
    const { id } = await fixture(); await enqueueUploadScan(id, user);
    await getDatabase().update(resources).set({ status: "deleted", deletedAt: new Date() }).where(eq(resources.id, id));
    await processNextUploadScan();
    expect((await resource(id)).status).toBe("deleted"); expect(scanner).not.toHaveBeenCalled();
  });
  it("does not publish if the author is suspended during scanning", async () => {
    const { id } = await fixture(); await enqueueUploadScan(id, user);
    scanner.mockImplementation(async () => {
      await getDatabase().update(users).set({ status: "suspended" }).where(eq(users.id, userId));
      return { status: "clean", detectedMimeType: "text/plain", sha256: "a".repeat(64) };
    });
    await processNextUploadScan(); expect((await resource(id)).status).toBe("quarantined");
  });
  it("rejects mismatched metadata and a source replaced between HEAD and COPY", async () => {
    const { id, source } = await fixture();
    objects.set(source, { ...objects.get(source)!, contentLength: 99 });
    await expect(enqueueUploadScan(id, user)).rejects.toThrow("object_mismatch");
    expect(copyObject).not.toHaveBeenCalled();
    objects.set(source, { ...objects.get(source)!, contentLength: 5 });
    vi.mocked(headObject).mockImplementationOnce(async () => {
      const previous = { ...objects.get(source)! }; objects.set(source, { ...previous, etag: '"changed"' }); return previous;
    });
    await expect(enqueueUploadScan(id, user)).rejects.toThrow("precondition_failed");
    expect((await resource(id)).status).toBe("pending");
  });
  it("rejects other owners and expired intents before touching storage", async () => {
    const { id } = await fixture();
    expect(await enqueueUploadScan(id, { ...user, id: randomUUID() })).toBeNull();
    await getDatabase().update(resources).set({ createdAt: new Date(0) }).where(eq(resources.id, id));
    await expect(enqueueUploadScan(id, user)).rejects.toThrow("upload_expired");
    expect(headObject).not.toHaveBeenCalled();
  });
  it("cleanup preserves live jobs and removes only unused copies after completion", async () => {
    const { id, source } = await fixture(); await enqueueUploadScan(id, user);
    await getDatabase().update(resources).set({ updatedAt: new Date(0) }).where(eq(resources.id, id));
    const request = () => new Request("https://test.invalid/api/internal/jobs/cleanup", { method: "POST", headers: { authorization: "Bearer integration-cron-secret-with-32-characters" } });
    await cleanup(request()); expect(objects.has((await job(id)).snapshotKey)).toBe(true);
    await processNextUploadScan();
    await getDatabase().update(uploadScanJobs).set({ updatedAt: new Date(0) }).where(and(eq(uploadScanJobs.resourceId, id), eq(uploadScanJobs.status, "done")));
    await cleanup(request());
    expect(objects.has(source)).toBe(false); expect(objects.has((await job(id)).snapshotKey)).toBe(false);
    expect(objects.has(scanOutputKey(await job(id)))).toBe(true);
  });
});
