import "server-only";

import { eq } from "drizzle-orm";

import { getDatabase } from "@/src/db";
import { localAccounts, users } from "@/src/db/schema";
import { hashOpaqueToken, safeEqual } from "@/src/lib/crypto";
import { getServerEnv } from "@/src/lib/env";

import { verifyPassword } from "./password";
import { admitAndUpsertLocalUser } from "./users";

const DUMMY_PASSWORD_HASH = "scrypt$16384$8$1$MDAwMDAwMDAwMDAwMDAwMA$P5RbR9d9Lphb4zsXjJy4Ek-AVNY0x6SI8R4p8SDip7J7qZ6bXQ8QIBvs0MdaQehY7BvJmUrIn8A3EcL6Wbe28A";

function protectedEqual(left: string, right: string, pepper: string): boolean {
  return safeEqual(hashOpaqueToken(left, pepper), hashOpaqueToken(right, pepper));
}

export async function authenticateLocalUser(username: string, password: string): Promise<string | null> {
  const env = getServerEnv();
  if (env.AUTH_MODE === "launchpad" || !env.LOCAL_AUTH_PASSWORD) return null;

  const normalizedUsername = username.trim().toLowerCase();
  const adminMatches = protectedEqual(normalizedUsername, env.LOCAL_AUTH_USERNAME.toLowerCase(), env.SESSION_SECRET) &&
    protectedEqual(password, env.LOCAL_AUTH_PASSWORD, env.SESSION_SECRET);
  if (adminMatches) return admitAndUpsertLocalUser();

  const [account] = await getDatabase()
    .select({ userId: localAccounts.userId, passwordHash: localAccounts.passwordHash })
    .from(localAccounts)
    .innerJoin(users, eq(localAccounts.userId, users.id))
    .where(eq(localAccounts.username, normalizedUsername))
    .limit(1);
  const passwordMatches = await verifyPassword(password, account?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!account || !passwordMatches) return null;

  const [activeUser] = await getDatabase()
    .update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, account.userId))
    .returning({ id: users.id, status: users.status });
  return activeUser?.status === "active" ? activeUser.id : null;
}
