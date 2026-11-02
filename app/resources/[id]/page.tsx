import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/src/components/app-shell";
import { formatBytes } from "@/src/components/resource-list";
import { ResourceActions } from "@/src/components/resource-actions";
import { getCurrentUser } from "@/src/lib/auth/session";
import { getResourceForViewer } from "@/src/lib/resources";
import { getDownloadOrigin } from "@/src/lib/storage";
import { recordMetric } from "@/src/lib/telemetry";

export default async function ResourceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const resource = await getResourceForViewer(id, user);
  if (!resource) notFound();
  const query = await searchParams;
  recordMetric("resource.viewed", { source: query.source === "search" ? "search" : "direct" });
  const fileType = resource.originalFilename.split(".").pop()?.toUpperCase() || "FILE";
  const subject = resource.tags[0] || "General";

  return (
    <AppShell user={user} current="resources" title="Resource detail">
      <div className="content resource-detail-page">
        <Link className="back" href="/resources">← Back to resources</Link>
        <div className="detail-columns">
          <article className="resource-article">
            <div className="file-icon" aria-hidden="true">{fileType}</div>
            <h1>{resource.title}</h1>
            <div className="detail-meta"><span>Shared by {resource.authorName}</span><span>·</span><span>{resource.status === "active" ? "Active" : resource.status}</span>{resource.publishedAt ? <><span>·</span><time dateTime={resource.publishedAt.toISOString()}>{resource.publishedAt.toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" })}</time></> : null}</div>
            <p className="detail-body">{resource.description || "No description was provided."}</p>
            <div className="tags">{resource.tags.map((tag, index) => <span className={`tag tone-${index % 3}`} key={tag}>{tag}</span>)}</div>
            <section className="file-panel" aria-label="File details">
              <div className="file-icon" aria-hidden="true">{fileType}</div>
              <div><strong>{resource.originalFilename}</strong><small>{resource.mimeType} · {formatBytes(resource.sizeBytes)} · {resource.status === "active" ? "scanned and verified" : resource.status}</small></div>
              <span className={`status ${resource.status}`}>{resource.status === "active" ? "Active" : resource.status}</span>
            </section>
            <p className="notice"><span aria-hidden="true">●</span>The file is stored privately. Download links are short-lived and available only to signed-in Launchpad students.</p>
            {resource.status !== "active" ? <p className="notice">This resource is visible only to its author or an administrator and cannot be downloaded in its current state.</p> : null}
            <ResourceActions resourceId={resource.id} isOwner={resource.authorId === user.id} isAdmin={user.role === "admin"} canDownload={resource.status === "active"} downloadOrigin={getDownloadOrigin()} initial={{ title: resource.title, description: resource.description, tags: resource.tags }} />
          </article>
          <aside className="resource-context">
            <p className="eyebrow">RESOURCE CONTEXT</p>
            <h2>A high-signal study guide</h2>
            <dl><div><dt>Subject</dt><dd>{subject}</dd></div><div><dt>Type</dt><dd>{fileType}</dd></div><div><dt>Status</dt><dd>{resource.status}</dd></div><div><dt>Size</dt><dd>{formatBytes(resource.sizeBytes)}</dd></div></dl>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
