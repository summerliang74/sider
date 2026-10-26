import "server-only";

import type { CurrentUser } from "@/src/lib/auth/session";
import { getCurrentUser } from "@/src/lib/auth/session";
import { noStoreJson } from "@/src/lib/http";
import { enforceIpRateLimit, enforceUserRateLimit, type RateOperation } from "./rate-limit";
import { getClientIp } from "./request";
import { securityErrorResponse } from "./responses";

export async function authorizeUserRequest(request: Request, operation: RateOperation): Promise<
  | { user: CurrentUser; risky: boolean; response?: never }
  | { user?: never; risky?: never; response: Response }
> {
  try {
    const ip = await enforceIpRateLimit(operation, getClientIp(request));
    const user = await getCurrentUser();
    if (!user) return { response: noStoreJson({ error: "unauthorized" }, { status: 401 }) };
    const userLimit = await enforceUserRateLimit(operation, user.id);
    return { user, risky: ip.risky || userLimit.risky };
  } catch (error) {
    return { response: securityErrorResponse(error) ?? noStoreJson({ error: "service_unavailable" }, { status: 503 }) };
  }
}
