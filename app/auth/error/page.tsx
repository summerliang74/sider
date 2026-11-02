import Link from "next/link";

const messages: Record<string, { title: string; detail: string }> = {
  cancelled: { title: "Sign-in was cancelled", detail: "Nothing changed. You can return and try again when you are ready." },
  invalid_state: { title: "This sign-in link is no longer valid", detail: "For your security, sign-in links are short-lived and can only be used once." },
  suspended: { title: "This account is suspended", detail: "Contact an administrator if you believe this is a mistake." },
  platform_unavailable: { title: "Sign-in is temporarily unavailable", detail: "Launchpad could not complete the request. Please try again in a moment." },
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reason } = await searchParams;
  const message = messages[typeof reason === "string" ? reason : ""] ?? messages.platform_unavailable!;
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="error-title">
        <div className="monogram large" aria-hidden="true">S</div>
        <p className="eyebrow">Sign-in help</p>
        <h1 id="error-title">{message.title}</h1>
        <p className="auth-intro">{message.detail}</p>
        <Link className="button primary login-button" href="/login">Back to sign in</Link>
      </section>
    </main>
  );
}
