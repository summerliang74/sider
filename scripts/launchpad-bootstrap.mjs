import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";

// Launchpad's legacy runner restores runtime variables after accepting the
// prebuilt archive. Keep the existing bootstrap phase, then supervise both
// processes in the same managed container so no uploaded job is left idle.
if (existsSync(".env")) process.loadEnvFile(".env");

if (process.env.APP_BASE_URL && process.env.SESSION_SECRET && process.env.DATABASE_URL) {
  if (!process.env.CRON_SECRET) throw new Error("CRON_SECRET is required for the upload worker");
  const port = process.env.PORT || "3000";
  const children = new Set();
  let stopping = false;
  let exitCode = 0;
  let deadline;

  function stop(code) {
    if (stopping) return;
    stopping = true; exitCode = code;
    for (const child of children) child.kill("SIGTERM");
    deadline = setTimeout(() => {
      for (const child of children) child.kill("SIGKILL");
      process.exit(exitCode);
    }, 10_000);
    deadline.unref();
  }
  function launch(name, args, options) {
    const child = spawn(process.execPath, args, { windowsHide: true, stdio: "inherit", ...options });
    children.add(child);
    child.on("error", () => { console.error(JSON.stringify({ event: "service.start_failed", service: name })); stop(1); });
    child.on("close", () => {
      children.delete(child);
      if (!stopping) { console.error(JSON.stringify({ event: "service.exited", service: name })); stop(1); }
      if (!children.size) { clearTimeout(deadline); process.exit(exitCode); }
    });
  }
  launch("app", ["server.js"], { cwd: "runtime-app", env: { ...process.env, HOSTNAME: "0.0.0.0", PORT: port } });
  launch("upload-worker", ["upload-worker.mjs"], { env: { ...process.env, UPLOAD_WORKER_BASE_URL: `http://127.0.0.1:${port}` } });
  console.info(JSON.stringify({ event: "upload.services_started" }));
  process.on("SIGTERM", () => stop(0));
  process.on("SIGINT", () => stop(0));
} else {
  createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ status: "bootstrapping", path: request.url }));
  }).listen(Number(process.env.PORT || 3000), "0.0.0.0");
}
