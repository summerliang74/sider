import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDatabase } from "@/src/db";
import { auditLogs, sessions, users } from "@/src/db/schema";
import { noStoreJson } from "@/src/lib/http";
import { requireSameOrigin } from "@/src/lib/security/request";
import { sanitizeAuditText } from "@/src/lib/audit";
import { authorizeAdminRequest } from "@/src/lib/security/admin";

const bodySchema = z.object({ reason: z.string().trim().min(1).max(1000) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return noStoreJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorizeAdminRequest(request);
  if (authorization.response) return authorization.response;
  const actor = authorization.user;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "invalid_action" }, { status: 400 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return noStoreJson({ error: "user_unavailable" }, { status: 404 });
  if (id === actor.id) return noStoreJson({ error: "cannot_suspend_self" }, { status: 409 });
  const updated = await getDatabase().transaction(async (tx) => {
    const [target] = await tx.update(users).set({ status: "suspended", updatedAt: new Date() }).where(and(eq(users.id, id), eq(users.status, "active"))).returning({ id: users.id });
    if (!target) return null;
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, id), isNull(sessions.revokedAt)));
    await tx.insert(auditLogs).values({ actorId: actor.id, action: "user.suspend", targetType: "user", targetId: id, metadata: { reason: sanitizeAuditText(parsed.data.reason) } });
    return target;
  });
  if (!updated) return noStoreJson({ error: "user_unavailable" }, { status: 404 });
  return noStoreJson({ status: "suspended" });
}
