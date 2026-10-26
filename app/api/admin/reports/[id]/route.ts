import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDatabase } from "@/src/db";
import { auditLogs, resourceReports } from "@/src/db/schema";
import { noStoreJson } from "@/src/lib/http";
import { requireSameOrigin } from "@/src/lib/security/request";
import { sanitizeAuditText } from "@/src/lib/audit";
import { authorizeAdminRequest } from "@/src/lib/security/admin";

const bodySchema = z.object({ note: z.string().trim().min(1).max(1000) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return noStoreJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorizeAdminRequest(request);
  if (authorization.response) return authorization.response;
  const user = authorization.user;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "invalid_action" }, { status: 400 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return noStoreJson({ error: "report_unavailable" }, { status: 404 });
  const result = await getDatabase().transaction(async (tx) => {
    const [report] = await tx.update(resourceReports).set({ status: "dismissed", handledBy: user.id, handledAt: new Date(), resolutionNote: parsed.data.note }).where(and(eq(resourceReports.id, id), eq(resourceReports.status, "open"))).returning({ id: resourceReports.id, resourceId: resourceReports.resourceId });
    if (!report) return null;
    await tx.insert(auditLogs).values({ actorId: user.id, action: "report.dismiss", targetType: "report", targetId: id, metadata: { resourceId: report.resourceId, note: sanitizeAuditText(parsed.data.note) } });
    return report;
  });
  if (!result) return noStoreJson({ error: "report_unavailable" }, { status: 404 });
  return noStoreJson({ status: "dismissed" });
}
