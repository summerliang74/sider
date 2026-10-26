"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminReportActions({ reportId, resourceId, authorId, status }: { reportId: string; resourceId: string; authorId: string; status: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");

  async function moderate(action: "hide" | "restore" | "remove") {
    const reason = window.prompt("Reason for this moderation action:");
    if (!reason?.trim()) return;
    const response = await fetch(`/api/admin/resources/${resourceId}/moderate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, reason, reportId }) });
    setMessage(response.ok ? "Action recorded." : "The action could not be completed.");
    if (response.ok) router.refresh();
  }

  async function suspend() {
    const reason = window.prompt("Reason for suspending this resource author:");
    if (!reason?.trim()) return;
    const response = await fetch(`/api/admin/users/${authorId}/suspend`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
    setMessage(response.ok ? "User suspended and active sessions revoked." : "The user could not be suspended.");
  }

  async function dismiss() {
    const note = window.prompt("Why is this report being dismissed?");
    if (!note?.trim()) return;
    const response = await fetch(`/api/admin/reports/${reportId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note }) });
    setMessage(response.ok ? "Report dismissed." : "The report could not be dismissed.");
    if (response.ok) router.refresh();
  }

  return <div><div className="action-row">{status === "active" ? <button className="button" type="button" onClick={() => moderate("hide")}>Hide</button> : null}{status === "hidden" ? <button className="button" type="button" onClick={() => moderate("restore")}>Restore</button> : null}<button className="button danger" type="button" onClick={() => moderate("remove")}>Remove</button><button className="button" type="button" onClick={dismiss}>Dismiss report</button><button className="button danger" type="button" onClick={suspend}>Suspend author</button></div>{message ? <p className="action-message" role="status">{message}</p> : null}</div>;
}
