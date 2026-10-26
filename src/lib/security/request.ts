import "server-only";

import { isIP } from "node:net";

import { getServerEnv } from "@/src/lib/env";

export function getClientIp(request: Request): string {
  const value = request.headers.get(getServerEnv().TRUSTED_CLIENT_IP_HEADER)?.trim() ?? "";
  return isIP(value) ? value : "unknown";
}

export function requireSameOrigin(request: Request): boolean {
  const expected = new URL(getServerEnv().APP_BASE_URL).origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return origin === expected && (!fetchSite || fetchSite === "same-origin");
}
