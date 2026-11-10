import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Launchpad's protected legacy runner removes standard .env files before
// startup. A deployment-only runtime file can still be loaded explicitly.
for (const file of ["launchpad.runtime.env", ".env.production.local", ".env.local", ".env.production", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const env = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
};

if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) throw new Error("CRON_SECRET is required for the upload worker");
const args = process.argv.slice(2);
const portIndex = args.findIndex((arg) => arg === "-p" || arg === "--port");
const port = (portIndex >= 0 ? args[portIndex + 1] : args.find((arg) => arg.startsWith("--port="))?.slice(7)) || env.PORT || "3000";
const children = new Set();
let stopping = false;
let exitCode = 0;
let deadline;
function stop(code) {
  if (stopping) return;
  stopping = true; exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  deadline = setTimeout(() => { for (const child of children) child.kill("SIGKILL"); process.exit(exitCode); }, 10_000);
  deadline.unref();
}
function launch(name, commandArgs, childEnv) {
  const child = spawn(process.execPath, commandArgs, { env: childEnv, stdio: "inherit", windowsHide: true });
  children.add(child);
  child.on("error", () => { console.error(JSON.stringify({ event: "service.start_failed", service: name })); stop(1); });
  child.on("close", () => {
    children.delete(child);
    if (!stopping) { console.error(JSON.stringify({ event: "service.exited", service: name })); stop(1); }
    if (!children.size) { clearTimeout(deadline); process.exit(exitCode); }
  });
}
launch("app", [nextBin, "start", ...args], env);
launch("upload-worker", [fileURLToPath(new URL("./upload-worker.mjs", import.meta.url))], { ...env, UPLOAD_WORKER_BASE_URL: `http://127.0.0.1:${port}` });
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
