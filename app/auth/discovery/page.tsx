import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { orgDiscoveryCookieName } from "@/src/lib/auth/constants";
import { openJson } from "@/src/lib/crypto";
import { getServerEnv } from "@/src/lib/env";

export const dynamic = "force-dynamic";

const discoverySchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.email().max(320),
  org: z.string().min(1).max(200),
  expiresAt: z.number(),
});

export default async function OrgDiscoveryPage() {
  const cookieStore = await cookies();
  const env = getServerEnv();
  const sealed = cookieStore.get(orgDiscoveryCookieName(env.NODE_ENV === "production"))?.value;
  const discovery = sealed ? openJson(sealed, env.SESSION_SECRET, discoverySchema) : null;
  // This is a request-time authorization check for a short-lived server-only credential.
  // eslint-disable-next-line react-hooks/purity
  if (!discovery || discovery.expiresAt <= Date.now()) redirect("/auth/error?reason=invalid_state");

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="discovery-title">
        <div className="monogram large" aria-hidden="true">S</div>
        <p className="eyebrow">Temporary organization discovery</p>
        <h1 id="discovery-title">Launchpad identity found</h1>
        <p className="auth-intro">
          This account was not given an application session. Copy the exact values below, then disable discovery and redeploy.
        </p>
        <dl className="discovery-values">
          <div><dt>Email</dt><dd>{discovery.email}</dd></div>
          <div><dt>Organization</dt><dd><code>{discovery.org}</code></dd></div>
          <div><dt>Subject</dt><dd><code>{discovery.sub}</code></dd></div>
        </dl>
        <div className="notice">
          Set <code>SHSID_ALLOWED_ORGS</code> to the organization value. If this account should be an administrator,
          set <code>SHSID_ADMIN_SUBS</code> to the subject value. Finally set <code>LAUNCHPAD_ORG_DISCOVERY_EMAIL=disabled</code>.
        </div>
        <Link className="button login-button" href="/login">Back to sign in</Link>
      </section>
    </main>
  );
}
