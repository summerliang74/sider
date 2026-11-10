import { setTimeout as delay } from "node:timers/promises";

// A separately supervised process, not an in-memory promise attached to a page.
const base = new URL(process.env.UPLOAD_WORKER_BASE_URL ?? "http://127.0.0.1:3000");
if (base.protocol !== "https:" && !(base.protocol === "http:" && ["app", "localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) {
  throw new Error("UPLOAD_WORKER_BASE_URL requires HTTPS outside the local service network");
}
if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32) throw new Error("CRON_SECRET is required");
let stopped = false;
process.on("SIGTERM", () => { stopped = true; });
process.on("SIGINT", () => { stopped = true; });
while (!stopped) {
  let processed = false;
  try {
    const response = await fetch(new URL("/api/internal/jobs/uploads", base), {
      method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      redirect: "error", signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new Error("worker_request_failed");
    processed = (await response.json()).processed === true;
  } catch {
    console.error(JSON.stringify({ event: "upload.worker_unavailable" }));
  }
  if (!stopped) await delay(processed ? 100 : 5_000);
}
