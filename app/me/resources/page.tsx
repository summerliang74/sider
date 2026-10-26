import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/src/components/app-shell";
import { getDatabase } from "@/src/db";
import { resources } from "@/src/db/schema";
import { getCurrentUser } from "@/src/lib/auth/session";

export default async function MyResourcesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const items = await getDatabase()
    .select({ id: resources.id, title: resources.title, filename: resources.originalFilename, status: resources.status, createdAt: resources.createdAt })
    .from(resources)
    .where(eq(resources.authorId, user.id))
    .orderBy(desc(resources.createdAt))
    .limit(100);

  return <AppShell user={user} current="mine"><div className="content"><section className="hero"><div><p className="eyebrow">Your work</p><h1>My uploads</h1><p>Track every upload, including files still scanning or unavailable to others.</p></div><Link className="button" href="/resources/new">Upload resource</Link></section>{items.length === 0 ? <div className="empty"><h2>No uploads yet</h2><p>Upload your first resource when you are ready.</p><Link className="button" href="/resources/new">Start an upload</Link></div> : <div className="data-list">{items.map((item) => <div className="data-row" key={item.id}><div><strong>{item.status !== "deleted" ? <Link href={`/resources/${item.id}`}>{item.title}</Link> : item.title}</strong><small>{item.filename}</small></div><span className={`status ${item.status}`}>{item.status}</span></div>)}</div>}</div></AppShell>;
}
