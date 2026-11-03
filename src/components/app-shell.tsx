import Link from "next/link";
import Image from "next/image";

import type { CurrentUser } from "@/src/lib/auth/session";
import { LogoutButton } from "./logout-button";

export function AppShell({
  user,
  current,
  title,
  children,
}: {
  user: CurrentUser;
  current: "resources" | "peer-advisors" | "mine" | "admin";
  title?: string;
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
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <Link href="/resources" className="brand" prefetch={false}>
          <Image src="/figma/sider-mark.svg" alt="" width={28} height={28} aria-hidden="true" />
          <span>Sider</span>
        </Link>
        <p className="workspace-label">SHSID student workspace</p>
        <nav className="nav" aria-label="Primary navigation">
          <div className="nav-section">
            <Link className={current === "resources" ? "selected" : undefined} aria-current={current === "resources" ? "page" : undefined} href="/resources" prefetch={false}><Image src="/figma/nav-resource.svg" alt="" width={20} height={20} aria-hidden="true" /><span>Resources</span></Link>
            <Link className={current === "mine" ? "selected" : undefined} aria-current={current === "mine" ? "page" : undefined} href="/me/resources" prefetch={false}><span className="nav-upload-mark" aria-hidden="true">↑</span><span>My uploads</span></Link>
          </div>
          <div className="nav-section nav-section-separated">
            <p className="nav-section-label">Peer support</p>
            <Link className={current === "peer-advisors" ? "selected" : undefined} aria-current={current === "peer-advisors" ? "page" : undefined} href="/resources?collection=peer-advisors" prefetch={false}><span className="nav-pa-mark" aria-hidden="true">PA</span><span>Peer Advisor</span></Link>
          </div>
          {user.role === "admin" ? <div className="nav-section nav-section-separated"><p className="nav-section-label">ADMINISTRATION</p><Link className={current === "admin" ? "selected" : undefined} href="/admin/reports" prefetch={false}>⚑ <span>Reports</span></Link><Link href="/admin/audit" prefetch={false}>☷ <span>Audit log</span></Link></div> : null}
        </nav>
        <div className="sidebar-note">
          <strong>Private workspace</strong>
          <p>Available to SHSID students through Launchpad.</p>
        </div>
        <div className="profile">
          <span className="avatar" aria-hidden="true">{initials || "S"}</span>
          <span className="profile-copy"><strong>{user.displayName}</strong><small>{user.role}</small></span>
          <LogoutButton ariaLabel="Sign out" title="Sign out">↪</LogoutButton>
        </div>
      </aside>
      <main className="main" id="main-content" tabIndex={-1}>
        <header className="topbar">
          <Link className="mobile-brand" href="/resources" prefetch={false}><Image src="/figma/sider-mark.svg" alt="" width={28} height={28} aria-hidden="true" /> Sider</Link>
          <div className="breadcrumbs"><span>Workspace</span><span aria-hidden="true">/</span><span>{title ?? (current === "resources" ? "Resources" : current === "peer-advisors" ? "Peer Advisor" : current === "mine" ? "My uploads" : "Reports")}</span></div>
          <div className="top-meta"><Image src="/figma/verified-dot.svg" alt="" width={8} height={8} aria-hidden="true" /> Private &amp; SHSID-only</div>
          <details className="mobile-menu">
            <summary className="button">Menu <span aria-hidden="true">☰</span></summary>
            <nav className="mobile-links" aria-label="Mobile navigation">
              <Link aria-current={current === "resources" ? "page" : undefined} href="/resources" prefetch={false}>Resources</Link>
              <Link aria-current={current === "peer-advisors" ? "page" : undefined} href="/resources?collection=peer-advisors" prefetch={false}>Peer Advisor</Link>
              <Link aria-current={current === "mine" ? "page" : undefined} href="/me/resources" prefetch={false}>My uploads</Link>
              {user.role === "admin" ? <><Link href="/admin/reports" prefetch={false}>Reports</Link><Link href="/admin/audit" prefetch={false}>Audit log</Link></> : null}
              <LogoutButton>Sign out</LogoutButton>
            </nav>
          </details>
        </header>
        {children}
      </main>
    </div>
  );
}
