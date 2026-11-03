import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { AdminReportActions } from "@/src/components/admin-report-actions";
import { AppShell } from "@/src/components/app-shell";
import { getDatabase } from "@/src/db";
import { resourceReports, resources, users } from "@/src/db/schema";
import { getCurrentUser } from "@/src/lib/auth/session";

export default async function ReportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/resources");
  const reports = await getDatabase().select({ id: resourceReports.id, resourceId: resources.id, resourceTitle: resources.title, resourceStatus: resources.status, authorId: resources.authorId, reporter: users.displayName, reason: resourceReports.reason, details: resourceReports.details, createdAt: resourceReports.createdAt }).from(resourceReports).innerJoin(resources, eq(resourceReports.resourceId, resources.id)).innerJoin(users, eq(resourceReports.reporterId, users.id)).where(eq(resourceReports.status, "open")).orderBy(asc(resourceReports.createdAt)).limit(100);
  return <AppShell user={user} current="admin"><div className="content"><section className="hero"><div><h1>Reports</h1><p>Review open reports, control resource visibility, and suspend abusive accounts. Every action is audited.</p></div></section>{reports.length === 0 ? <div className="empty"><h2>No open reports</h2><p>The moderation queue is clear.</p></div> : <div className="report-list">{reports.map((report) => <article className="report-card" key={report.id}><div className="report-heading"><div><strong>{report.resourceTitle}</strong><small>Reported by {report.reporter} · {report.createdAt.toLocaleString("en")}</small></div><span className={`status ${report.resourceStatus}`}>{report.resourceStatus}</span></div><p><strong>{report.reason.replaceAll("_", " ")}</strong>{report.details ? ` — ${report.details}` : ""}</p><AdminReportActions reportId={report.id} resourceId={report.resourceId} authorId={report.authorId} status={report.resourceStatus} /></article>)}</div>}</div></AppShell>;
}
