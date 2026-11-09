import "server-only";

import type { CurrentUser } from "@/src/lib/auth/session";
import { listActiveResources } from "@/src/lib/resources";
import { BotChallengeError, verifyBotChallenge } from "@/src/lib/security/bot";
import { enforceIpRateLimit, enforceUserRateLimit, RateLimitError } from "@/src/lib/security/rate-limit";
import { getClientIp } from "@/src/lib/security/request";
import { recordMetric } from "@/src/lib/telemetry";

type SearchRequest = { headers: Pick<Headers, "get"> };
type ResourceSearchInput = Parameters<typeof listActiveResources>[0];
type InitialSearchResult = Awaited<ReturnType<typeof listActiveResources>> & {
  error?: "bot_challenge_required" | "rate_limited" | "search_unavailable";
};

// Keep the coarse IP gate ahead of session work for API requests. Server
// rendering can reuse the page's verified user without a second session query.
export async function authorizeResourceSearch(request: SearchRequest, resolveUser: () => Promise<CurrentUser | null>) {
  const ip = getClientIp(request);
  const ipLimit = await enforceIpRateLimit("search", ip);
  const user = await resolveUser();
  if (!user) return null;
  const userLimit = await enforceUserRateLimit("search", user.id);
  await verifyBotChallenge({
    required: ipLimit.risky || userLimit.risky,
    token: request.headers.get("x-bot-token") ?? undefined,
    action: "search",
    ip,
  });
  return user;
}

export async function getInitialResourceSearch(
  input: ResourceSearchInput,
  user: CurrentUser,
  request: SearchRequest,
): Promise<InitialSearchResult> {
  try {
    // These searches previously ran through the browser API. Preserve its
    // limits and challenge checks when rendering their first page on the server.
    if (input.q || input.fileType) {
      await authorizeResourceSearch(request, async () => user);
    }
    const result = await listActiveResources(input);
    if (input.q || input.fileType) {
      recordMetric("search.completed", { hasQuery: input.q.length > 0, resultCount: result.items.length, hasNextPage: Boolean(result.nextCursor) });
    }
    return result;
  } catch (error) {
    const code = error instanceof BotChallengeError && error.reason === "required"
      ? "bot_challenge_required"
      : error instanceof RateLimitError ? "rate_limited" : "search_unavailable";
    recordMetric("search.initial_failed", { error: code });
    // Render a challenge/error directly, rather than automatically repeating a
    // rejected request during hydration and consuming another rate-limit slot.
    return { items: [], nextCursor: null, error: code };
  }
}
