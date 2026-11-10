import { safeEqual } from "@/src/lib/crypto";
import { getServerEnv } from "@/src/lib/env";
import { noStoreJson } from "@/src/lib/http";
import { processNextUploadScan } from "@/src/lib/upload-worker";

export const maxDuration = 180;

export async function POST(request: Request) {
  const env = getServerEnv();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || !safeEqual(token, env.CRON_SECRET)) return noStoreJson({ error: "unauthorized" }, { status: 401 });
  if (!env.malwareScanEnabled) return noStoreJson({ error: "uploads_disabled" }, { status: 503 });
  try {
    return noStoreJson(await processNextUploadScan());
  } catch {
    return noStoreJson({ error: "upload_worker_unavailable" }, { status: 503 });
  }
}
