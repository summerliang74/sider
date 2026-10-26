import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/src/lib/auth/session";
import { LaunchpadLogin } from "@/src/components/launchpad-login";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/resources");

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="monogram large" aria-hidden="true">S</div>
        <p className="eyebrow">SHSID Online</p>
        <h1 id="login-title">A shared shelf for student knowledge.</h1>
        <p className="auth-intro">
          Search, share, and preserve useful learning resources with verified members of the SHSID community.
        </p>
        <LaunchpadLogin />
        <p className="privacy-note">
          Access is limited to verified students. By continuing, you agree to our <Link href="/terms">terms</Link> and acknowledge our <Link href="/privacy">privacy notice</Link>.
        </p>
      </section>
    </main>
  );
}
