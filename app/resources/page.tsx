import Link from "next/link";
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
        <section className="page-heading">
          <div>
            <h1>{isPeerAdvisorView ? "Peer Advisor resources" : "Resource library"}</h1>
          </div>
          <Link className="button primary" href="/resources/new" prefetch={false}><span aria-hidden="true">＋</span> Upload resource</Link>
        </section>
        <SearchHub
          key={JSON.stringify([collection, query, fileType])}
          initialQuery={query}
          initialFileType={fileType}
          initialCollection={collection}
          initialItems={initialItems}
          initialNextCursor={initialResult?.nextCursor}
        />
        <footer className="footer"><Link href="/privacy">Privacy</Link><span aria-hidden="true">·</span><Link href="/terms">Terms</Link></footer>
      </div>
    </AppShell>
  );
}
