import { NextRequest, NextResponse } from "next/server";

import { enforceIpRateLimit, RateLimitError, rateLimitResponse } from "@/src/lib/security/rate-limit";
import { getClientIp } from "@/src/lib/security/request";

export async function proxy(request: NextRequest) {
  try {
    await enforceIpRateLimit("page", getClientIp(request));
    return NextResponse.next();
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    return NextResponse.json({ error: "service_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export const config = {
  matcher: ["/login", "/auth/discovery", "/resources/:path*", "/me/:path*", "/admin/:path*"],
};
