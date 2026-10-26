import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDatabase } from "@/src/db";
import { oauthLoginTransactions } from "@/src/db/schema";
import { ORG_DISCOVERY_TTL_SECONDS, oauthCookieName, orgDiscoveryCookieName } from "@/src/lib/auth/constants";
import { isOrgDiscoveryEligible } from "@/src/lib/auth/discovery";
import { exchangeCode, launchpadBootstrapSchema } from "@/src/lib/auth/launchpad";
import { issueSession } from "@/src/lib/auth/session";
import { AdmissionError, admitAndUpsertUser } from "@/src/lib/auth/users";
import { openJson, safeEqual, sealJson, sha256 } from "@/src/lib/crypto";
import { getServerEnv } from "@/src/lib/env";
import { enforceIpRateLimit, RateLimitError, rateLimitResponse } from "@/src/lib/security/rate-limit";
import { getClientIp } from "@/src/lib/security/request";
import { recordMetric } from "@/src/lib/telemetry";

const transactionSchema = z.object({
  id: z.uuid(),
  state: z.string().min(32),
  nonce: z.string().min(32),
  verifier: z.string().min(43),
  returnTo: z.string().startsWith("/").refine((value) => !value.startsWith("//") && !value.includes("\\") && !/[\r\n]/.test(value)),
  bootstrap: launchpadBootstrapSchema,
  expiresAt: z.number(),
});

export async function GET(request: Request): Promise<NextResponse> {
  const env = getServerEnv();
  try {
    await enforceIpRateLimit("oauth_callback", getClientIp(request));
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    return NextResponse.redirect(new URL("/auth/error?reason=platform_unavailable", env.APP_BASE_URL));
  }
  const requestUrl = new URL(request.url);
  const cookieName = oauthCookieName(env.NODE_ENV === "production");
  const responseFor = (path: string) => {
    const response = NextResponse.redirect(new URL(path, env.APP_BASE_URL));
    response.headers.set("cache-control", "no-store");
    response.cookies.set(cookieName, "", {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  };

  if (requestUrl.searchParams.has("error")) {
    recordMetric("auth.cancelled");
    return responseFor("/auth/error?reason=cancelled");
  }

  const state = requestUrl.searchParams.get("state");
  const code = requestUrl.searchParams.get("code");
  const cookieStore = await cookies();
  const sealed = cookieStore.get(cookieName)?.value;
  if (!state || !code || !sealed || state.length > 512 || code.length > 4096 || sealed.length > 4096) {
    recordMetric("auth.invalid_callback");
    return responseFor("/auth/error?reason=invalid_state");
  }

  const transaction = openJson(sealed, env.SESSION_SECRET, transactionSchema);
  if (
    !transaction ||
    transaction.expiresAt <= Date.now() ||
    !safeEqual(transaction.state, state)
  ) {
    recordMetric("auth.invalid_state");
    return responseFor("/auth/error?reason=invalid_state");
  }

  try {
    const [claimed] = await getDatabase()
      .update(oauthLoginTransactions)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(oauthLoginTransactions.id, transaction.id),
          eq(oauthLoginTransactions.stateHash, sha256(state)),
          isNull(oauthLoginTransactions.consumedAt),
          gt(oauthLoginTransactions.expiresAt, new Date()),
        ),
      )
      .returning({ id: oauthLoginTransactions.id });
    if (!claimed) {
      recordMetric("auth.replayed_callback");
      return responseFor("/auth/error?reason=invalid_state");
    }

    const profile = await exchangeCode({
      bootstrap: transaction.bootstrap,
      code,
      verifier: transaction.verifier,
      nonce: transaction.nonce,
    });
    if (isOrgDiscoveryEligible(profile, env.orgDiscoveryEmail)) {
      const expiresAt = Date.now() + ORG_DISCOVERY_TTL_SECONDS * 1000;
      const response = responseFor("/auth/discovery");
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
    const response = responseFor(transaction.returnTo);
    await issueSession(response, userId);
    recordMetric("auth.succeeded");
    return response;
  } catch (error) {
    if (error instanceof AdmissionError) {
      recordMetric("auth.denied", { reason: error.code });
      const reason = error.code === "org_not_allowed" ? "org_not_allowed" : error.code;
      return responseFor(`/auth/error?reason=${reason}`);
    }
    recordMetric("auth.platform_error");
    return responseFor("/auth/error?reason=platform_unavailable");
  }
}
