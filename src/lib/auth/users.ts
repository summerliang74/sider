import "server-only";

import { getDatabase } from "@/src/db";
import { users } from "@/src/db/schema";
import { getServerEnv } from "@/src/lib/env";

import type { LaunchpadUser } from "./launchpad";

export class AdmissionError extends Error {
  constructor(public readonly code: "suspended") {
    super(code);
  }
}

export async function admitAndUpsertUser(profile: LaunchpadUser): Promise<string> {
  const env = getServerEnv();
  const role = env.adminSubs.includes(profile.sub) ? "admin" as const : "student" as const;

  const [user] = await getDatabase()
    .insert(users)
    .values({
      launchpadSub: profile.sub,
      email: profile.email ?? null,
      displayName: profile.name ?? profile.email ?? "SHSID student",
      avatarUrl: profile.picture ?? null,
      org: profile.org,
      verified: profile.verified,
      role,
    })
    .onConflictDoUpdate({
      target: users.launchpadSub,
      set: {
        email: profile.email ?? null,
        displayName: profile.name ?? profile.email ?? "SHSID student",
        avatarUrl: profile.picture ?? null,
        org: profile.org,
        verified: profile.verified,
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
