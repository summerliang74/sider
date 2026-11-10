import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, lte, or, sql } from "drizzle-orm";
import { getDatabase } from "@/src/db";
import { resources, uploadScanJobs, users } from "@/src/db/schema";

export const MAX_SCAN_ATTEMPTS = 3;
export const SCAN_LEASE_MS = 5 * 60_000;
export type ScanJob = typeof uploadScanJobs.$inferSelect & {
  resource: Pick<typeof resources.$inferSelect, "id" | "originalFilename" | "sizeBytes" | "mimeType" | "status">;
  authorActive: boolean;
};
export type ScanOutcome =
  | { status: "active"; objectKey: string; mimeType: string; sha256: string }
  | { status: "quarantined"; reason: string }
  | { status: "retry"; reason: string };

export function scanOutputKey(job: Pick<ScanJob, "resourceId" | "snapshotKey">) {
  return `active/${job.resourceId}/${job.snapshotKey.split("/").at(-1)}`;
}

export async function claimScanJob(): Promise<ScanJob | null> {
  return getDatabase().transaction(async (tx) => {
    // Serialize claimers across app instances. Leases cap normal processing at
    // one task globally; the lock is released before any storage/scanner I/O.
    const [lock] = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(1936286821) as locked`);
    if (!lock?.locked) return null;
    const now = new Date();
    const [running] = await tx.select({ id: uploadScanJobs.resourceId }).from(uploadScanJobs)
      .where(and(eq(uploadScanJobs.status, "processing"), gt(uploadScanJobs.leaseUntil, now))).limit(1);
    if (running) return null;
    const [candidate] = await tx.select({ job: uploadScanJobs, resource: {
      id: resources.id, originalFilename: resources.originalFilename, sizeBytes: resources.sizeBytes,
      mimeType: resources.mimeType, status: resources.status,
    }, authorStatus: users.status }).from(uploadScanJobs)
      .innerJoin(resources, eq(resources.id, uploadScanJobs.resourceId))
      .innerJoin(users, eq(users.id, resources.authorId))
      .where(or(
        and(eq(uploadScanJobs.status, "queued"), lte(uploadScanJobs.availableAt, now)),
        and(eq(uploadScanJobs.status, "processing"), lte(uploadScanJobs.leaseUntil, now)),
      )).orderBy(asc(uploadScanJobs.availableAt)).limit(1).for("update", { of: uploadScanJobs });
    if (!candidate) return null;
    const [claimed] = await tx.update(uploadScanJobs).set({
      status: "processing", attempts: candidate.job.attempts + 1,
      leaseToken: randomUUID(), leaseUntil: new Date(now.getTime() + SCAN_LEASE_MS), updatedAt: now,
    }).where(eq(uploadScanJobs.resourceId, candidate.job.resourceId)).returning();
    return claimed ? { ...claimed, resource: candidate.resource, authorActive: candidate.authorStatus === "active" } : null;
  });
}

export async function settleScanJob(job: ScanJob, outcome: ScanOutcome): Promise<boolean> {
  return getDatabase().transaction(async (tx) => {
    const now = new Date();
    const [owned] = await tx.select().from(uploadScanJobs).where(and(
      eq(uploadScanJobs.resourceId, job.resourceId), eq(uploadScanJobs.status, "processing"),
      eq(uploadScanJobs.leaseToken, job.leaseToken!), gt(uploadScanJobs.leaseUntil, now),
    )).for("update").limit(1);
    if (!owned) return false;
    const [resource] = await tx.select({ status: resources.status, authorStatus: users.status }).from(resources)
      .innerJoin(users, eq(users.id, resources.authorId)).where(eq(resources.id, job.resourceId)).limit(1);
    const canPublish = resource?.status === "scanning" && resource.authorStatus === "active";
    if (outcome.status === "retry" && canPublish && job.attempts < MAX_SCAN_ATTEMPTS) {
      await tx.update(uploadScanJobs).set({ status: "queued", lastError: outcome.reason,
        availableAt: new Date(now.getTime() + 30_000 * 2 ** (job.attempts - 1)), leaseToken: null, leaseUntil: null, updatedAt: now,
      }).where(eq(uploadScanJobs.resourceId, job.resourceId));
      return true;
    }
    const active = outcome.status === "active" && canPublish;
    const values = active && outcome.status === "active"
      ? { status: "active" as const, objectKey: outcome.objectKey, mimeType: outcome.mimeType, sha256: outcome.sha256, publishedAt: now, updatedAt: now }
      : { status: "quarantined" as const, moderationReason: canPublish && outcome.status !== "active" ? outcome.reason : "upload_cancelled", updatedAt: now };
    const [updated] = await tx.update(resources).set(values)
      .where(and(eq(resources.id, job.resourceId), eq(resources.status, "scanning"),
        ...(active ? [sql`exists (select 1 from ${users} where ${users.id} = ${resources.authorId} and ${users.status} = 'active')`] : []),
      )).returning({ id: resources.id });
    await tx.update(uploadScanJobs).set({ status: active && updated ? "done" : "failed",
      lastError: active && updated ? null : "reason" in outcome ? outcome.reason : "upload_cancelled",
      leaseToken: null, leaseUntil: null, updatedAt: now,
    }).where(eq(uploadScanJobs.resourceId, job.resourceId));
    return Boolean(updated);
  });
}
