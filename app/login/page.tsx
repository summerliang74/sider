import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/src/lib/auth/session";
import { LaunchpadLogin } from "@/src/components/launchpad-login";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await getCurrentUser()) redirect("/resources");
  const params = await searchParams;

  return (
    <main className="auth-page">
      <section className="auth-editorial">
        <div className="auth-brand"><Image src="/figma/sider-mark.svg" alt="" width={28} height={28} aria-hidden="true" /><strong>Sider</strong></div>
        <div className="auth-editorial-copy">
          <p className="eyebrow">STUDENT RESOURCE HUB</p>
          <h1>The useful things your classmates found, kept in one place.</h1>
          <p>Search notes, guides, worksheets, and reference files shared inside the SHSID student community.</p>
        </div>
        <div className="resource-preview">
          <p className="eyebrow">RECENTLY SHARED</p>
          <div><Image src="/figma/resource-dot.svg" alt="" width={8} height={8} aria-hidden="true" /><span><strong>Calculus I — Complete Summary</strong><small>PDF · 2.4 MB</small></span></div>
          <div><Image src="/figma/resource-dot.svg" alt="" width={8} height={8} aria-hidden="true" /><span><strong>IB Economics Data Set</strong><small>XLS · 4.8 MB</small></span></div>
          <div><Image src="/figma/resource-dot.svg" alt="" width={8} height={8} aria-hidden="true" /><span><strong>Biology SL — Cell Division</strong><small>PPT · 7.1 MB</small></span></div>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card" aria-labelledby="login-title">
          <div className="auth-monogram" aria-hidden="true">S</div>
          <p className="eyebrow">WELCOME TO SIDER</p>
          <h2 id="login-title">A shared shelf for student knowledge.</h2>
          <p className="auth-intro">Sign in with your school workspace to browse and share verified resources.</p>
          <LaunchpadLogin challengeRequired={params.challenge === "required"} />
          <p className="privacy-note">By continuing, you agree to the student resource <Link href="/terms">policy</Link> and <Link href="/privacy">privacy notice</Link>.</p>
        </div>
      </section>
    </main>
  );
}
