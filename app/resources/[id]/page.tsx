import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/src/components/app-shell";
import { formatBytes } from "@/src/components/resource-list";
import { ResourceActions } from "@/src/components/resource-actions";
import { getCurrentUser } from "@/src/lib/auth/session";
import { getResourceForViewer } from "@/src/lib/resources";
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

  return (
    <AppShell user={user} current="resources">
      <article className="content detail">
        <Link className="back" href="/resources">← Back to resources</Link>
        <div className="file-icon large-file" aria-hidden="true">{resource.originalFilename.split(".").pop()?.toUpperCase() || "FILE"}</div>
        <h1 className="detail-title">{resource.title}</h1>
        <div className="detail-meta"><span>Shared by {resource.authorName}</span><span>·</span><span className={`status ${resource.status}`}>{resource.status}</span>{resource.publishedAt ? <><span>·</span><time dateTime={resource.publishedAt.toISOString()}>{resource.publishedAt.toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric" })}</time></> : null}</div>
        <p className="detail-body">{resource.description || "No description was provided."}</p>
        <div className="tags">{resource.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>
        <section className="file-panel" aria-label="File details">
          <div className="file-icon" aria-hidden="true">FILE</div>
          <div><strong>{resource.originalFilename}</strong><small>{resource.mimeType} · {formatBytes(resource.sizeBytes)}</small></div>
        </section>
        <p className="notice">The file is stored privately. Every download request is re-authorized and receives a short-lived link.</p>
        {resource.status !== "active" ? <p className="notice">This resource is visible only to its author or an administrator and cannot be downloaded in its current state.</p> : null}
        <ResourceActions resourceId={resource.id} isOwner={resource.authorId === user.id || user.role === "admin"} canDownload={resource.status === "active"} initial={{ title: resource.title, description: resource.description, tags: resource.tags }} />
      </article>
    </AppShell>
  );
}
