import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/src/components/app-shell";
import { SearchHub, type SerializedResourceListItem } from "@/src/components/search-hub";
import { getCurrentUser } from "@/src/lib/auth/session";
import { loginUrl } from "@/src/lib/auth/return-to";
import { isResourceCollection, isResourceFileType } from "@/src/lib/resource-search";
import { listActiveResources, listResourceTags } from "@/src/lib/resources";
import { canonicalTag } from "@/src/lib/resource-tags";
import { startPageTiming, timeOperation } from "@/src/lib/telemetry";

export const metadata = { title: "Resources" };

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
  const [tags, listing] = await Promise.all([
    timeOperation(listResourceTags),
    !query && !fileType ? timeOperation(() => listActiveResources({ q: "", tag })) : undefined,
  ]);
  const tagOptions = tags.value;
  const initialResult = listing?.value;
  recordTiming({ sessionMs: session.durationMs, tagsMs: tags.durationMs, listMs: listing?.durationMs ?? null });
  const initialItems: SerializedResourceListItem[] | undefined = initialResult?.items.map((item) => ({
    ...item,
    publishedAt: item.publishedAt.toISOString(),
  }));

  return (
    <AppShell user={user} current="resources">
      <div className="content">
        <section className="page-heading">
          <div>
            <h1>Resources</h1>
          </div>
          <Link className="button primary" href="/resources/new" prefetch={false}><span aria-hidden="true">＋</span> Upload resource</Link>
        </section>
        <SearchHub
          key={JSON.stringify([tag, query, fileType])}
          initialQuery={query}
          initialFileType={fileType}
          initialTag={tag}
          tagOptions={tagOptions}
          initialItems={initialItems}
          initialNextCursor={initialResult?.nextCursor}
        />
        <footer className="footer"><Link href="/privacy">Privacy</Link><span aria-hidden="true">·</span><Link href="/terms">Terms</Link></footer>
      </div>
    </AppShell>
  );
}
