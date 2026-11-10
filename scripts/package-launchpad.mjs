import { deepStrictEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const tag = process.argv[2];
if (process.argv.length !== 3 || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(tag ?? "")) {
  throw new Error("Usage: node scripts/package-launchpad.mjs <lowercase-release-tag>");
}

function run(command, args, cwd = workspace, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Command failed: ${command} ${args[0] ?? ""}`);
  return result.stdout;
}
function within(parent, child) {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

const repository = realpathSync(run("git", ["rev-parse", "--show-toplevel"]).trim());
if (repository !== workspace) throw new Error("The packager must be located in the repository's scripts directory");
const commit = run("git", ["rev-parse", "HEAD"]).trim();
const tracked = [...new Set(run("git", ["ls-files", "-z"]).split("\0").filter(Boolean))];
const committedLock = run("git", ["show", "HEAD:package-lock.json"]);
const lock = JSON.parse(committedLock);
if (!Number.isInteger(lock.lockfileVersion) || lock.lockfileVersion < 1) throw new Error("Committed npm lockfile is invalid");

const npmCandidates = [
  process.env.npm_execpath,
  join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  join(dirname(dirname(process.execPath)), "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  "/usr/share/nodejs/npm/bin/npm-cli.js",
].filter((path) => path && existsSync(path));
if (!npmCandidates.length) throw new Error("Cannot find npm-cli.js for the current Node.js installation");
const npmCli = npmCandidates[0];
const npmMajor = Number(run(process.execPath, [npmCli, "--version"]).trim().split(".")[0]);
if (!Number.isInteger(npmMajor) || npmMajor >= 12) throw new Error("This deployment format requires npm 11 or earlier with shrinkwrap support");

const tempRoot = join(workspace, ".tmp");
if (existsSync(tempRoot) && !within(workspace, realpathSync(tempRoot))) throw new Error("The staging parent resolves outside the repository");
mkdirSync(tempRoot, { recursive: true });
const stage = join(tempRoot, `launchpad-source-${tag}`);
if (existsSync(stage)) throw new Error("The release staging directory already exists; choose a new tag");
mkdirSync(stage);

const excludedDirectories = new Set([".git", ".agents", ".codex", ".tmp", "node_modules", ".next", "frontend-prototype", "work", "test-results"]);
for (const path of tracked) {
  const segments = path.split("/");
  if (isAbsolute(path) || segments.some((segment) => segment === ".." || segment.includes("\\"))) throw new Error("Invalid tracked path");
  if (path === "Dockerfile" || path === "compose.yaml" || path === "package-lock.json" || path === "npm-shrinkwrap.json") continue;
  if (segments.some((segment) => excludedDirectories.has(segment) || segment.startsWith(".env"))) continue;
  const source = resolve(workspace, path);
  const destination = resolve(stage, path);
  if (!within(workspace, source) || !within(stage, destination)) throw new Error("Tracked path escapes the release directory");
  let stat;
  try { stat = lstatSync(source); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
  if (!stat.isFile() || !within(workspace, realpathSync(source))) throw new Error("Tracked release inputs must be regular files inside the repository");
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}
if (!existsSync(join(stage, ".launchpad", "deploy.json")) || !existsSync(join(stage, "package.json"))) throw new Error("The release is missing its deployment config or package.json");
writeFileSync(join(stage, "package-lock.json"), committedLock, "utf8");
run(process.execPath, [npmCli, "shrinkwrap", "--ignore-scripts", "--offline", "--no-audit", "--no-fund"], stage, {
  ...process.env, npm_config_update_notifier: "false", npm_config_logs_max: "0",
});
const shrinkwrap = join(stage, "npm-shrinkwrap.json");
if (!existsSync(shrinkwrap)) throw new Error("npm did not produce a publishable shrinkwrap lockfile");
deepStrictEqual(JSON.parse(readFileSync(shrinkwrap, "utf8")), lock, "The published dependency lock must match HEAD:package-lock.json");

function countFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce((count, entry) => count + (entry.isDirectory() ? countFiles(join(directory, entry.name)) : 1), 0);
}
console.log(JSON.stringify({ stage, files: countFiles(stage), commit }));
