import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Launchpad's protected legacy runner removes standard .env files before
// startup. A deployment-only runtime file can still be loaded explicitly.
if (existsSync("launchpad.runtime.env")) {
  process.loadEnvFile("launchpad.runtime.env");
}

const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const env = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
};

const result = spawnSync(process.execPath, [nextBin, "start", ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.signal) console.error(`Next.js server terminated by ${result.signal}`);
process.exitCode = result.status ?? 1;
