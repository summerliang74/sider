import "server-only";

import { z } from "zod";
import { NextResponse } from "next/server";

import { hashOpaqueToken } from "@/src/lib/crypto";
import { getServerEnv } from "@/src/lib/env";
import { recordMetric } from "@/src/lib/telemetry";

export type RateOperation = "page" | "oauth_start" | "oauth_callback" | "search" | "upload" | "upload_transfer" | "upload_status" | "complete" | "download" | "resource_write" | "report" | "admin";

const limits: Record<RateOperation, { user?: number; ip: number; windowSeconds: number }> = {
  page: { ip: 600, windowSeconds: 60 },
  oauth_start: { ip: 300, windowSeconds: 600 },
  oauth_callback: { ip: 600, windowSeconds: 600 },
  search: { user: 60, ip: 120, windowSeconds: 60 },
  upload: { user: 10, ip: 30, windowSeconds: 3600 },
  upload_transfer: { user: 12, ip: 40, windowSeconds: 3600 },
  upload_status: { user: 30, ip: 240, windowSeconds: 60 },
  complete: { user: 20, ip: 60, windowSeconds: 3600 },
  download: { user: 120, ip: 300, windowSeconds: 3600 },
  resource_write: { user: 60, ip: 180, windowSeconds: 3600 },
  report: { user: 10, ip: 30, windowSeconds: 86400 },
  admin: { user: 120, ip: 300, windowSeconds: 3600 },
};

function policyFor(operation: RateOperation): { user?: number; ip: number; windowSeconds: number } {
  const env = getServerEnv();
  const base = limits[operation];
  const ipBase = operation === "oauth_start"
    ? env.OAUTH_START_IP_LIMIT
    : operation === "oauth_callback"
      ? env.OAUTH_CALLBACK_IP_LIMIT
      : base.ip;
  return {
    ip: Math.max(1, Math.floor(ipBase * env.RATE_LIMIT_MULTIPLIER)),
    user: base.user ? Math.max(1, Math.floor(base.user * env.RATE_LIMIT_MULTIPLIER)) : undefined,
    windowSeconds: base.windowSeconds,
  };
}

const redisResponseSchema = z.object({ result: z.unknown() });

export class RateLimitError extends Error {
  constructor(public readonly retryAfter: number) {
    super("rate_limited");
  }
}

export async function redisCommand(command: Array<string | number>): Promise<unknown> {
  const env = getServerEnv();
  const response = await fetch(env.RATE_LIMIT_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${env.RATE_LIMIT_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`rate_limit_store_${response.status}`);
  return redisResponseSchema.parse(await response.json()).result;
}

async function consume(key: string, limit: number, windowSeconds: number): Promise<{ risky: boolean }> {
  const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; local t=redis.call('TTL',KEYS[1]); return {n,t}";
  const result = await redisCommand(["EVAL", script, 1, key, windowSeconds]);
  if (!Array.isArray(result) || result.length < 2) throw new Error("invalid_rate_limit_response");
  const count = Number(result[0]);
  const ttl = Math.max(1, Number(result[1]) || windowSeconds);
  if (count > limit) {
    recordMetric("rate_limit.rejected", { operation: key.split(":")[2] ?? "unknown" });
    throw new RateLimitError(ttl);
  }
  return { risky: count >= Math.max(2, Math.ceil(limit * 0.8)) };
}

function privacyKey(kind: "ip" | "user", identity: string, operation: RateOperation): string {
  const env = getServerEnv();
  return `shsid:rl:${operation}:${kind}:${hashOpaqueToken(identity, env.SESSION_TOKEN_PEPPER)}`;
}

export async function enforceIpRateLimit(operation: RateOperation, ip: string): Promise<{ risky: boolean }> {
  const policy = policyFor(operation);
  return consume(privacyKey("ip", ip, operation), policy.ip, policy.windowSeconds);
}

export async function enforceUserRateLimit(operation: RateOperation, userId: string): Promise<{ risky: boolean }> {
  const policy = policyFor(operation);
  if (!policy.user) return { risky: false };
  return consume(privacyKey("user", userId, operation), policy.user, policy.windowSeconds);
}

export function rateLimitResponse(error: RateLimitError): NextResponse {
  return NextResponse.json(
    { error: "rate_limited", retryAfter: error.retryAfter },
    { status: 429, headers: { "retry-after": String(error.retryAfter), "cache-control": "no-store" } },
  );
}
