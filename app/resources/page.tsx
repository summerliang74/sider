import { NavigationLink as Link } from "@/src/components/navigation-link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppShell } from "@/src/components/app-shell";
import { SearchHub, type SerializedResourceListItem } from "@/src/components/search-hub";
import { ResourceSearchSkeleton } from "@/src/components/resource-loading";
import { getCurrentUser, type CurrentUser } from "@/src/lib/auth/session";
import { loginUrl } from "@/src/lib/auth/return-to";
import { isResourceCollection, isResourceFileType } from "@/src/lib/resource-search";
import { listResourceTags } from "@/src/lib/resources";
import { getInitialResourceSearch } from "@/src/lib/resource-search-request";
import { canonicalTag } from "@/src/lib/resource-tags";
import { startPageTiming, timeOperation } from "@/src/lib/telemetry";

export const metadata = { title: "Resources" };

async function ResourceSearchContent({ user, filters, sessionMs, recordTiming }: {
  user: CurrentUser;
  filters: Parameters<typeof getInitialResourceSearch>[0];
  sessionMs: number;
  recordTiming: ReturnType<typeof startPageTiming>;
}) {
  const requestHeaders = await headers();
  const [tags, listing] = await Promise.all([
    timeOperation(listResourceTags),
    timeOperation(() => getInitialResourceSearch(filters, user, { headers: requestHeaders })),
  ]);
  recordTiming({ sessionMs, tagsMs: tags.durationMs, listMs: listing.durationMs });
  const initialItems: SerializedResourceListItem[] = listing.value.items.map((item) => ({
    ...item,
    publishedAt: item.publishedAt.toISOString(),
  }));
  return <SearchHub
    initialQuery={filters.q}
    initialFileType={filters.fileType}
    initialTag={filters.tag}
    tagOptions={tags.value}
    initialItems={initialItems}
    initialNextCursor={listing.value.nextCursor}
    initialError={listing.value.error}
  />;
}

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const recordTiming = startPageTiming("resources");
  const session = await timeOperation(getCurrentUser);
  const user = session.value;
  const params = await searchParams;
  if (!user) redirect(loginUrl("/resources", params));
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const fileType = isResourceFileType(params.type) ? params.type : undefined;
  const collection = isResourceCollection(params.collection) ? params.collection : undefined;
  const tag = typeof params.tag === "string" ? canonicalTag(params.tag.trim().slice(0, 30)) || undefined : collection ? "PA" : undefined;

  return (
    <AppShell user={user} current="resources">
      <div className="content">
        <section className="page-heading">
          <div>
            <h1>Resources</h1>
          </div>
          <Link className="button primary" href="/resources/new" prefetchOnIntent prefetchWhenIdle><span aria-hidden="true">＋</span> Upload resource</Link>
        </section>
        <Suspense key={JSON.stringify([tag, query, fileType])} fallback={<ResourceSearchSkeleton />}>
          <ResourceSearchContent user={user} filters={{ q: query, fileType, tag }} sessionMs={session.durationMs} recordTiming={recordTiming} />
        </Suspense>
        <footer className="footer"><Link href="/privacy">Privacy</Link><span aria-hidden="true">·</span><Link href="/terms">Terms</Link></footer>
      </div>
    </AppShell>
  );
}
