import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDatabase } from "@/src/db";
import { auditLogs, resources } from "@/src/db/schema";
import type { CurrentUser } from "@/src/lib/auth/session";
import { normalizeTags, sanitizeFilename, uploadedObjectMatches, validateDeclaredFile, validateDetectedFile } from "@/src/lib/files";
import { scanObject } from "@/src/lib/scanner";
import { createUploadUrl, deleteObject, headObject, moveObject } from "@/src/lib/storage";
import { recordMetric } from "@/src/lib/telemetry";

export async function createUploadIntent(input: {
  user: CurrentUser;
  title: string;
  description: string;
  tags: string[];
  originalFilename: string;
  sizeBytes: number;
  mimeType: string;
}) {
  const id = randomUUID();
  const filename = sanitizeFilename(input.originalFilename);
  if (!validateDeclaredFile(filename, input.mimeType)) throw new Error("file_type_not_allowed");
  const objectKey = `pending/${id}/${randomBytes(24).toString("hex")}`;
  await getDatabase().insert(resources).values({
    id,
    authorId: input.user.id,
    title: input.title,
    description: input.description,
    tags: normalizeTags(input.tags),
    originalFilename: filename,
    objectKey,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    status: "pending",
  });
  try {
    const signed = await createUploadUrl({
      objectKey,
      contentType: input.mimeType,
      contentLength: input.sizeBytes,
      resourceId: id,
    });
    recordMetric("upload.intent_created", { mimeType: input.mimeType, sizeBytes: input.sizeBytes });
    return {
      resourceId: id,
      uploadUrl: signed.url,
      expiresIn: signed.expiresIn,
      headers: { "content-type": input.mimeType, "x-amz-meta-resource": id },
    };
  } catch (error) {
    await getDatabase().update(resources).set({ status: "failed", updatedAt: new Date() }).where(eq(resources.id, id));
    throw error;
  }
}

export async function completeUpload(resourceId: string, user: CurrentUser) {
  const [resource] = await getDatabase()
    .select()
    .from(resources)
    .where(and(eq(resources.id, resourceId), eq(resources.authorId, user.id)))
    .limit(1);
  if (!resource) return null;
  if (resource.status !== "pending") return { id: resource.id, status: resource.status };

  let head: Awaited<ReturnType<typeof headObject>>;
  try {
    head = await headObject(resource.objectKey);
  } catch {
    await getDatabase().update(resources).set({ status: "failed", updatedAt: new Date() }).where(and(eq(resources.id, resource.id), eq(resources.status, "pending")));
    throw new Error("object_missing");
  }
  if (!uploadedObjectMatches(resource, head)) {
    await getDatabase().update(resources).set({ status: "failed", updatedAt: new Date() }).where(and(eq(resources.id, resource.id), eq(resources.status, "pending")));
    throw new Error("object_mismatch");
  }

  const [claimed] = await getDatabase()
    .update(resources)
    .set({ status: "scanning", updatedAt: new Date() })
    .where(and(eq(resources.id, resource.id), eq(resources.status, "pending")))
    .returning({ id: resources.id });
  if (!claimed) {
    const [current] = await getDatabase().select({ id: resources.id, status: resources.status }).from(resources).where(eq(resources.id, resource.id)).limit(1);
    return current ?? null;
  }

  let scan: Awaited<ReturnType<typeof scanObject>>;
  try {
    scan = await scanObject({ resourceId: resource.id, objectKey: resource.objectKey });
  } catch {
    scan = { status: "error", message: "scanner_unavailable" };
  }
  if (scan.status !== "clean" || !validateDetectedFile(resource.originalFilename, scan.detectedMimeType)) {
    const reason = scan.status === "infected" ? "malware_detected" : scan.status === "error" ? "scan_failed" : "file_type_mismatch";
    const quarantineKey = `quarantine/${resource.id}/${randomBytes(24).toString("hex")}`;
    let storedKey = resource.objectKey;
    try {
      await moveObject(resource.objectKey, quarantineKey);
      storedKey = quarantineKey;
    } catch {
      // Keep the staging key; the resource remains unavailable regardless.
    }
    const [quarantined] = await getDatabase().update(resources).set({ status: "quarantined", objectKey: storedKey, moderationReason: reason, updatedAt: new Date() }).where(and(eq(resources.id, resource.id), eq(resources.status, "scanning"))).returning({ id: resources.id });
    recordMetric("upload.scan_finished", { outcome: reason });
    if (!quarantined) {
      if (storedKey === quarantineKey) await deleteObject(quarantineKey).catch(() => undefined);
      const [current] = await getDatabase().select({ id: resources.id, status: resources.status }).from(resources).where(eq(resources.id, resource.id)).limit(1);
      return current ?? null;
    }
    return { id: resource.id, status: "quarantined" as const };
  }

  const activeKey = `active/${resource.id}/${randomBytes(24).toString("hex")}`;
  try {
    await moveObject(resource.objectKey, activeKey);
  } catch {
    await getDatabase().update(resources).set({ status: "quarantined", moderationReason: "storage_promotion_failed", updatedAt: new Date() }).where(and(eq(resources.id, resource.id), eq(resources.status, "scanning")));
    recordMetric("upload.scan_finished", { outcome: "storage_promotion_failed" });
    return { id: resource.id, status: "quarantined" as const };
  }
  let activated: { id: string } | undefined;
  try {
    [activated] = await getDatabase()
      .update(resources)
      .set({ status: "active", objectKey: activeKey, mimeType: scan.detectedMimeType, sha256: scan.sha256, publishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(resources.id, resource.id), eq(resources.status, "scanning")))
      .returning({ id: resources.id });
  } catch (error) {
    await deleteObject(activeKey).catch(() => undefined);
    throw error;
  }
  if (!activated) {
    await deleteObject(activeKey).catch(() => undefined);
    const [current] = await getDatabase().select({ id: resources.id, status: resources.status }).from(resources).where(eq(resources.id, resource.id)).limit(1);
    return current ?? null;
  }
  recordMetric("upload.scan_finished", { outcome: "active", mimeType: scan.detectedMimeType });
  return { id: resource.id, status: "active" as const };
}

export async function updateResourceMetadata(
  id: string,
  user: CurrentUser,
  metadata: { title: string; description: string; tags: string[] },
) {
  const ownerFilter = user.role === "admin" ? eq(resources.id, id) : and(eq(resources.id, id), eq(resources.authorId, user.id));
  const [updated] = await getDatabase()
    .update(resources)
    .set({ ...metadata, tags: normalizeTags(metadata.tags), updatedAt: new Date() })
    .where(and(ownerFilter, inArray(resources.status, ["pending", "scanning", "active", "hidden", "quarantined", "failed"])))
    .returning({ id: resources.id, status: resources.status });
  return updated ?? null;
}

export async function softDeleteResource(id: string, user: CurrentUser) {
  const ownerFilter = user.role === "admin" ? eq(resources.id, id) : and(eq(resources.id, id), eq(resources.authorId, user.id));
  return getDatabase().transaction(async (tx) => {
    const [deleted] = await tx
      .update(resources)
      .set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() })
      .where(and(ownerFilter, isNull(resources.deletedAt), sql`${resources.status} <> 'deleted'`))
      .returning({ id: resources.id });
    if (!deleted) return null;
    await tx.insert(auditLogs).values({ actorId: user.id, action: "resource.delete", targetType: "resource", targetId: id, metadata: {} });
    return deleted;
  });
}
