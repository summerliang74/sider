"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { preconnect } from "react-dom";

import { BotChallenge } from "./bot-challenge";

export function ResourceActions({ resourceId, isOwner, canDownload, downloadOrigin, initial }: { resourceId: string; isOwner: boolean; canDownload: boolean; downloadOrigin: string; initial: { title: string; description: string; tags: string[] } }) {
  preconnect(downloadOrigin);
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [challengeAction, setChallengeAction] = useState<"download" | "report" | null>(null);
  const [botToken, setBotToken] = useState("");

  async function download() {
    setMessage("Preparing a private download link…");
    const response = await fetch(`/api/resources/${resourceId}/download`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ botToken: botToken || undefined }) });
    const result = await response.json() as { url?: string; error?: string };
    if (result.error === "bot_challenge_required") { setChallengeAction("download"); setBotToken(""); setMessage("Complete the check and try downloading again."); return; }
    if (!response.ok || !result.url) { setMessage("The download is not available right now."); return; }
    setChallengeAction(null);
    setBotToken("");
    window.location.assign(result.url);
    setMessage("");
  }

  async function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await fetch(`/api/resources/${resourceId}/reports`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: data.get("reason"), details: data.get("details"), botToken: botToken || undefined }) });
    const result = await response.json() as { error?: string };
    if (result.error === "bot_challenge_required") { setChallengeAction("report"); setBotToken(""); setMessage("Complete the check and submit the report again."); return; }
    setMessage(response.ok ? "Report submitted for administrator review." : result.error === "report_already_open" ? "You already have an open report for this resource." : "The report could not be submitted.");
    if (response.ok) { setReporting(false); setChallengeAction(null); setBotToken(""); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await fetch(`/api/resources/${resourceId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: data.get("title"), description: data.get("description"), tags: String(data.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean) }) });
    setMessage(response.ok ? "Resource details updated." : "The changes could not be saved.");
    if (response.ok) { setEditing(false); router.refresh(); }
  }

  async function remove() {
    if (!window.confirm("Delete this resource? New download links will stop immediately.")) return;
    const response = await fetch(`/api/resources/${resourceId}`, { method: "DELETE" });
    if (response.ok) router.push("/me/resources"); else setMessage("The resource could not be deleted.");
  }

  return <section className="resource-actions" aria-label="Resource actions">
    <div className="action-row">{canDownload ? <button className="button primary" type="button" onClick={download}>Download</button> : null}{isOwner ? <><button className="button" type="button" onClick={() => setEditing(!editing)}>Edit details</button><button className="button danger" type="button" onClick={remove}>Delete</button></> : <button className="button" type="button" onClick={() => { setReporting(!reporting); setChallengeAction(null); setBotToken(""); }}>Report</button>}</div>
    {challengeAction ? <div className="challenge"><BotChallenge action={challengeAction} onToken={setBotToken} /></div> : null}
    {message ? <p className="action-message" role="status">{message}</p> : null}
    {reporting ? <form className="inline-form" onSubmit={report}><label className="field"><span>Reason</span><select name="reason" required><option value="copyright_privacy">Copyright or privacy</option><option value="malware">Malicious file</option><option value="inappropriate">Inappropriate content</option><option value="spam">Spam</option><option value="other">Other</option></select></label><label className="field"><span>Details</span><textarea name="details" maxLength={1000} rows={3} /></label><button className="button" type="submit" disabled={challengeAction === "report" && !botToken}>Submit report</button></form> : null}
    {editing ? <form className="inline-form" onSubmit={save}><label className="field"><span>Title</span><input name="title" defaultValue={initial.title} required maxLength={120} /></label><label className="field"><span>Description</span><textarea name="description" defaultValue={initial.description} maxLength={2000} rows={4} /></label><label className="field"><span>Tags</span><input name="tags" defaultValue={initial.tags.join(", ")} /></label><button className="button" type="submit">Save changes</button></form> : null}
  </section>;
}
