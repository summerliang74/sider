const baseValue = process.env.VERIFY_BASE_URL;
if (!baseValue) throw new Error("VERIFY_BASE_URL is required");
const base = new URL(baseValue);
if (base.protocol !== "https:") throw new Error("VERIFY_BASE_URL must use HTTPS");
if (base.pathname !== "/") throw new Error("VERIFY_BASE_URL must be an origin");

const failures = [];
const passed = [];

function check(condition, label) {
  if (condition) passed.push(label);
  else failures.push(label);
}

async function request(path, init = {}) {
  return fetch(new URL(path, base), { redirect: "manual", signal: AbortSignal.timeout(10_000), ...init });
}

const health = await request("/api/health");
check(health.status === 200, "liveness endpoint");
check((await health.json()).status === "ok", "liveness payload");

const login = await request("/login");
const loginHtml = await login.text();
check(login.status === 200, "login page");
check(loginHtml.includes("Continue with Launchpad"), "Launchpad login control");
check(login.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), "content security policy");
check(login.headers.get("strict-transport-security")?.includes("max-age="), "HSTS");
check(login.headers.get("x-content-type-options") === "nosniff", "MIME sniffing protection");
check(login.headers.get("x-frame-options") === "DENY", "frame protection");

const resources = await request("/resources");
check([302, 303, 307, 308].includes(resources.status), "protected resource redirect");
check(resources.headers.get("location") === "/login", "protected resource redirect target");
check(resources.headers.get("cache-control")?.includes("no-store"), "protected page cache control");

const me = await request("/api/me");
check(me.status === 401, "unauthenticated API rejection");

const csrf = await request("/api/auth/logout", {
  method: "POST",
  headers: { origin: "https://untrusted.invalid", "sec-fetch-site": "cross-site" },
});
check(csrf.status === 403, "cross-origin mutation rejection");

if (process.env.VERIFY_CRON_SECRET) {
  const readiness = await request("/api/internal/ready", {
    headers: { authorization: `Bearer ${process.env.VERIFY_CRON_SECRET}` },
  });
  const payload = await readiness.json();
  check(readiness.status === 200, "external service readiness");
  check(payload?.services?.database === true, "PostgreSQL readiness");
  check(payload?.services?.rateLimit === true, "rate-limit store readiness");
  check(payload?.services?.storage === true, "object storage readiness");
}

for (const label of passed) console.log(`PASS ${label}`);
for (const label of failures) console.error(`FAIL ${label}`);
if (failures.length) process.exitCode = 1;
