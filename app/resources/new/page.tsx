import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/src/components/app-shell";
import { UploadForm } from "@/src/components/upload-form";
import { getCurrentUser } from "@/src/lib/auth/session";

export default async function NewResourcePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <AppShell user={user} current="resources"><div className="content detail"><Link className="back" href="/resources">← Back to resources</Link><p className="eyebrow">Share knowledge</p><h1 className="detail-title">Upload a resource</h1><p className="auth-intro">Add useful context so classmates can find the file. It will appear publicly only after storage validation and malware scanning.</p><UploadForm /></div></AppShell>;
}
