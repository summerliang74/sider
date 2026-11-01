import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";

import { getDatabase } from "@/src/db";
import { sessions, users } from "@/src/db/schema";
import { hashOpaqueToken, randomToken } from "@/src/lib/crypto";
import { getServerEnv } from "@/src/lib/env";
import { recordMetric } from "@/src/lib/telemetry";

import { sessionCookieName } from "./constants";
import { resolveIdentityRole } from "./role-policy";

export type CurrentUser = {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  org: string;
  role: "student" | "admin";
};

export type PreparedSession = {
  token: string;
  tokenHash: string;
  expiresAt: Date;
};

export function prepareSession(): PreparedSession {
  const env = getServerEnv();
  const token = randomToken();
  return {
    token,
    tokenHash: hashOpaqueToken(token, env.SESSION_TOKEN_PEPPER),
    expiresAt: new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000),
  };
}

export function setSessionCookie(response: NextResponse, session: PreparedSession): void {
  const env = getServerEnv();
  response.cookies.set(sessionCookieName(env.NODE_ENV === "production"), session.token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
    maxAge: env.SESSION_TTL_SECONDS,
  });
}

export async function createSession(userId: string): Promise<PreparedSession> {
  const session = prepareSession();
  await getDatabase().insert(sessions).values({ userId, tokenHash: session.tokenHash, expiresAt: session.expiresAt });
  return session;
}

export async function issueSession(response: NextResponse, userId: string): Promise<PreparedSession> {
  const session = await createSession(userId);
  setSessionCookie(response, session);
  return session;
}

async function getUserFromSessionToken(token: string): Promise<CurrentUser | null> {
  const env = getServerEnv();
  const tokenHash = hashOpaqueToken(token, env.SESSION_TOKEN_PEPPER);
  const [row] = await getDatabase()
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      avatarUrl: users.avatarUrl,
      org: users.org,
      role: users.role,
      launchpadSub: users.launchpadSub,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(users.status, "active"),
      ),
    )
    .limit(1);

  if (!row) {
    recordMetric("session.lookup_failed");
    return null;
  }
  const expectedRole = resolveIdentityRole({
    launchpadSub: row.launchpadSub,
    adminSubs: env.adminSubs,
  });
  if (row.role !== expectedRole) {
    await getDatabase().update(users).set({ role: expectedRole, updatedAt: new Date() }).where(eq(users.id, row.id));
    if (row.role === "admin" && expectedRole === "student") {
      await getDatabase().update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, row.id), isNull(sessions.revokedAt)));
      return null;
    }
  }
  recordMetric("session.authenticated");
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    avatarUrl: row.avatarUrl,
    org: row.org,
    role: expectedRole,
  };
}

function tokenFromHeaders(requestHeaders: Headers): string | undefined {
  const headerToken = requestHeaders.get("x-sider-session")?.trim();
  const authorization = requestHeaders.get("authorization") ?? "";
  const bearerMatch = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  const bearerToken = bearerMatch?.[1] && bearerMatch[1].length <= 4096 ? bearerMatch[1] : undefined;
  return headerToken && headerToken.length <= 4096 ? headerToken : bearerToken;
}

export async function getCurrentUser(request?: Request): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const env = getServerEnv();
  const cookieToken = cookieStore.get(sessionCookieName(env.NODE_ENV === "production"))?.value;
  const requestToken = tokenFromHeaders(request?.headers ?? await headers());
  const token = cookieToken ?? requestToken;
  if (!token) {
    recordMetric("session.credential_missing");
    return null;
  }
  return getUserFromSessionToken(token);
}

export async function revokeCurrentSession(response: NextResponse, request?: Request): Promise<void> {
  const env = getServerEnv();
  const cookieStore = await cookies();
  const cookieName = sessionCookieName(env.NODE_ENV === "production");
  const cookieToken = cookieStore.get(cookieName)?.value;
  const requestToken = tokenFromHeaders(request?.headers ?? await headers());
  const token = cookieToken ?? requestToken;

  if (token) {
    const tokenHash = hashOpaqueToken(token, env.SESSION_TOKEN_PEPPER);
    await getDatabase()
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
  }

  response.cookies.set(cookieName, "", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
