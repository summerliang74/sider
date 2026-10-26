import "server-only";

import type { CurrentUser } from "@/src/lib/auth/session";
import { getCurrentUser } from "@/src/lib/auth/session";
import { noStoreJson } from "@/src/lib/http";
import { enforceIpRateLimit, enforceUserRateLimit } from "./rate-limit";
import { getClientIp } from "./request";
import { securityErrorResponse } from "./responses";

export async function authorizeAdminRequest(request: Request): Promise<
  | { user: CurrentUser; response?: never }
  | { user?: never; response: Response }
> {
  try {
    await enforceIpRateLimit("admin", getClientIp(request));
    const user = await getCurrentUser();
    if (!user) return { response: noStoreJson({ error: "unauthorized" }, { status: 401 }) };
    await enforceUserRateLimit("admin", user.id);
    if (user.role !== "admin") return { response: noStoreJson({ error: "forbidden" }, { status: 403 }) };
    return { user };
  } catch (error) {
    return { response: securityErrorResponse(error) ?? noStoreJson({ error: "admin_unavailable" }, { status: 503 }) };
  }
}
