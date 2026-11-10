import { NavigationLink as Link } from "./navigation-link";

import type { ResourceListItem, SearchHighlightSegment } from "@/src/lib/resources";

function fileLabel(mimeType: string, filename: string): string {
  const extension = filename.split(".").pop()?.toUpperCase();
  if (extension && extension.length <= 5) return extension;
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.startsWith("image/")) return "IMG";
  return "FILE";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function HighlightedText({
  segments,
  fallback,
}: {
  segments: SearchHighlightSegment[] | undefined;
  fallback: string;
}) {
  if (!segments?.length) return fallback;
  return segments.map((segment, index) => segment.highlighted
    ? <mark key={index}>{segment.text}</mark>
    : <span key={index}>{segment.text}</span>);
}

export function ResourceList({
  items,
  emptyTitle = "No resources found",
  emptyMessage = "Try a shorter search or check the spelling.",
}: {
  items: ResourceListItem[];
  emptyTitle?: string;
  emptyMessage?: string;
}) {
  if (items.length === 0) {
    return <div className="empty"><h2>{emptyTitle}</h2><p>{emptyMessage}</p></div>;
  }
  return (
    <div className="resource-list">
      {items.map((resource, index) => (
        <Link className="resource-row group" href={`/resources/${resource.id}?source=search`} prefetchOnIntent prefetchWhenIdle={index < 3} key={resource.id}>
          <span className="row-handle" aria-hidden="true">⋮⋮</span>
          <span className="file-icon" aria-hidden="true">{fileLabel(resource.mimeType, resource.originalFilename)}</span>
          <div className="row-main">
            <strong className="resource-title"><HighlightedText segments={resource.highlights?.title} fallback={resource.title} /></strong>
            <p className="resource-description"><HighlightedText segments={resource.highlights?.description} fallback={resource.description || resource.originalFilename} /></p>
            <div className="row-meta">
              <span className="row-author">{resource.authorName}</span>
              <span aria-hidden="true">·</span>
              <time className="row-date" dateTime={resource.publishedAt.toISOString()}>{resource.publishedAt.toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" })}</time>
              <span aria-hidden="true">·</span>
              <span className="row-size">{formatBytes(resource.sizeBytes)}</span>
            </div>
          </div>
          <span className="row-trailing"><span className="tag">{resource.tags[0] ?? "Resource"}</span><span className="row-arrow" aria-hidden="true">↗</span></span>
        </Link>
      ))}
    </div>
  );
}
