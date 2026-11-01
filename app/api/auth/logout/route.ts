import { NextResponse } from "next/server";

import { revokeCurrentSession } from "@/src/lib/auth/session";
import { getServerEnv } from "@/src/lib/env";
import { getClientIp, requireSameOrigin } from "@/src/lib/security/request";
import { enforceIpRateLimit } from "@/src/lib/security/rate-limit";
import { securityErrorResponse } from "@/src/lib/security/responses";

export async function POST(request: Request): Promise<NextResponse> {
  const env = getServerEnv();
  if (!requireSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    await enforceIpRateLimit("resource_write", getClientIp(request));
  } catch (error) {
    return securityErrorResponse(error) ?? NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const response = NextResponse.redirect(new URL("/login", env.APP_BASE_URL), 303);
  await revokeCurrentSession(response, request);
  response.headers.set("cache-control", "no-store");
  return response;
}
