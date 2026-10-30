import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (existsSync("launchpad.runtime.env")) {
  process.loadEnvFile("launchpad.runtime.env");
}

const fastBuild = process.argv.includes("--fast");
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const env = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  ...(fastBuild ? { SIDER_FAST_BUILD: "1" } : {}),
};

const result = spawnSync(process.execPath, [nextBin, "build"], {
  env,
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.signal) console.error(`Next.js build terminated by ${result.signal}`);
process.exitCode = result.status ?? 1;
