import { and, eq, isNull, lt, or } from "drizzle-orm";

import { getDatabase } from "@/src/db";
import { oauthLoginTransactions, resources, sessions } from "@/src/db/schema";
import { safeEqual } from "@/src/lib/crypto";
import { getServerEnv } from "@/src/lib/env";
import { noStoreJson } from "@/src/lib/http";
import { deleteObject } from "@/src/lib/storage";

export async function POST(request: Request) {
  const env = getServerEnv();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || !safeEqual(token, env.CRON_SECRET)) return noStoreJson({ error: "unauthorized" }, { status: 401 });
  const now = Date.now();
  const pendingCutoff = new Date(now - 60 * 60_000);
  const scanningCutoff = new Date(now - 15 * 60_000);
  const deletedCutoff = new Date(now - env.RESOURCE_DELETE_RETENTION_DAYS * 86400_000);
  const candidates = await getDatabase().select({ id: resources.id, objectKey: resources.objectKey, status: resources.status }).from(resources).where(and(isNull(resources.objectDeletedAt), or(and(eq(resources.status, "pending"), lt(resources.createdAt, pendingCutoff)), and(eq(resources.status, "scanning"), lt(resources.updatedAt, scanningCutoff)), and(eq(resources.status, "deleted"), lt(resources.deletedAt, deletedCutoff))))).limit(200);
  let cleaned = 0;
  for (const candidate of candidates) {
    try {
      await deleteObject(candidate.objectKey);
      await getDatabase().update(resources).set({ objectDeletedAt: new Date(), ...(candidate.status === "pending" ? { status: "failed" as const, updatedAt: new Date() } : candidate.status === "scanning" ? { status: "quarantined" as const, moderationReason: "scan_timeout", updatedAt: new Date() } : {}) }).where(and(eq(resources.id, candidate.id), eq(resources.status, candidate.status), isNull(resources.objectDeletedAt)));
      cleaned += 1;
    } catch {
      // Leave the row eligible for a later retry.
    }
  }
  const deletedTransactions = await getDatabase().delete(oauthLoginTransactions).where(lt(oauthLoginTransactions.expiresAt, new Date(now - 86400_000))).returning({ id: oauthLoginTransactions.id });
  const deletedSessions = await getDatabase().delete(sessions).where(lt(sessions.expiresAt, new Date(now - 7 * 86400_000))).returning({ id: sessions.id });
  return noStoreJson({ inspected: candidates.length, cleaned, expiredTransactions: deletedTransactions.length, expiredSessions: deletedSessions.length });
}
