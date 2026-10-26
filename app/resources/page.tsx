import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/src/components/app-shell";
import { SearchHub } from "@/src/components/search-hub";
import { getCurrentUser } from "@/src/lib/auth/session";

export const metadata = { title: "Resources" };

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";

  return (
    <AppShell user={user} current="resources">
      <div className="content">
        <section className="hero">
          <div><p className="eyebrow">Resource Hub</p><h1>Find what your classmates found useful.</h1><p>Search notes, guides, worksheets, and references shared by verified students.</p></div>
          <div className="shelf-mark" aria-hidden="true">▱<br />▰</div>
        </section>
        <SearchHub initialQuery={query} />
        <footer className="footer"><span>SHSID Online · student resource hub</span><span><Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link></span></footer>
      </div>
    </AppShell>
  );
}
