import { z } from "zod";

import { getCurrentUser } from "@/src/lib/auth/session";
import { getServerEnv } from "@/src/lib/env";
import { noStoreJson } from "@/src/lib/http";
import { uploadPendingResource } from "@/src/lib/resources-write";
import { enforceIpRateLimit, enforceUserRateLimit } from "@/src/lib/security/rate-limit";
import { getClientIp, requireSameOrigin } from "@/src/lib/security/request";
import { securityErrorResponse } from "@/src/lib/security/responses";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return noStoreJson({ error: "forbidden" }, { status: 403 });
  if (!getServerEnv().malwareScanEnabled) return noStoreJson({ error: "uploads_disabled" }, { status: 503 });
  try {
    const ip = getClientIp(request);
    await enforceIpRateLimit("upload_transfer", ip);
    const user = await getCurrentUser();
    if (!user) return noStoreJson({ error: "unauthorized" }, { status: 401 });
    await enforceUserRateLimit("upload_transfer", user.id);
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });
    const contentType = request.headers.get("content-type")?.trim() ?? "";
    const contentLength = Number(request.headers.get("content-length"));
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > getServerEnv().UPLOAD_MAX_BYTES) {
      return noStoreJson({ error: "invalid_upload" }, { status: 400 });
    }
    if (!request.body) return noStoreJson({ error: "invalid_upload" }, { status: 400 });

    const result = await uploadPendingResource({ resourceId: id, user, contentType, contentLength, body: request.body });
    if (!result) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });
    if (result === "mismatch") return noStoreJson({ error: "object_mismatch" }, { status: 409 });
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return securityErrorResponse(error) ?? noStoreJson({ error: "upload_unavailable" }, { status: 503 });
  }
}
