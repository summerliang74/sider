import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/src/components/app-shell";
import { UploadForm } from "@/src/components/upload-form";
import { getCurrentUser } from "@/src/lib/auth/session";
import { getServerEnv } from "@/src/lib/env";

export default async function NewResourcePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const uploadsEnabled = getServerEnv().malwareScanEnabled;
  return (
    <AppShell user={user} current="resources" title="Upload resource">
      <div className="content upload-page">
        <Link className="back" href="/resources">←&nbsp; Back to resources</Link>
        <div className="upload-columns">
          <section className="upload-main">
            <p className="eyebrow">SHARE KNOWLEDGE</p>
            <h1>Upload a resource</h1>
            <p className="upload-intro">Add a useful file to the shared shelf. Every upload is validated and scanned before other students can see it.</p>
            {uploadsEnabled ? <UploadForm /> : <div className="empty"><h2>Uploads temporarily unavailable</h2><p>The malware scanning service has not been configured. Sign-in and existing resources remain available, but new files cannot be accepted safely.</p></div>}
          </section>
          <aside className="upload-guidance">
            <p className="eyebrow">BEFORE YOU SHARE</p>
            <h2>Make it useful, safe, and easy to find.</h2>
            <div className="guidance-item"><span>01</span><div><strong>Use a specific title</strong><p>Mention the subject and what the file contains.</p></div></div>
            <div className="guidance-item"><span>02</span><div><strong>Remove personal data</strong><p>Check names, IDs, comments, and hidden metadata.</p></div></div>
            <div className="guidance-item"><span>03</span><div><strong>Add focused tags</strong><p>Three to five precise tags are usually enough.</p></div></div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
