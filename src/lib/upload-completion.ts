import "server-only";

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/src/db";
import { resources, uploadScanJobs } from "@/src/db/schema";
import type { CurrentUser } from "@/src/lib/auth/session";
import { uploadedObjectMatches } from "@/src/lib/files";
import { copyObject, deleteObject, headObject } from "@/src/lib/storage";
import { recordMetric } from "@/src/lib/telemetry";

export async function enqueueUploadScan(resourceId: string, user: CurrentUser) {
  const started = performance.now();
  const db = getDatabase();
  const [resource] = await db.select().from(resources)
    .where(and(eq(resources.id, resourceId), eq(resources.authorId, user.id))).limit(1);
  if (!resource) return null;
  if (resource.status !== "pending") return { id: resource.id, status: resource.status };
  if (Date.now() - resource.createdAt.getTime() > 60 * 60_000) throw new Error("upload_expired");

  // Transient storage errors leave the intent retryable. Never publish on error.
  const head = await headObject(resource.objectKey);
  if (!uploadedObjectMatches(resource, head) || !head.etag) throw new Error("object_mismatch");
  const snapshotKey = `pending/${resource.id}/snapshot-${randomBytes(24).toString("hex")}`;
  await copyObject(resource.objectKey, snapshotKey, head.etag);
  const snapshot = await headObject(snapshotKey);
  if (!uploadedObjectMatches(resource, snapshot)) {
    await deleteObject(snapshotKey).catch(() => undefined);
    throw new Error("object_mismatch");
  }
  // On an uncertain DB commit, keep the snapshot: deleting it might destroy a
  // committed job's input. Lifecycle cleanup handles unreferenced snapshots.
  const accepted = await db.transaction(async (tx) => {
    const [updated] = await tx.update(resources)
      .set({ status: "scanning", objectKey: snapshotKey, updatedAt: new Date() })
      .where(and(eq(resources.id, resource.id), eq(resources.status, "pending")))
      .returning({ id: resources.id });
    if (!updated) return false;
    await tx.insert(uploadScanJobs).values({ resourceId: resource.id, sourceKey: resource.objectKey, snapshotKey });
    return true;
  });
  if (!accepted) await deleteObject(snapshotKey).catch(() => undefined);
  const [current] = await db.select({ id: resources.id, status: resources.status }).from(resources)
    .where(eq(resources.id, resource.id)).limit(1);
  recordMetric("upload.completion", { outcome: accepted ? "queued" : "duplicate", durationMs: Math.round(performance.now() - started), elapsedSinceIntentMs: Date.now() - resource.createdAt.getTime(), sizeBytes: resource.sizeBytes });
  return current ?? null;
}
