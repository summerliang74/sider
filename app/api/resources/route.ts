import { getCurrentUser } from "@/src/lib/auth/session";
import { noStoreJson } from "@/src/lib/http";
import { listActiveResources, resourceSearchSchema } from "@/src/lib/resources";
import { enforceIpRateLimit, enforceUserRateLimit } from "@/src/lib/security/rate-limit";
import { getClientIp } from "@/src/lib/security/request";
import { securityErrorResponse } from "@/src/lib/security/responses";
import { recordMetric } from "@/src/lib/telemetry";
import { verifyBotChallenge } from "@/src/lib/security/bot";
import { decodeResourceCursor } from "@/src/lib/resource-cursor";

export async function GET(request: Request) {
  try {
    const ip = getClientIp(request);
    const ipLimit = await enforceIpRateLimit("search", ip);
    const user = await getCurrentUser();
    if (!user) return noStoreJson({ error: "unauthorized" }, { status: 401 });
    const userLimit = await enforceUserRateLimit("search", user.id);
    await verifyBotChallenge({ required: ipLimit.risky || userLimit.risky, token: request.headers.get("x-bot-token") ?? undefined, action: "search", ip });

    const url = new URL(request.url);
    const parsed = resourceSearchSchema.safeParse({
      q: url.searchParams.get("q") ?? "",
      fileType: url.searchParams.get("type") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    if (!parsed.success) {
      return noStoreJson({ error: "invalid_query" }, { status: 400 });
    }
    if (parsed.data.cursor && !decodeResourceCursor(parsed.data.cursor)) {
      return noStoreJson({ error: "invalid_cursor" }, { status: 400 });
    }

    const result = await listActiveResources(parsed.data);
    recordMetric("search.completed", { hasQuery: parsed.data.q.length > 0, resultCount: result.items.length, hasNextPage: Boolean(result.nextCursor) });
    return noStoreJson({
      ...result,
      items: result.items.map((item) => ({
        ...item,
        publishedAt: item.publishedAt.toISOString(),
      })),
    });
  } catch (error) {
    return securityErrorResponse(error) ?? noStoreJson({ error: "search_unavailable" }, { status: 503 });
  }
}
