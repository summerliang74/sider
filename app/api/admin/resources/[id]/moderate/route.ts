import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { getDatabase } from "@/src/db";
import { auditLogs, resourceReports, resources } from "@/src/db/schema";
import { noStoreJson } from "@/src/lib/http";
import { requireSameOrigin } from "@/src/lib/security/request";
import { sanitizeAuditText } from "@/src/lib/audit";
import { authorizeAdminRequest } from "@/src/lib/security/admin";

const moderationSchema = z.object({
  action: z.enum(["hide", "restore", "remove"]),
  reason: z.string().trim().min(1).max(1000),
  reportId: z.uuid().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return noStoreJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorizeAdminRequest(request);
  if (authorization.response) return authorization.response;
  const user = authorization.user;
  const parsed = moderationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "invalid_action" }, { status: 400 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });
  const targetStatus = parsed.data.action === "hide" ? "hidden" : parsed.data.action === "restore" ? "active" : "deleted";
  const allowedSource = parsed.data.action === "hide" ? "active" : parsed.data.action === "restore" ? "hidden" : undefined;
  const reason = sanitizeAuditText(parsed.data.reason);
  const result = await getDatabase().transaction(async (tx) => {
    const condition = allowedSource
      ? and(eq(resources.id, id), eq(resources.status, allowedSource))
      : and(eq(resources.id, id), ne(resources.status, "deleted"), isNull(resources.deletedAt));
    const [updated] = await tx.update(resources).set({ status: targetStatus, moderationReason: reason, updatedAt: new Date(), ...(targetStatus === "deleted" ? { deletedAt: new Date() } : {}) }).where(condition).returning({ id: resources.id });
    if (!updated) return null;
    if (targetStatus === "deleted") {
      await tx.update(resourceReports).set({ status: "resolved", handledBy: user.id, handledAt: new Date(), resolutionNote: reason }).where(and(eq(resourceReports.resourceId, id), eq(resourceReports.status, "open")));
    } else if (parsed.data.reportId) {
      await tx.update(resourceReports).set({ status: "resolved", handledBy: user.id, handledAt: new Date(), resolutionNote: reason }).where(and(eq(resourceReports.id, parsed.data.reportId), eq(resourceReports.resourceId, id), eq(resourceReports.status, "open")));
    }
    await tx.insert(auditLogs).values({ actorId: user.id, action: `resource.${parsed.data.action}`, targetType: "resource", targetId: id, metadata: { reason, reportId: parsed.data.reportId ?? null } });
    return updated;
  });
  if (!result) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });
  return noStoreJson({ status: targetStatus });
}
