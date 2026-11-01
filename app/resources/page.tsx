import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";

import { AppShell } from "@/src/components/app-shell";
import { SearchHub, type SerializedResourceListItem } from "@/src/components/search-hub";
import { getCurrentUser } from "@/src/lib/auth/session";
import { isResourceCollection, isResourceFileType } from "@/src/lib/resource-search";
import { listActiveResources } from "@/src/lib/resources";

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
  const fileType = isResourceFileType(params.type) ? params.type : undefined;
  const collection = isResourceCollection(params.collection) ? params.collection : undefined;
  const isPeerAdvisorView = collection === "peer-advisors";
  const initialResult = !query && !fileType
    ? await listActiveResources({ q: "", collection })
    : undefined;
  const initialItems: SerializedResourceListItem[] | undefined = initialResult?.items.map((item) => ({
    ...item,
    publishedAt: item.publishedAt.toISOString(),
  }));

  return (
    <AppShell user={user} current={isPeerAdvisorView ? "peer-advisors" : "resources"}>
      <div className="content">
        <section className="hero">
          {isPeerAdvisorView
            ? <div className="hero-copy"><p className="eyebrow">PEER ADVISOR LIBRARY</p><h1>Resources for students<br />who support others.</h1><p>A focused collection of guides, references, and materials curated for SHSID Peer Advisors.</p></div>
            : <div className="hero-copy"><p className="eyebrow">RESOURCE LIBRARY</p><h1>Find what your classmates<br />found useful.</h1><p>A private library of notes, guides, worksheets, and reference files shared by SHSID students, for SHSID students.</p></div>}
          <Image className="shelf-illustration" src="/figma/shelf-illustration.svg" alt="" width={310} height={150} aria-hidden="true" />
        </section>
        <SearchHub
          key={collection ?? "all-resources"}
          initialQuery={query}
          initialFileType={fileType}
          initialCollection={collection}
          initialItems={initialItems}
          initialNextCursor={initialResult?.nextCursor}
        />
        <footer className="footer"><span>Sider · student resource hub</span><span><Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link></span></footer>
      </div>
    </AppShell>
  );
}
