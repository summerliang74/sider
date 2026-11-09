function ResourceRowsSkeleton() {
  return <div className="resource-list" aria-hidden="true">
    {Array.from({ length: 5 }, (_, index) => <div className="resource-row" key={index}>
      <span className="row-handle" />
      <span className="file-icon skeleton-block" />
      <div className="row-main skeleton-copy">
        <span className="skeleton-block skeleton-title" />
        <span className="skeleton-block skeleton-description" />
        <span className="skeleton-block skeleton-meta" />
      </div>
      <span className="row-trailing"><span className="skeleton-block skeleton-tag" /></span>
    </div>)}
  </div>;
}

export function ResourceSearchSkeleton() {
  return <div role="status" aria-label="Loading resources">
    <span className="sr-only">Loading resources…</span>
    <div aria-hidden="true">
      <div className="searchbox"><span className="skeleton-block skeleton-title" /></div>
      <div className="library-controls"><span className="skeleton-block skeleton-filter" /><span className="skeleton-block skeleton-filter" /></div>
      <div className="results-heading"><span className="skeleton-block skeleton-meta" /></div>
    </div>
    <ResourceRowsSkeleton />
  </div>;
}

export function WorkspaceLoading({ label = "Loading page" }: { label?: string }) {
  return <div className="shell" role="status" aria-label={label}>
    <span className="sr-only">{label}…</span>
    <aside className="sidebar" aria-hidden="true">
      <span className="skeleton-block skeleton-heading" />
      <div className="nav"><span className="skeleton-block skeleton-nav" /><span className="skeleton-block skeleton-nav" /></div>
    </aside>
    <div className="main" aria-hidden="true">
      <div className="topbar"><span className="skeleton-block skeleton-meta" /></div>
      <div className="content">
        <div className="page-heading"><span className="skeleton-block skeleton-heading" /></div>
        <ResourceRowsSkeleton />
      </div>
    </div>
  </div>;
}
