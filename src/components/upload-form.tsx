"use client";

import { FormEvent, useRef, useState } from "react";
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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const uploadBatch = useRef<{ data: FormData; files: File[]; index: number; resourceId?: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const files = data.getAll("file").filter((value): value is File => value instanceof File && value.size > 0);
    if (!uploadBatch.current && (files.length === 0 || files.length > 5)) {
      setStage("error");
      setMessage("Choose between 1 and 5 files before uploading.");
      return;
    }
    if (!uploadBatch.current) uploadBatch.current = { data, files, index: 0 };
    await uploadNext(botToken);
  }

  async function uploadNext(token?: string) {
    const batch = uploadBatch.current;
    if (!batch) return;
    if (batch.resourceId) {
      await finishComplete(batch.resourceId);
      return;
    }
    const { data } = batch;
    const file = batch.files[batch.index];
    if (!file) {
      uploadBatch.current = null;
      setStage("error");
      setMessage("The upload queue is invalid. Choose the files again.");
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
          botToken: token || undefined,
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
    if (uploadBatch.current) uploadBatch.current.resourceId = intent.resourceId;
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
    const batch = uploadBatch.current;
    if (batch) {
      batch.index += 1;
      batch.resourceId = undefined;
      if (batch.index < batch.files.length) {
        await uploadNext();
        return;
      }
    }
    uploadBatch.current = null;
    router.push(batch && batch.files.length > 1 ? "/me/resources" : `/resources/${resourceId}`);
    router.refresh();
  }

  const busy = ["preparing", "uploading", "scanning"].includes(stage);
  const submitLabel = stage === "preparing" ? "Preparing…" : stage === "uploading" ? "Uploading…" : stage === "scanning" ? "Scanning…" : "Upload resource";
  return <form className="upload-form" onSubmit={submit} aria-busy={busy}>
    <label className="field"><span>Title</span><input name="title" required minLength={1} maxLength={120} placeholder="Enter a clear resource title" /><small>Keep it specific and easy to scan.</small></label>
    <label className="field"><span>Description</span><textarea name="description" maxLength={2000} rows={5} placeholder="Describe what this resource covers" /><small>A short summary helps classmates judge relevance.</small></label>
    <TagPicker isAdmin={isAdmin} />
    <label className="field file-field"><span>FILES (5 files at most)</span><span className={`dropzone${selectedFiles.length ? " selected" : ""}`}><strong>{selectedFiles.length ? selectedFiles.map((file) => file.name).join(", ") : "Choose up to 5 files from your device"}</strong><small>{selectedFiles.length ? `${selectedFiles.length} files · ${formatBytes(selectedFiles.reduce((total, file) => total + file.size, 0))}` : "PDF, Office, text, PNG or JPEG · up to 50 MB per file"}</small><input name="file" type="file" multiple required disabled={busy || uploadBatch.current !== null} accept=".pdf,.docx,.pptx,.xlsx,.txt,.png,.jpg,.jpeg" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.setCustomValidity(files.length > 5 ? "Choose at most 5 files." : ""); setSelectedFiles(files); }} /></span><small>All files share the same title, description and tags.</small></label>
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
