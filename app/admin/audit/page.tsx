import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { AppShell } from "@/src/components/app-shell";
import { getDatabase } from "@/src/db";
import { auditLogs, users } from "@/src/db/schema";
import { getCurrentUser } from "@/src/lib/auth/session";

export default async function AuditPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/resources");
  const entries = await getDatabase().select({ id: auditLogs.id, actor: users.displayName, action: auditLogs.action, targetType: auditLogs.targetType, targetId: auditLogs.targetId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt }).from(auditLogs).leftJoin(users, eq(auditLogs.actorId, users.id)).orderBy(desc(auditLogs.createdAt)).limit(200);
  return <AppShell user={user} current="admin"><div className="content"><section className="hero"><div><h1>Audit log</h1><p>Recent moderation and governance actions. Sensitive tokens and signed URLs are never written here.</p></div></section>{entries.length === 0 ? <div className="empty"><h2>No audit events</h2></div> : <div className="data-list">{entries.map((entry) => <div className="data-row audit-row" key={entry.id}><div><strong>{entry.action}</strong><small>{entry.actor ?? "System"} · {entry.targetType} {entry.targetId ?? ""}</small><small>{JSON.stringify(entry.metadata)}</small></div><time>{entry.createdAt.toLocaleString("en")}</time></div>)}</div>}</div></AppShell>;
}
