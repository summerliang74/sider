import "server-only";

import { z } from "zod";

import { getServerEnv } from "@/src/lib/env";

export const launchpadBootstrapSchema = z.object({
  client_id: z.string().min(1).max(255),
  issuer: z.url().max(2048),
  authorization_endpoint: z.url().max(2048),
  token_endpoint: z.url().max(2048),
  userinfo_endpoint: z.url().max(2048),
  redirect_uri: z.url().max(2048),
  callback_path: z.string().min(1).max(255),
  scopes: z.union([z.array(z.string().max(100)).max(20), z.string().max(1000)]),
});

const tokenSchema = z.object({
  access_token: z.string().min(1).max(32_768),
  id_token: z.string().min(1).max(32_768),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

export const launchpadUserSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.email().max(320).nullish(),
  name: z.string().min(1).max(200).nullish(),
  picture: z.url().max(2048).nullish(),
  org: z.string().min(1).max(200),
  verified: z.boolean(),
  allows: z.record(z.string().max(100), z.unknown()).refine((value) => Object.keys(value).length <= 100).default({}),
});

export type LaunchpadUser = z.infer<typeof launchpadUserSchema>;
export type LaunchpadBootstrap = z.infer<typeof launchpadBootstrapSchema>;

export async function bootstrapLaunchpad(): Promise<LaunchpadBootstrap> {
  const env = getServerEnv();
  const endpoint = new URL("/dashboard-api/oauth/bootstrap", env.APP_BASE_URL);
  const body =
    env.NODE_ENV !== "production" && env.launchpadOidcDev === "1"
      ? JSON.stringify({ devOrigin: env.APP_BASE_URL })
      : undefined;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error(`Launchpad bootstrap failed (${response.status})`);
  const bootstrap = launchpadBootstrapSchema.parse(await response.json());
  if (env.NODE_ENV === "production") {
    for (const endpointUrl of [bootstrap.issuer, bootstrap.authorization_endpoint, bootstrap.token_endpoint, bootstrap.userinfo_endpoint]) {
      if (new URL(endpointUrl).protocol !== "https:") throw new Error("Launchpad returned a non-HTTPS endpoint");
    }
  }
  const expectedRedirect = new URL("/__lp_auth/callback", env.APP_BASE_URL).toString();
  if (bootstrap.redirect_uri !== expectedRedirect) {
    throw new Error("Launchpad returned an unexpected redirect URI");
  }
  const scopes = Array.isArray(bootstrap.scopes) ? bootstrap.scopes : bootstrap.scopes.split(/\s+/);
  for (const required of ["openid", "profile", "email", "allows"]) {
    if (!scopes.includes(required)) throw new Error("Launchpad omitted a required scope");
  }
  return bootstrap;
}

export async function exchangeCode(input: {
  bootstrap: LaunchpadBootstrap;
  code: string;
  verifier: string;
  nonce: string;
}): Promise<LaunchpadUser> {
  const tokenResponse = await fetch(input.bootstrap.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: input.bootstrap.client_id,
      redirect_uri: input.bootstrap.redirect_uri,
      code: input.code,
      code_verifier: input.verifier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`Launchpad token exchange failed (${tokenResponse.status})`);
  const token = tokenSchema.parse(await tokenResponse.json());

  assertNonceClaim(token.id_token, input.nonce);

  const userinfoResponse = await fetch(input.bootstrap.userinfo_endpoint, {
    headers: { authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!userinfoResponse.ok) throw new Error(`Launchpad userinfo failed (${userinfoResponse.status})`);
  return launchpadUserSchema.parse(await userinfoResponse.json());
}

function assertNonceClaim(idToken: string, expectedNonce: string): void {
  const [, payload] = idToken.split(".");
  if (!payload) throw new Error("Launchpad ID token is malformed");

  // Launchpad signs ID tokens with HS256 and intentionally publishes no verification key.
  // The payload is not trusted for identity; nonce is checked here only for flow binding.
  const claims = z.object({ nonce: z.string() }).parse(
    JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown,
  );
  if (claims.nonce !== expectedNonce) throw new Error("Launchpad nonce mismatch");
}
