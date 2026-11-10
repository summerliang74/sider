import { and, eq, inArray, isNull, lt, notExists, or } from "drizzle-orm";

import { getDatabase } from "@/src/db";
import { oauthLoginTransactions, resources, sessions, uploadScanJobs } from "@/src/db/schema";
import { safeEqual } from "@/src/lib/crypto";
import { getServerEnv } from "@/src/lib/env";
import { noStoreJson } from "@/src/lib/http";
import { deleteObject } from "@/src/lib/storage";
import { scanOutputKey } from "@/src/lib/upload-scan-jobs";

export async function POST(request: Request) {
  const env = getServerEnv();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || !safeEqual(token, env.CRON_SECRET)) return noStoreJson({ error: "unauthorized" }, { status: 401 });
  const now = Date.now();
  const pendingCutoff = new Date(now - 60 * 60_000);
  const scanningCutoff = new Date(now - 15 * 60_000);
  const deletedCutoff = new Date(now - env.RESOURCE_DELETE_RETENTION_DAYS * 86400_000);
  const liveJob = getDatabase().select({ id: uploadScanJobs.resourceId }).from(uploadScanJobs).where(and(eq(uploadScanJobs.resourceId, resources.id), inArray(uploadScanJobs.status, ["queued", "processing"])));
  const eligible = and(isNull(resources.objectDeletedAt), or(
    and(eq(resources.status, "pending"), lt(resources.createdAt, pendingCutoff)),
    and(eq(resources.status, "scanning"), lt(resources.updatedAt, scanningCutoff), notExists(liveJob)),
    and(eq(resources.status, "deleted"), lt(resources.deletedAt, deletedCutoff)),
  ));
  const candidates = await getDatabase().select({ id: resources.id }).from(resources).where(eligible).limit(200);
  let cleaned = 0;
  for (const candidate of candidates) {
    try {
      cleaned += await getDatabase().transaction(async (tx) => {
        const [current] = await tx.select().from(resources).where(and(eq(resources.id, candidate.id), eligible)).for("update").limit(1);
        if (!current) return 0;
        await deleteObject(current.objectKey);
        await tx.update(resources).set({ objectDeletedAt: new Date(), ...(current.status === "pending" ? { status: "failed" as const, updatedAt: new Date() } : current.status === "scanning" ? { status: "quarantined" as const, moderationReason: "scan_timeout", updatedAt: new Date() } : {}) }).where(eq(resources.id, current.id));
        return 1;
      });
    } catch {
      // Leave the row eligible for a later retry.
    }
  }
  // Wait beyond URL expiry and worker leases before removing duplicate copies.
  const finishedJobs = await getDatabase().select({ job: uploadScanJobs, currentKey: resources.objectKey }).from(uploadScanJobs)
    .innerJoin(resources, eq(resources.id, uploadScanJobs.resourceId))
    .where(and(inArray(uploadScanJobs.status, ["done", "failed"]), isNull(uploadScanJobs.sourceDeletedAt), lt(uploadScanJobs.updatedAt, scanningCutoff))).limit(200);
  let artifactsCleaned = 0;
  for (const { job, currentKey } of finishedJobs) {
    try {
      for (const key of new Set([job.sourceKey, job.snapshotKey, scanOutputKey(job)])) {
        if (key !== currentKey) await deleteObject(key);
      }
      await getDatabase().update(uploadScanJobs).set({ sourceDeletedAt: new Date() }).where(eq(uploadScanJobs.resourceId, job.resourceId));
      artifactsCleaned += 1;
    } catch { /* Keep the job eligible for cleanup retry. */ }
  }
  const deletedTransactions = await getDatabase().delete(oauthLoginTransactions).where(lt(oauthLoginTransactions.expiresAt, new Date(now - 86400_000))).returning({ id: oauthLoginTransactions.id });
  const deletedSessions = await getDatabase().delete(sessions).where(lt(sessions.expiresAt, new Date(now - 7 * 86400_000))).returning({ id: sessions.id });
  return noStoreJson({ inspected: candidates.length, cleaned, artifactsCleaned, expiredTransactions: deletedTransactions.length, expiredSessions: deletedSessions.length });
}
