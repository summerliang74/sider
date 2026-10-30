import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDatabase } from "@/src/db";
import { resources } from "@/src/db/schema";
import { getCurrentUser } from "@/src/lib/auth/session";
import { getFilePreviewKind } from "@/src/lib/file-preview";
import { noStoreJson } from "@/src/lib/http";
import { verifyBotChallenge } from "@/src/lib/security/bot";
import { enforceIpRateLimit, enforceUserRateLimit } from "@/src/lib/security/rate-limit";
import { getClientIp, requireSameOrigin } from "@/src/lib/security/request";
import { securityErrorResponse } from "@/src/lib/security/responses";
import { getObjectPreview } from "@/src/lib/storage";
import { recordMetric } from "@/src/lib/telemetry";

const bodySchema = z.object({ botToken: z.string().max(4096).optional() });

function inlineDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return noStoreJson({ error: "forbidden" }, { status: 403 });
  const ip = getClientIp(request);
  try {
    const [ipLimit, user, parsed, params] = await Promise.all([
      enforceIpRateLimit("download", ip),
      getCurrentUser(),
      request.json().catch(() => ({})).then((body) => bodySchema.safeParse(body)),
      context.params,
    ]);
    if (!user) return noStoreJson({ error: "unauthorized" }, { status: 401 });
    if (!parsed.success) return noStoreJson({ error: "invalid_request" }, { status: 400 });
    const { id } = params;
    if (!z.uuid().safeParse(id).success) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });

    const [userLimit, resourceRows] = await Promise.all([
      enforceUserRateLimit("download", user.id),
      getDatabase()
        .select({
          objectKey: resources.objectKey,
          filename: resources.originalFilename,
          mimeType: resources.mimeType,
          sizeBytes: resources.sizeBytes,
        })
        .from(resources)
        .where(and(eq(resources.id, id), eq(resources.status, "active")))
        .limit(1),
    ]);
    await verifyBotChallenge({
      required: ipLimit.risky || userLimit.risky,
      token: parsed.data.botToken,
      action: "download",
      ip,
    });

    const [resource] = resourceRows;
    if (!resource) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });
    if (!getFilePreviewKind(resource.mimeType, resource.sizeBytes)) {
      return noStoreJson({ error: "preview_unavailable" }, { status: 415 });
    }

    const object = await getObjectPreview(resource.objectKey);
    recordMetric("preview.streamed", { mimeType: resource.mimeType });
    return new Response(object.body, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": inlineDisposition(resource.filename),
        "content-length": String(object.contentLength ?? resource.sizeBytes),
        "content-type": resource.mimeType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return securityErrorResponse(error) ?? noStoreJson({ error: "preview_unavailable" }, { status: 503 });
  }
}
