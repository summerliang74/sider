import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/src/components/app-shell";
import { getDatabase } from "@/src/db";
import { resources } from "@/src/db/schema";
import { getCurrentUser } from "@/src/lib/auth/session";

function fileLabel(filename: string): string {
  const extension = filename.split(".").pop()?.toUpperCase();
  return extension && extension.length <= 5 ? extension : "FILE";
}

function statusLabel(status: string): string {
  return status === "active" ? "Active" : status === "scanning" || status === "pending" ? "Scanning" : "Failed";
}

const uploadFilters = ["all", "active", "scanning", "unavailable"] as const;
type UploadFilter = (typeof uploadFilters)[number];

function isUploadFilter(value: unknown): value is UploadFilter {
  return typeof value === "string" && uploadFilters.includes(value as UploadFilter);
}

function uploadMatchesFilter(status: string, filter: UploadFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return status === "active";
  if (filter === "scanning") return status === "scanning" || status === "pending";
  return !["active", "scanning", "pending"].includes(status);
}

export default async function MyResourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const filter: UploadFilter = isUploadFilter(params.status) ? params.status : "all";
  const items = await getDatabase()
    .select({ id: resources.id, title: resources.title, filename: resources.originalFilename, status: resources.status, createdAt: resources.createdAt })
    .from(resources)
    .where(eq(resources.authorId, user.id))
    .orderBy(desc(resources.createdAt))
    .limit(100);

  const activeCount = items.filter((item) => item.status === "active").length;
  const scanningCount = items.filter((item) => item.status === "scanning" || item.status === "pending").length;
  const visibleItems = items.filter((item) => uploadMatchesFilter(item.status, filter));

  return (
    <AppShell user={user} current="mine">
      <div className="content uploads-page">
        <section className="page-heading">
          <div>
            <h1>My uploads</h1>
            <p>Track everything you have shared, including files that are still scanning or unavailable to classmates.</p>
          </div>
          <Link className="button primary" href="/resources/new">Upload resource</Link>
        </section>

        {items.length === 0 ? (
          <div className="empty"><h2>No uploads yet</h2><p>Upload your first resource when you are ready.</p><Link className="button primary" href="/resources/new">Start an upload</Link></div>
        ) : (
          <>
            <section className="upload-summary">
              <div><strong>{items.length} resources</strong><small>{activeCount} active · {scanningCount} scanning</small></div>
              <div className="status-legend"><span className="status active">Active</span><span className="status scanning">Scanning</span></div>
            </section>
            <div className="uploads-toolbar"><h2>{filter === "all" ? "All uploads" : `${filter.charAt(0).toUpperCase()}${filter.slice(1)} uploads`}</h2><nav className="status-filters" aria-label="Filter uploads by status">{uploadFilters.map((value) => <Link key={value} className={filter === value ? "selected" : undefined} aria-current={filter === value ? "page" : undefined} href={value === "all" ? "/me/resources" : `/me/resources?status=${value}`}>{value === "all" ? "All" : value.charAt(0).toUpperCase() + value.slice(1)}</Link>)}</nav></div>
            <div className="upload-table-head" aria-hidden="true"><span /><span>Name</span><span>Uploaded</span><span>Status</span></div>
            {visibleItems.length === 0 ? <div className="empty compact"><h2>No {filter} uploads</h2><p>Choose another status to see the rest of your resources.</p></div> : <div className="upload-list">
              {visibleItems.map((item) => (
                <article className="upload-row group" key={item.id}>
                  <span className="file-icon" aria-hidden="true">{fileLabel(item.filename)}</span>
                  <div className="upload-copy"><strong>{item.status !== "deleted" ? <Link href={`/resources/${item.id}`}>{item.title}</Link> : item.title}</strong><small>{item.filename}</small></div>
                  <time dateTime={item.createdAt.toISOString()}>{item.createdAt.toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" })}</time>
                  <span className={`status ${item.status}`}>{statusLabel(item.status)}</span>
                </article>
              ))}
            </div>}
          </>
        )}
      </div>
    </AppShell>
  );
}
