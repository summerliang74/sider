import { z } from "zod";

import { getCurrentUser } from "@/src/lib/auth/session";
import { getServerEnv } from "@/src/lib/env";
import { noStoreJson } from "@/src/lib/http";
import { completeUpload } from "@/src/lib/resources-write";
import { verifyBotChallenge } from "@/src/lib/security/bot";
import { enforceIpRateLimit, enforceUserRateLimit } from "@/src/lib/security/rate-limit";
import { getClientIp, requireSameOrigin } from "@/src/lib/security/request";
import { securityErrorResponse } from "@/src/lib/security/responses";
import { recordMetric } from "@/src/lib/telemetry";

const bodySchema = z.object({ botToken: z.string().max(4096).optional() });

export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const started = performance.now();
  if (!requireSameOrigin(request)) return noStoreJson({ error: "forbidden" }, { status: 403 });
  if (!getServerEnv().malwareScanEnabled) return noStoreJson({ error: "uploads_disabled" }, { status: 503 });
  const ip = getClientIp(request);
  try {
    const ipLimit = await enforceIpRateLimit("complete", ip);
    const user = await getCurrentUser(request);
    if (!user) return noStoreJson({ error: "unauthorized" }, { status: 401 });
    const userLimit = await enforceUserRateLimit("complete", user.id);
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return noStoreJson({ error: "invalid_request" }, { status: 400 });
    await verifyBotChallenge({ required: ipLimit.risky || userLimit.risky, token: parsed.data.botToken, action: "complete", ip });
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });
    try {
      const result = await completeUpload(id, user);
      if (!result) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });
      return noStoreJson(result, { status: result.status === "scanning" ? 202 : 200 });
    } catch (error) {
      if (error instanceof Error && ["object_missing", "object_mismatch", "upload_expired"].includes(error.message)) return noStoreJson({ error: error.message }, { status: 409 });
      throw error;
    }
  } catch (error) {
    recordMetric("upload.completion_failed", { durationMs: Math.round(performance.now() - started) });
    return securityErrorResponse(error) ?? noStoreJson({ error: "completion_unavailable" }, { status: 503 });
  }
}
