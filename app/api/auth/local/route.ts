import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateLocalUser } from "@/src/lib/auth/local";
import { issueSession } from "@/src/lib/auth/session";
import { getServerEnv } from "@/src/lib/env";
import { verifyBotChallenge } from "@/src/lib/security/bot";
import { enforceIpRateLimit } from "@/src/lib/security/rate-limit";
import { getClientIp, requireSameOrigin } from "@/src/lib/security/request";
import { securityErrorResponse } from "@/src/lib/security/responses";
import { recordMetric } from "@/src/lib/telemetry";

const bodySchema = z.object({
  username: z.string().max(64),
  password: z.string().max(1024),
  botToken: z.string().max(4096).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const env = getServerEnv();
  if (env.AUTH_MODE !== "local") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!requireSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

    const ip = getClientIp(request);
    const rate = await enforceIpRateLimit("oauth_start", ip);
    await verifyBotChallenge({ required: rate.risky, token: parsed.data.botToken, action: "local_login", ip });

    const userId = await authenticateLocalUser(parsed.data.username, parsed.data.password);
    if (!userId) {
      recordMetric("auth.denied", { reason: "invalid_credentials" });
      return NextResponse.json(
        { error: "invalid_credentials" },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    }

    const response = NextResponse.json({ redirectUrl: "/resources" });
    response.headers.set("cache-control", "no-store");
    await issueSession(response, userId);
    recordMetric("auth.succeeded");
    return response;
  } catch (error) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    recordMetric("auth.platform_error");
    return NextResponse.json(
      { error: "service_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
