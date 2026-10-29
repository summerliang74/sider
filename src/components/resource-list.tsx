import Link from "next/link";
import Image from "next/image";

import type { ResourceListItem } from "@/src/lib/resources";

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

export function ResourceList({ items }: { items: ResourceListItem[] }) {
  if (items.length === 0) {
    return <div className="empty"><h2>No resources found</h2><p>Try a shorter search or check the spelling.</p></div>;
  }
  return (
    <div className="resource-list">
      {items.map((resource) => (
        <article className="resource-row" key={resource.id}>
          <Image className="drag-handle" src="/figma/drag-handle.svg" alt="" width={14} height={24} aria-hidden="true" />
          <span className="file-icon" aria-hidden="true">{fileLabel(resource.mimeType, resource.originalFilename)}</span>
          <div className="row-main">
            <Link className="resource-title" href={`/resources/${resource.id}?source=search`}>{resource.title}</Link>
            <p className="resource-description">{resource.description || resource.originalFilename}</p>
          </div>
          <span className="row-author">{resource.authorName}</span>
          <time className="row-date" dateTime={resource.publishedAt.toISOString()}>{resource.publishedAt.toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" })}</time>
          <span className="tag">{resource.tags[0] ?? "Resource"}</span>
          <span className="row-size">{formatBytes(resource.sizeBytes)}</span>
          <span className="row-more" aria-hidden="true">•••</span>
        </article>
      ))}
    </div>
  );
}
