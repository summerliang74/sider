import { NextResponse } from "next/server";
import { z } from "zod";

import { fetchLaunchpadUser, LaunchpadAccessTokenError } from "@/src/lib/auth/launchpad";
import { createSession } from "@/src/lib/auth/session";
import { AdmissionError, admitAndUpsertUser } from "@/src/lib/auth/users";
import { verifyBotChallenge } from "@/src/lib/security/bot";
import { enforceIpRateLimit } from "@/src/lib/security/rate-limit";
import { getClientIp, requireSameOrigin } from "@/src/lib/security/request";
import { securityErrorResponse } from "@/src/lib/security/responses";
import { recordMetric } from "@/src/lib/telemetry";

const returnToSchema = z.string().startsWith("/").max(500).refine(
  (value) => !value.startsWith("//") && !value.includes("\\") && !/[\r\n]/.test(value),
);
const bodySchema = z.object({
  accessToken: z.string().min(1).max(32_768),
  botToken: z.string().max(4096).optional(),
  returnTo: returnToSchema.default("/resources"),
});

export async function POST(request: Request): Promise<NextResponse> {
  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.startsWith("application/json");
  const errorResponse = (error: string, status: number) =>
    NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

  if (!requireSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  if (!isJson) {
    return NextResponse.json(
      { error: "unsupported_media_type" },
      { status: 415, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return errorResponse("invalid_request", 400);

    const ip = getClientIp(request);
    const rate = await enforceIpRateLimit("oauth_start", ip);
    await verifyBotChallenge({ required: rate.risky, token: parsed.data.botToken, action: "oauth_start", ip });

    const profile = await fetchLaunchpadUser(parsed.data.accessToken);
    const userId = await admitAndUpsertUser(profile);
    const session = await createSession(userId);
    const response = NextResponse.json(
      {
        accessToken: session.token,
        expiresAt: session.expiresAt.toISOString(),
        redirectUrl: parsed.data.returnTo,
      },
      { headers: { "cache-control": "no-store" } },
    );
    recordMetric("auth.succeeded");
    return response;
  } catch (error) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    if (error instanceof LaunchpadAccessTokenError && error.reason === "invalid") {
      recordMetric("auth.denied", { reason: "invalid_token" });
      return errorResponse("invalid_token", 401);
    }
    if (error instanceof LaunchpadAccessTokenError) {
      recordMetric("auth.platform_error", { reason: error.reason });
      return errorResponse("platform_unavailable", 503);
    }
    if (error instanceof AdmissionError) {
      recordMetric("auth.denied", { reason: error.code });
      return errorResponse(error.code, 403);
    }
    recordMetric("auth.platform_error");
    return errorResponse("platform_unavailable", 503);
  }
}
