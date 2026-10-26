import { getCurrentUser } from "@/src/lib/auth/session";
import { getServerEnv } from "@/src/lib/env";
import { uploadIntentSchema } from "@/src/lib/files";
import { noStoreJson } from "@/src/lib/http";
import { createUploadIntent } from "@/src/lib/resources-write";
import { verifyBotChallenge } from "@/src/lib/security/bot";
import { enforceIpRateLimit, enforceUserRateLimit } from "@/src/lib/security/rate-limit";
import { getClientIp, requireSameOrigin } from "@/src/lib/security/request";
import { securityErrorResponse } from "@/src/lib/security/responses";

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return noStoreJson({ error: "forbidden" }, { status: 403 });
  const ip = getClientIp(request);
  try {
    const ipLimit = await enforceIpRateLimit("upload", ip);
    const user = await getCurrentUser();
    if (!user) return noStoreJson({ error: "unauthorized" }, { status: 401 });
    const userLimit = await enforceUserRateLimit("upload", user.id);
    const parsed = uploadIntentSchema.safeParse(await request.json());
    if (!parsed.success) return noStoreJson({ error: "invalid_upload", issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, { status: 400 });
    if (parsed.data.sizeBytes > getServerEnv().UPLOAD_MAX_BYTES) return noStoreJson({ error: "file_too_large" }, { status: 413 });
    await verifyBotChallenge({ required: ipLimit.risky || userLimit.risky, token: parsed.data.botToken, action: "upload", ip });
    try {
      return noStoreJson(await createUploadIntent({ user, ...parsed.data }), { status: 201 });
    } catch (error) {
      if (error instanceof Error && error.message === "file_type_not_allowed") return noStoreJson({ error: error.message }, { status: 415 });
      throw error;
    }
  } catch (error) {
    return securityErrorResponse(error) ?? noStoreJson({ error: "upload_unavailable" }, { status: 503 });
  }
}
