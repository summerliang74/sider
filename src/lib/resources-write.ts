import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { getDatabase } from "@/src/db";
import { auditLogs, resources } from "@/src/db/schema";
import type { CurrentUser } from "@/src/lib/auth/session";
import { normalizeTags, sanitizeFilename, validateDeclaredFile } from "@/src/lib/files";
import { canAssignTags } from "@/src/lib/resource-tags";
import { enqueueUploadScan } from "@/src/lib/upload-completion";
import { createUploadUrl, uploadObject } from "@/src/lib/storage";
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
  if (!canAssignTags(input.user.role, input.tags)) throw new Error("pa_tag_admin_only");
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
  recordMetric("upload.intent_created", { mimeType: input.mimeType, sizeBytes: input.sizeBytes });
  const signed = await createUploadUrl({ objectKey, resourceId: id, mimeType: input.mimeType, sizeBytes: input.sizeBytes });
  return { resourceId: id, uploadUrl: signed.url, expiresIn: signed.expiresIn, headers: signed.headers };
}

export async function uploadPendingResource(input: {
  resourceId: string;
  user: CurrentUser;
  contentType: string;
  contentLength: number;
  body: ReadableStream<Uint8Array>;
}): Promise<"uploaded" | "mismatch" | null> {
  const [resource] = await getDatabase()
    .select({
      id: resources.id,
      objectKey: resources.objectKey,
      mimeType: resources.mimeType,
      sizeBytes: resources.sizeBytes,
    })
    .from(resources)
    .where(and(
      eq(resources.id, input.resourceId),
      eq(resources.authorId, input.user.id),
      eq(resources.status, "pending"),
      gt(resources.createdAt, new Date(Date.now() - 5 * 60 * 1000)),
    ))
    .limit(1);
  if (!resource) return null;
  if (resource.mimeType !== input.contentType || resource.sizeBytes !== input.contentLength) return "mismatch";
  await uploadObject({
    objectKey: resource.objectKey,
    contentType: resource.mimeType,
    contentLength: resource.sizeBytes,
    resourceId: resource.id,
    body: input.body,
  });
  recordMetric("upload.object_stored", { mimeType: resource.mimeType, sizeBytes: resource.sizeBytes });
  return "uploaded";
}

export const completeUpload = enqueueUploadScan;

export async function updateResourceMetadata(
  id: string,
  user: CurrentUser,
  metadata: { title: string; description: string; tags: string[] },
) {
  if (!canAssignTags(user.role, metadata.tags)) throw new Error("pa_tag_admin_only");
  const ownerFilter = user.role === "admin" ? eq(resources.id, id) : and(eq(resources.id, id), eq(resources.authorId, user.id));
  return getDatabase().transaction(async (tx) => {
    const [updated] = await tx
      .update(resources)
      .set({ ...metadata, tags: normalizeTags(metadata.tags), updatedAt: new Date() })
      .where(and(ownerFilter, inArray(resources.status, ["pending", "scanning", "active", "hidden", "quarantined", "failed"])))
      .returning({ id: resources.id, status: resources.status });
    if (!updated) return null;
    await tx.insert(auditLogs).values({
      actorId: user.id,
      action: "resource.metadata_update",
      targetType: "resource",
      targetId: id,
      metadata: { actorRole: user.role, changedFields: "title,description,tags" },
    });
    return updated;
  });
}

export async function softDeleteResource(id: string, user: CurrentUser) {
  return getDatabase().transaction(async (tx) => {
    const [deleted] = await tx
      .update(resources)
      .set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(resources.id, id), eq(resources.authorId, user.id), isNull(resources.deletedAt), sql`${resources.status} <> 'deleted'`))
      .returning({ id: resources.id });
    if (!deleted) return null;
    await tx.insert(auditLogs).values({ actorId: user.id, action: "resource.delete", targetType: "resource", targetId: id, metadata: {} });
    return deleted;
  });
}
