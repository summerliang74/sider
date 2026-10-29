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

export default async function MyResourcesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const items = await getDatabase()
    .select({ id: resources.id, title: resources.title, filename: resources.originalFilename, status: resources.status, createdAt: resources.createdAt })
    .from(resources)
    .where(eq(resources.authorId, user.id))
    .orderBy(desc(resources.createdAt))
    .limit(100);

  const activeCount = items.filter((item) => item.status === "active").length;
  const scanningCount = items.filter((item) => item.status === "scanning" || item.status === "pending").length;

  return (
    <AppShell user={user} current="mine">
      <div className="content uploads-page">
        <section className="uploads-hero">
          <div>
            <p className="eyebrow">YOUR WORK</p>
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
            <div className="uploads-toolbar"><h2>All uploads</h2><span className="status-filter">All statuses&nbsp; ⌄</span></div>
            <div className="upload-table-head" aria-hidden="true"><span /><span>Name</span><span>Uploaded</span><span>Status</span></div>
            <div className="upload-list">
              {items.map((item) => (
                <article className="upload-row" key={item.id}>
                  <span className="file-icon" aria-hidden="true">{fileLabel(item.filename)}</span>
                  <div className="upload-copy"><strong>{item.status !== "deleted" ? <Link href={`/resources/${item.id}`}>{item.title}</Link> : item.title}</strong><small>{item.filename}</small></div>
                  <time dateTime={item.createdAt.toISOString()}>{item.createdAt.toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" })}</time>
                  <span className={`status ${item.status}`}>{statusLabel(item.status)}</span>
                  <span className="row-more" aria-hidden="true">•••</span>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
