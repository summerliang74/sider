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
  current: "resources" | "mine" | "admin";
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
      <aside className="sidebar">
        <Link href="/resources" className="brand" prefetch={false}>
          <Image src="/figma/sider-mark.svg" alt="" width={28} height={28} aria-hidden="true" />
          <span>Sider</span>
        </Link>
        <p className="workspace-label">STUDENT RESOURCE HUB</p>
        <nav className="nav" aria-label="Primary navigation">
          <Link className={current === "resources" ? "selected" : undefined} href="/resources" prefetch={false}><Image src="/figma/nav-resource.svg" alt="" width={20} height={20} aria-hidden="true" /><span>Resources</span></Link>
          <Link className={current === "mine" ? "selected" : undefined} href="/me/resources" prefetch={false}><Image src="/figma/nav-resource.svg" alt="" width={20} height={20} aria-hidden="true" /><span>My uploads</span></Link>
          {user.role === "admin" ? <><Link className={current === "admin" ? "selected" : undefined} href="/admin/reports" prefetch={false}>⚑ <span>Reports</span></Link><Link href="/admin/audit" prefetch={false}>☷ <span>Audit log</span></Link></> : null}
        </nav>
        <div className="sidebar-note">
          <strong>Private workspace</strong>
          <p>Available only to verified SHSID students.</p>
        </div>
        <div className="profile">
          <span className="avatar" aria-hidden="true">{initials || "S"}</span>
          <span className="profile-copy"><strong>{user.displayName}</strong><small>{user.role}</small></span>
          <LogoutButton ariaLabel="Sign out" title="Sign out">↪</LogoutButton>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <Link className="mobile-brand" href="/resources" prefetch={false}><Image src="/figma/sider-mark.svg" alt="" width={28} height={28} aria-hidden="true" /> Sider</Link>
          <div className="breadcrumbs"><span>Workspace</span><span aria-hidden="true">/</span><span>{title ?? (current === "resources" ? "Resources" : current === "mine" ? "My uploads" : "Reports")}</span></div>
          <div className="top-meta"><Image src="/figma/verified-dot.svg" alt="" width={8} height={8} aria-hidden="true" /> Private &amp; verified</div>
          <nav className="mobile-links" aria-label="Mobile navigation"><Link href="/resources" prefetch={false}>Resources</Link><Link href="/me/resources" prefetch={false}>My uploads</Link>{user.role === "admin" ? <Link href="/admin/reports" prefetch={false}>Admin</Link> : null}<LogoutButton>Sign out</LogoutButton></nav>
        </header>
        {children}
      </main>
    </div>
  );
}
