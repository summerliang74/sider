import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const env = {
  ...process.env,
  NODE_ENV: "production",
  LAUNCHPAD_FAST_BUILD: "1",
  NEXT_TELEMETRY_DISABLED: "1",
};

const result = spawnSync(process.execPath, [nextBin, "start", ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.signal) console.error(`Next.js server terminated by ${result.signal}`);
process.exitCode = result.status ?? 1;
