import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import { getDatabase } from "@/src/db";
import { sessions, users } from "@/src/db/schema";
import { hashOpaqueToken, randomToken } from "@/src/lib/crypto";
import { getServerEnv } from "@/src/lib/env";

import { sessionCookieName } from "./constants";

export type CurrentUser = {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  org: string;
  role: "student" | "admin";
};

export async function issueSession(response: NextResponse, userId: string): Promise<void> {
  const env = getServerEnv();
  const token = randomToken();
  const tokenHash = hashOpaqueToken(token, env.SESSION_TOKEN_PEPPER);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000);

  await getDatabase().insert(sessions).values({ userId, tokenHash, expiresAt });
  response.cookies.set(sessionCookieName(env.NODE_ENV === "production"), token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const env = getServerEnv();
  const token = cookieStore.get(sessionCookieName(env.NODE_ENV === "production"))?.value;
  if (!token) return null;

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

  if (!row) return null;
  const expectedRole = (
    (env.AUTH_MODE !== "launchpad" && row.launchpadSub === env.localAuthSub) ||
    env.adminSubs.includes(row.launchpadSub)
  ) ? "admin" : "student";
  if (row.role !== expectedRole) {
    await getDatabase().update(users).set({ role: expectedRole, updatedAt: new Date() }).where(eq(users.id, row.id));
    if (row.role === "admin" && expectedRole === "student") {
      await getDatabase().update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, row.id), isNull(sessions.revokedAt)));
      return null;
    }
  }
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    avatarUrl: row.avatarUrl,
    org: row.org,
    role: expectedRole,
  };
}

export async function revokeCurrentSession(response: NextResponse): Promise<void> {
  const env = getServerEnv();
  const cookieStore = await cookies();
  const cookieName = sessionCookieName(env.NODE_ENV === "production");
  const token = cookieStore.get(cookieName)?.value;

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
