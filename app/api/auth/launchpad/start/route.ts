import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getDatabase } from "@/src/db";
import { oauthLoginTransactions } from "@/src/db/schema";
import { pkceChallenge, randomToken, sealJson, sha256 } from "@/src/lib/crypto";
import { getServerEnv } from "@/src/lib/env";
import { bootstrapLaunchpad } from "@/src/lib/auth/launchpad";
import {
  OAUTH_TRANSACTION_TTL_SECONDS,
  oauthCookieName,
} from "@/src/lib/auth/constants";
import { enforceIpRateLimit } from "@/src/lib/security/rate-limit";
import { getClientIp, requireSameOrigin } from "@/src/lib/security/request";
import { verifyBotChallenge } from "@/src/lib/security/bot";
import { securityErrorResponse } from "@/src/lib/security/responses";
import { recordMetric } from "@/src/lib/telemetry";

const returnToSchema = z.string().startsWith("/").max(500).refine((value) => !value.startsWith("//") && !value.includes("\\") && !/[\r\n]/.test(value));
const startBodySchema = z.object({ botToken: z.string().max(4096).optional(), returnTo: returnToSchema.default("/resources") });

async function start(request: Request, asJson: boolean): Promise<NextResponse> {
  const env = getServerEnv();
  if (env.AUTH_MODE !== "launchpad") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    const ip = getClientIp(request);
    const rate = await enforceIpRateLimit("oauth_start", ip);
    let botToken: string | undefined;
    let returnTo = "/resources";
    if (asJson) {
      if (!requireSameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
      const parsed = startBodySchema.safeParse(await request.json().catch(() => ({})));
      if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
      botToken = parsed.data.botToken;
      returnTo = parsed.data.returnTo;
    } else {
      const requestedReturnTo = new URL(request.url).searchParams.get("returnTo") ?? "/resources";
      returnTo = returnToSchema.safeParse(requestedReturnTo).data ?? "/resources";
    }
    await verifyBotChallenge({ required: rate.risky, token: botToken, action: "oauth_start", ip });
    const bootstrap = await bootstrapLaunchpad();
    const transaction = {
      id: randomUUID(),
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(48),
      returnTo,
      bootstrap,
      expiresAt: Date.now() + OAUTH_TRANSACTION_TTL_SECONDS * 1000,
    };
    const sealedTransaction = sealJson(transaction, env.SESSION_SECRET);
    if (sealedTransaction.length > 3800) throw new Error("OAuth transaction is too large");

    await getDatabase().insert(oauthLoginTransactions).values({
      id: transaction.id,
      stateHash: sha256(transaction.state),
      expiresAt: new Date(transaction.expiresAt),
    });

    const scope = Array.isArray(bootstrap.scopes) ? bootstrap.scopes.join(" ") : bootstrap.scopes;
    const authorizeUrl = new URL(bootstrap.authorization_endpoint);
    authorizeUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: bootstrap.client_id,
      redirect_uri: bootstrap.redirect_uri,
      scope,
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: pkceChallenge(transaction.verifier),
      code_challenge_method: "S256",
    }).toString();

    const response = asJson
      ? NextResponse.json({ redirectUrl: authorizeUrl.toString() })
      : NextResponse.redirect(authorizeUrl);
    response.headers.set("cache-control", "no-store");
    response.cookies.set(
      oauthCookieName(env.NODE_ENV === "production"),
      sealedTransaction,
      {
        httpOnly: true,
        secure: env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: OAUTH_TRANSACTION_TTL_SECONDS,
      },
    );
    recordMetric("auth.started");
    return response;
  } catch (error) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    return asJson
      ? NextResponse.json({ error: "platform_unavailable" }, { status: 503 })
      : NextResponse.redirect(new URL("/auth/error?reason=platform_unavailable", env.APP_BASE_URL));
  }
}

export function GET(request: Request): Promise<NextResponse> {
  return start(request, false);
}

export function POST(request: Request): Promise<NextResponse> {
  return start(request, true);
}
