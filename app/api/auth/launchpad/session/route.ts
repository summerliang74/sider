import { NextResponse } from "next/server";
import { z } from "zod";

import { isOrgDiscoveryEligible } from "@/src/lib/auth/discovery";
import { fetchLaunchpadUser, LaunchpadAccessTokenError } from "@/src/lib/auth/launchpad";
import { ORG_DISCOVERY_TTL_SECONDS, orgDiscoveryCookieName } from "@/src/lib/auth/constants";
import { issueSession } from "@/src/lib/auth/session";
import { AdmissionError, admitAndUpsertUser } from "@/src/lib/auth/users";
import { sealJson } from "@/src/lib/crypto";
import { getServerEnv } from "@/src/lib/env";
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
  const env = getServerEnv();
  if (env.AUTH_MODE !== "launchpad") {
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
    await verifyBotChallenge({ required: rate.risky, token: parsed.data.botToken, action: "oauth_start", ip });

    const profile = await fetchLaunchpadUser(parsed.data.accessToken);
    if (isOrgDiscoveryEligible(profile, env.orgDiscoveryEmail)) {
      const expiresAt = Date.now() + ORG_DISCOVERY_TTL_SECONDS * 1000;
      const response = NextResponse.json({ redirectUrl: "/auth/discovery" });
      response.headers.set("cache-control", "no-store");
      response.cookies.set(
        orgDiscoveryCookieName(env.NODE_ENV === "production"),
        sealJson({ sub: profile.sub, email: profile.email, org: profile.org, expiresAt }, env.SESSION_SECRET),
        {
          httpOnly: true,
          secure: env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          expires: new Date(expiresAt),
        },
      );
      recordMetric("auth.org_discovery");
      return response;
    }

    const userId = await admitAndUpsertUser(profile);
    const response = NextResponse.json({ redirectUrl: parsed.data.returnTo });
    response.headers.set("cache-control", "no-store");
    await issueSession(response, userId);
    recordMetric("auth.succeeded");
    return response;
  } catch (error) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    if (error instanceof LaunchpadAccessTokenError && error.reason === "invalid") {
      recordMetric("auth.denied", { reason: "invalid_token" });
      return NextResponse.json(
        { error: "invalid_token" },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    }
    if (error instanceof LaunchpadAccessTokenError) {
      recordMetric("auth.platform_error", { reason: error.reason });
      return NextResponse.json(
        { error: "platform_unavailable" },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    if (error instanceof AdmissionError) {
      recordMetric("auth.denied", { reason: error.code });
      return NextResponse.json(
        { error: error.code },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }
    recordMetric("auth.platform_error");
    return NextResponse.json(
      { error: "platform_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
