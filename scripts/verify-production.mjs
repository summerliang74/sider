const baseValue = process.env.VERIFY_BASE_URL;
if (!baseValue) throw new Error("VERIFY_BASE_URL is required");
const base = new URL(baseValue);
if (base.protocol !== "https:") throw new Error("VERIFY_BASE_URL must use HTTPS");
if (base.pathname !== "/") throw new Error("VERIFY_BASE_URL must be an origin");
const configuredAuthMode = process.env.SHSID_AUTH_MODE ?? process.env.AUTH_MODE;
const configuredRegistrationMode = process.env.REGISTRATION_MODE;

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
const authMode = configuredAuthMode ?? (
  loginHtml.includes('name="username"') && loginHtml.includes('name="password"')
    ? "local"
    : "launchpad"
);
check(login.status === 200, "login page");
check(
  authMode === "local"
    ? loginHtml.includes('name="username"') && loginHtml.includes('name="password"')
    : loginHtml.includes("Continue with Launchpad"),
  `${authMode} login control`,
);
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

const register = await request("/register");
const registerHtml = await register.text();
if (authMode === "local") {
  const registrationMode = configuredRegistrationMode ?? (
    registerHtml.includes("Registration is currently closed.") ? "closed" : "invite"
  );
  check(register.status === 200, "registration page");
  check(
    registrationMode === "invite"
      ? registerHtml.includes('name="inviteCode"') && registerHtml.includes('name="acceptTerms"')
      : registerHtml.includes("Registration is currently closed."),
    registrationMode === "invite" ? "invitation registration form" : "closed registration state",
  );
} else {
  check(register.status === 404, "registration hidden outside local auth mode");
}

const invitations = await request("/api/admin/registration-invites");
check(
  invitations.status === (authMode === "local" ? 401 : 404),
  "unauthenticated invitation management rejection",
);

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
