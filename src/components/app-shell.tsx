import Link from "next/link";

import type { CurrentUser } from "@/src/lib/auth/session";

export function AppShell({
  user,
  current,
  children,
}: {
  user: CurrentUser;
  current: "resources" | "mine" | "admin";
  children: React.ReactNode;
}) {
  const initials = user.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/resources" className="brand">
          <span className="monogram" aria-hidden="true">S</span>
          <span>SHSID Online</span>
        </Link>
        <p className="workspace-label">Student resource hub</p>
        <nav className="nav" aria-label="Primary navigation">
          <Link className={current === "resources" ? "selected" : undefined} href="/resources">⌕ <span>Resources</span></Link>
          <Link className={current === "mine" ? "selected" : undefined} href="/me/resources">▤ <span>My uploads</span></Link>
          {user.role === "admin" ? <><Link className={current === "admin" ? "selected" : undefined} href="/admin/reports">⚑ <span>Reports</span></Link><Link href="/admin/audit">☷ <span>Audit log</span></Link></> : null}
        </nav>
        <div className="sidebar-note">
          <strong>Private workspace</strong>
          <p>Available only to verified SHSID students.</p>
        </div>
        <div className="profile">
          <span className="avatar" aria-hidden="true">{initials || "S"}</span>
          <span className="profile-copy"><strong>{user.displayName}</strong><small>{user.role}</small></span>
          <form action="/api/auth/logout" method="post"><button type="submit" aria-label="Sign out" title="Sign out">↪</button></form>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <Link className="mobile-brand" href="/resources"><span className="monogram" aria-hidden="true">S</span> SHSID Online</Link>
          <div className="breadcrumbs"><span>Workspace</span><span aria-hidden="true">/</span><span>{current === "resources" ? "Resources" : current === "mine" ? "My uploads" : "Reports"}</span></div>
          <div className="top-meta"><span className="dot" aria-hidden="true" /> Private &amp; verified</div>
          <nav className="mobile-links" aria-label="Mobile navigation"><Link href="/resources">Resources</Link><Link href="/me/resources">My uploads</Link>{user.role === "admin" ? <Link href="/admin/reports">Admin</Link> : null}<form action="/api/auth/logout" method="post"><button type="submit">Sign out</button></form></nav>
        </header>
        {children}
      </main>
    </div>
  );
}
