import { and, eq } from "drizzle-orm";

import { getDatabase } from "@/src/db";
import { resources } from "@/src/db/schema";
import { getCurrentUser } from "@/src/lib/auth/session";
import { noStoreJson } from "@/src/lib/http";
import { enforceIpRateLimit, enforceUserRateLimit } from "@/src/lib/security/rate-limit";
import { getClientIp, requireSameOrigin } from "@/src/lib/security/request";
import { securityErrorResponse } from "@/src/lib/security/responses";
import { createDownloadUrl } from "@/src/lib/storage";
import { z } from "zod";
import { verifyBotChallenge } from "@/src/lib/security/bot";
import { recordMetric } from "@/src/lib/telemetry";

const bodySchema = z.object({ botToken: z.string().max(4096).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return noStoreJson({ error: "forbidden" }, { status: 403 });
  const ip = getClientIp(request);
  try {
    const ipLimit = await enforceIpRateLimit("download", ip);
    const user = await getCurrentUser();
    if (!user) return noStoreJson({ error: "unauthorized" }, { status: 401 });
    const userLimit = await enforceUserRateLimit("download", user.id);
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return noStoreJson({ error: "invalid_request" }, { status: 400 });
    await verifyBotChallenge({ required: ipLimit.risky || userLimit.risky, token: parsed.data.botToken, action: "download", ip });
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });
    const [resource] = await getDatabase().select({ objectKey: resources.objectKey, filename: resources.originalFilename, mimeType: resources.mimeType }).from(resources).where(and(eq(resources.id, id), eq(resources.status, "active"))).limit(1);
    if (!resource) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });
    const signed = await createDownloadUrl({ objectKey: resource.objectKey, filename: resource.filename, contentType: resource.mimeType });
    recordMetric("download.signed", { mimeType: resource.mimeType });
    return noStoreJson(signed);
  } catch (error) {
    return securityErrorResponse(error) ?? noStoreJson({ error: "download_unavailable" }, { status: 503 });
  }
}
