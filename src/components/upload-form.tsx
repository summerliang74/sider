"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { TagPicker } from "./tag-picker";
import { BotChallenge } from "./bot-challenge";

type Stage = "idle" | "preparing" | "uploading" | "scanning" | "done" | "error";

export function UploadForm({ isAdmin = false }: { isAdmin?: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [message, setMessage] = useState("");
  const [challengeAction, setChallengeAction] = useState<"upload" | "complete" | null>(null);
  const [botToken, setBotToken] = useState("");
  const [pendingCompleteId, setPendingCompleteId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setStage("error");
      setMessage("Choose a file before uploading.");
      return;
    }
    setMessage("");
    setStage("preparing");
    let intentResponse: Response;
    try {
      intentResponse = await fetch("/api/resources/upload-intents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: data.get("title"),
          description: data.get("description"),
          tags: String(data.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
          originalFilename: file.name,
          sizeBytes: file.size,
          mimeType: file.type || "application/octet-stream",
          botToken: botToken || undefined,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      setStage("error");
      setMessage("The upload could not be prepared. Check your connection and try again.");
      return;
    }
    const intent = await intentResponse.json().catch(() => ({})) as { error?: string; resourceId?: string; uploadUrl?: string; headers?: Record<string, string> };
    if (!intentResponse.ok || !intent.resourceId || !intent.uploadUrl || !intent.headers) {
      if (intent.error === "bot_challenge_required") setChallengeAction("upload");
      setStage("error");
      setMessage(readableError(intent.error));
      return;
    }

    setChallengeAction(null);
    setBotToken("");
    setStage("uploading");
    let upload: Response;
    try {
      upload = await fetch(intent.uploadUrl, { method: "PUT", headers: intent.headers, body: file, signal: AbortSignal.timeout(120_000) });
    } catch {
      setStage("error");
      setMessage("The upload timed out. Please check your connection and try again.");
      return;
    }
    if (upload.status === 401) {
      setStage("error");
      setMessage("Your session expired. Please sign in again.");
      router.push("/login");
      router.refresh();
      return;
    }
    if (!upload.ok) {
      setStage("error");
      setMessage("The storage service rejected the upload. Your file was not published.");
      return;
    }

    setStage("scanning");
    await finishComplete(intent.resourceId);
  }

  async function finishComplete(resourceId: string, token?: string) {
    setStage("scanning");
    let completeResponse: Response;
    try {
      completeResponse = await fetch(`/api/resources/${resourceId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botToken: token || undefined }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      setStage("error");
      setMessage("The safety scan is taking longer than expected. The file remains private; check My uploads for its status.");
      return;
    }
    const complete = await completeResponse.json().catch(() => ({})) as { status?: string; error?: string };
    if (!completeResponse.ok || complete.status !== "active") {
      if (complete.error === "bot_challenge_required") {
        setChallengeAction("complete");
        setPendingCompleteId(resourceId);
        setStage("error");
        setMessage("Please complete the traffic check so the uploaded file can be scanned.");
        return;
      }
      setStage("error");
      setMessage(complete.status === "quarantined" ? "The file could not pass the safety scan and was quarantined." : readableError(complete.error));
      return;
    }
    setStage("done");
    setChallengeAction(null);
    setPendingCompleteId(null);
    router.push(`/resources/${resourceId}`);
    router.refresh();
  }

  const busy = ["preparing", "uploading", "scanning"].includes(stage);
  const submitLabel = stage === "preparing" ? "Preparing…" : stage === "uploading" ? "Uploading…" : stage === "scanning" ? "Scanning…" : "Upload resource";
  return <form className="upload-form" onSubmit={submit} aria-busy={busy}>
    <label className="field"><span>Title</span><input name="title" required minLength={1} maxLength={120} placeholder="Enter a clear resource title" /><small>Keep it specific and easy to scan.</small></label>
    <label className="field"><span>Description</span><textarea name="description" maxLength={2000} rows={5} placeholder="Describe what this resource covers" /><small>A short summary helps classmates judge relevance.</small></label>
    <TagPicker isAdmin={isAdmin} />
    <label className="field file-field"><span>FILE</span><span className={`dropzone${selectedFile ? " selected" : ""}`}><strong>{selectedFile ? selectedFile.name : "Drop a file here, or choose from your device"}</strong><small>{selectedFile ? `${formatBytes(selectedFile.size)} · choose another file to replace it` : "PDF, Office, text, PNG or JPEG · up to 50 MB"}</small><input name="file" type="file" required accept=".pdf,.docx,.pptx,.xlsx,.txt,.png,.jpg,.jpeg" onChange={(event) => setSelectedFile(event.currentTarget.files?.[0] ?? null)} /></span></label>
    {challengeAction ? <div className="challenge"><p>Please complete this check to continue.</p><BotChallenge action={challengeAction} onToken={(token) => { setBotToken(token); if (challengeAction === "complete" && pendingCompleteId && token) void finishComplete(pendingCompleteId, token); }} /></div> : null}
    {message ? <p className="form-error" role="alert">{message}</p> : null}
    <div className="form-bottom"><small aria-live="polite">{stage === "preparing" ? "Preparing secure upload…" : stage === "uploading" ? "Uploading securely…" : stage === "scanning" ? "Scanning the file before publication…" : stage === "done" ? "Published." : "Files remain private until the scan passes."}</small><button className="button primary" type="submit" disabled={busy || (challengeAction === "upload" && !botToken) || challengeAction === "complete"}>{submitLabel}</button></div>
  </form>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function readableError(error?: string): string {
  const messages: Record<string, string> = {
    pa_tag_admin_only: "Only administrators can assign the PA tag.",
    file_too_large: "This file is larger than the allowed limit.",
    file_type_not_allowed: "This file type is not allowed.",
    bot_challenge_required: "Additional verification is required because this request looks unusual.",
    rate_limited: "Too many requests. Please wait and try again.",
    uploads_disabled: "Uploads are unavailable until the malware scanning service is configured.",
  };
  return messages[error ?? ""] ?? "The request could not be completed. Please try again.";
}
