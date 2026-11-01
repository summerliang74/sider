import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDatabase } from "@/src/db";
import { resourceReports, resources } from "@/src/db/schema";
import { getCurrentUser } from "@/src/lib/auth/session";
import { noStoreJson } from "@/src/lib/http";
import { verifyBotChallenge } from "@/src/lib/security/bot";
import { enforceIpRateLimit, enforceUserRateLimit } from "@/src/lib/security/rate-limit";
import { getClientIp, requireSameOrigin } from "@/src/lib/security/request";
import { securityErrorResponse } from "@/src/lib/security/responses";

const reportSchema = z.object({
  reason: z.enum(["copyright_privacy", "malware", "inappropriate", "spam", "other"]),
  details: z.string().trim().max(1000).default(""),
  botToken: z.string().max(4096).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return noStoreJson({ error: "forbidden" }, { status: 403 });
  const ip = getClientIp(request);
  try {
    const ipLimit = await enforceIpRateLimit("report", ip);
    const user = await getCurrentUser(request);
    if (!user) return noStoreJson({ error: "unauthorized" }, { status: 401 });
    const userLimit = await enforceUserRateLimit("report", user.id);
    const parsed = reportSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return noStoreJson({ error: "invalid_report" }, { status: 400 });
    await verifyBotChallenge({ required: ipLimit.risky || userLimit.risky, token: parsed.data.botToken, action: "report", ip });
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });
    const [resource] = await getDatabase().select({ id: resources.id, authorId: resources.authorId }).from(resources).where(and(eq(resources.id, id), eq(resources.status, "active"))).limit(1);
    if (!resource || resource.authorId === user.id) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });
    try {
      const [report] = await getDatabase().insert(resourceReports).values({ resourceId: id, reporterId: user.id, reason: parsed.data.reason, details: parsed.data.details }).returning({ id: resourceReports.id });
      return noStoreJson({ report }, { status: 201 });
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "23505") return noStoreJson({ error: "report_already_open" }, { status: 409 });
      throw error;
    }
  } catch (error) {
    return securityErrorResponse(error) ?? noStoreJson({ error: "report_unavailable" }, { status: 503 });
  }
}
