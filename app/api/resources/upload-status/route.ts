import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/src/db";
import { resources } from "@/src/db/schema";
import { noStoreJson } from "@/src/lib/http";
import { requireSameOrigin } from "@/src/lib/security/request";
import { authorizeUserRequest } from "@/src/lib/security/user";
import { recordMetric } from "@/src/lib/telemetry";

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return noStoreJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorizeUserRequest(request, "upload_status");
  if (authorization.response) return authorization.response;
  const parsed = z.object({ ids: z.array(z.uuid()).min(1).max(5) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "invalid_request" }, { status: 400 });
  try {
    const items = await getDatabase().select({ id: resources.id, status: resources.status }).from(resources)
      .where(and(eq(resources.authorId, authorization.user.id), inArray(resources.id, parsed.data.ids)));
    return noStoreJson({ items });
  } catch {
    recordMetric("upload.status_failed", {});
    return noStoreJson({ error: "status_unavailable" }, { status: 503 });
  }
}
