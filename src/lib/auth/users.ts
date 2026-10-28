import "server-only";

import { getDatabase } from "@/src/db";
import { users } from "@/src/db/schema";
import { getServerEnv } from "@/src/lib/env";

import type { LaunchpadUser } from "./launchpad";
import { AdmissionError, assertLaunchpadAdmission } from "./admission";

export { AdmissionError } from "./admission";

export async function admitAndUpsertUser(profile: LaunchpadUser): Promise<string> {
  const env = getServerEnv();
  assertLaunchpadAdmission(profile, env);
  const role = env.adminSubs.includes(profile.sub) ? "admin" as const : "student" as const;

  const [user] = await getDatabase()
    .insert(users)
    .values({
      launchpadSub: profile.sub,
      email: profile.email ?? null,
      displayName: profile.name ?? profile.email ?? "SHSID student",
      avatarUrl: profile.picture ?? null,
      org: profile.org,
      verified: true,
      role,
    })
    .onConflictDoUpdate({
      target: users.launchpadSub,
      set: {
        email: profile.email ?? null,
        displayName: profile.name ?? profile.email ?? "SHSID student",
        avatarUrl: profile.picture ?? null,
        org: profile.org,
        verified: true,
        role,
        updatedAt: new Date(),
        lastLoginAt: new Date(),
      },
    })
    .returning({ id: users.id, status: users.status });

  if (!user) throw new Error("Failed to persist user");
  if (user.status !== "active") throw new AdmissionError("suspended");
  return user.id;
}

export async function admitAndUpsertLocalUser(): Promise<string> {
  const env = getServerEnv();
  if (env.AUTH_MODE === "launchpad") throw new Error("Local authentication is disabled");

  const [user] = await getDatabase()
    .insert(users)
    .values({
      launchpadSub: env.localAuthSub,
      email: null,
      displayName: env.LOCAL_AUTH_DISPLAY_NAME,
      avatarUrl: null,
      org: "local",
      verified: true,
      role: "admin",
    })
    .onConflictDoUpdate({
      target: users.launchpadSub,
      set: {
        displayName: env.LOCAL_AUTH_DISPLAY_NAME,
        org: "local",
        verified: true,
        role: "admin",
        updatedAt: new Date(),
        lastLoginAt: new Date(),
      },
    })
    .returning({ id: users.id, status: users.status });

  if (!user) throw new Error("Failed to persist local user");
  if (user.status !== "active") throw new AdmissionError("suspended");
  return user.id;
}
