import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RegisterForm } from "@/src/components/register-form";
import { getCurrentUser } from "@/src/lib/auth/session";
import { getServerEnv } from "@/src/lib/env";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/resources");
  const env = getServerEnv();
  const registrationOpen = env.AUTH_MODE === "local" && env.REGISTRATION_MODE === "invite";

  return (
    <main className="auth-page register-page">
      <section className="auth-editorial">
        <div className="auth-brand"><Image src="/figma/sider-mark.svg" alt="" width={28} height={28} aria-hidden="true" /><strong>Sider</strong></div>
        <div className="auth-editorial-copy">
          <p className="eyebrow">INVITED STUDENTS</p>
          <h1>Join the shared shelf for student knowledge.</h1>
          <p>Use the single-use invitation from your administrator to create a private Sider account.</p>
        </div>
        <div className="invite-guidance">
          <strong>Before you begin</strong>
          <p>Your invitation can create one account. Choose a username you will remember and use a unique password of at least 16 characters.</p>
        </div>
      </section>
      <section className="auth-panel register-panel">
        <div className="auth-card register-card" aria-labelledby="register-title">
          <div className="auth-monogram" aria-hidden="true">S</div>
          <p className="eyebrow">CREATE YOUR ACCOUNT</p>
          <h2 id="register-title">Start sharing with Sider.</h2>
          {registrationOpen ? (
            <RegisterForm />
          ) : (
            <div className="registration-closed" role="status">
              <strong>Registration is currently closed.</strong>
              <p>Existing members can still sign in. Ask an administrator when invitation registration will reopen.</p>
            </div>
          )}
          <p className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
