import { sql } from "drizzle-orm";

import { getDatabase } from "@/src/db";
import { safeEqual } from "@/src/lib/crypto";
import { getServerEnv } from "@/src/lib/env";
import { noStoreJson } from "@/src/lib/http";
import { redisCommand } from "@/src/lib/security/rate-limit";
import { checkStorage } from "@/src/lib/storage";

export async function GET(request: Request) {
  const env = getServerEnv();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || !safeEqual(token, env.CRON_SECRET)) return noStoreJson({ error: "unauthorized" }, { status: 401 });
  const checks = await Promise.allSettled([
    getDatabase().execute(sql`select 1`),
    redisCommand(["PING"]),
    checkStorage(),
  ]);
  const services = { database: checks[0]?.status === "fulfilled", rateLimit: checks[1]?.status === "fulfilled", storage: checks[2]?.status === "fulfilled" };
  const ready = Object.values(services).every(Boolean);
  return noStoreJson({ status: ready ? "ready" : "degraded", services }, { status: ready ? 200 : 503 });
}
