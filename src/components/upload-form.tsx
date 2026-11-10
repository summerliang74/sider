"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TagPicker } from "./tag-picker";
import { BotChallenge } from "./bot-challenge";
import { browserUploadTransport, uploadStatusResponse } from "@/src/lib/upload-client";
import { UploadQueue, type UploadItem } from "@/src/lib/upload-queue";

export function UploadForm({ isAdmin = false, maxBytes = 50 * 1024 * 1024 }: { isAdmin?: boolean; maxBytes?: number }) {
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [message, setMessage] = useState("");
  const [pollMessage, setPollMessage] = useState("");
  const [batchNumber, setBatchNumber] = useState(0);
  const queue = useRef<UploadQueue | null>(null);
  const itemsRef = useRef(items);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => () => queue.current?.dispose(), []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      let nextDelay = 5_000;
      const ids = itemsRef.current.filter((item) => item.stage === "scanning").map((item) => item.resourceId!);
      if (ids.length && document.visibilityState === "visible") {
        try {
          const response = await fetch("/api/resources/upload-status", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
          });
          if (response.status === 429) nextDelay = Math.max(5_000, Number(response.headers.get("retry-after") || 60) * 1000);
          if (!response.ok) throw new Error("status_unavailable");
          const result = uploadStatusResponse.parse(await response.json());
          if (!stopped) { queue.current?.updateStatuses(result.items); setPollMessage(""); }
        } catch { if (!stopped) setPollMessage("Status updates are temporarily unavailable. Your files remain private until checks pass. You can also check My uploads."); }
      }
      if (!stopped) timer = setTimeout(poll, nextDelay);
    }
    timer = setTimeout(poll, 5_000);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (queue.current) return;
    if (!files.length || files.length > 5 || files.some((file) => !file.size || file.size > maxBytes)) {
      setMessage(`Choose 1–5 non-empty files, each no larger than ${formatBytes(maxBytes)}.`); return;
    }
    const data = new FormData(event.currentTarget);
    queue.current = new UploadQueue(files, {
      title: String(data.get("title") ?? ""), description: String(data.get("description") ?? ""),
      tags: String(data.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
    }, browserUploadTransport, setItems);
    setMessage(""); queue.current.start();
  }
  const transferring = items.some((item) => ["queued", "preparing", "uploading", "completing"].includes(item.stage));
  const hasBatch = items.length > 0;
  return <form ref={formRef} className="upload-form" onSubmit={submit}>
    <fieldset disabled={hasBatch} className="upload-fields">
      <label className="field"><span>Title</span><input name="title" required minLength={1} maxLength={120} placeholder="Enter a clear resource title" /><small>Keep it specific and easy to scan.</small></label>
      <label className="field"><span>Description</span><textarea name="description" maxLength={2000} rows={5} placeholder="Describe what this resource covers" /><small>A short summary helps classmates judge relevance.</small></label>
      <TagPicker key={batchNumber} isAdmin={isAdmin} />
      <label className="field file-field"><span>FILES (5 files at most)</span><span className={`dropzone${files.length ? " selected" : ""}`}><strong>{files.length ? files.map((file) => file.name).join(", ") : "Choose up to 5 files from your device"}</strong><small>PDF, Office, text, PNG or JPEG · up to {formatBytes(maxBytes)} per file</small><input name="file" type="file" multiple required accept=".pdf,.docx,.pptx,.xlsx,.txt,.png,.jpg,.jpeg" onChange={(event) => { const selected = Array.from(event.currentTarget.files ?? []); event.currentTarget.setCustomValidity(selected.length > 5 ? "Choose at most 5 files." : ""); setFiles(selected); }} /></span><small>Each file becomes a separate resource with the same title, description and tags.</small></label>
    </fieldset>
    {message ? <p className="form-error" role="alert">{message}</p> : null}
    {hasBatch ? <ul className="upload-queue" aria-label="File upload progress">{items.map((item) => <li key={item.id} className="upload-queue-item">
      <div><strong>{item.file.name}</strong><small>{formatBytes(item.file.size)}</small></div>
      <p role="status">{stageLabel(item)}</p>
      {item.stage === "uploading" ? <progress max={100} value={item.progress} aria-label={`${item.file.name} upload progress`} /> : null}
      {item.message ? <p className="form-error" role="alert">{item.message}</p> : null}
      {item.challenge ? <BotChallenge key={`${item.id}-${item.challenge}`} action={item.challenge} onToken={(token) => { if (token) queue.current?.retry(item.id, token); }} /> : null}
      <div className="upload-item-actions">
        {item.stage === "error" && !item.challenge ? <button className="button" type="button" onClick={() => queue.current?.retry(item.id)}>Retry this file</button> : null}
        {!["active", "quarantined", "cancelled"].includes(item.stage) ? <button className="button" type="button" onClick={() => void queue.current?.cancel(item.id)}>Cancel</button> : null}
        {item.stage === "active" ? <Link href={`/resources/${item.resourceId}`}>View resource</Link> : null}
      </div>
    </li>)}</ul> : null}
    {pollMessage ? <p role="status">{pollMessage}</p> : null}
    <div className="form-bottom"><small>{transferring ? "Keep this page open while files are uploading." : hasBatch ? "Uploaded files are checked in the background. You can leave this page and check My uploads." : "Files remain private until the safety check passes."}</small>
      {!hasBatch ? <button className="button primary" type="submit">Upload resources</button> : <Link className="button" href="/me/resources">My uploads</Link>}
    </div>
    {hasBatch && !transferring ? <button className="button" type="button" onClick={() => { queue.current?.dispose(); queue.current = null; setItems([]); setFiles([]); setPollMessage(""); formRef.current?.reset(); setBatchNumber((value) => value + 1); }}>Start another batch</button> : null}
  </form>;
}

function formatBytes(bytes: number) { return bytes < 1024 ** 2 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
function stageLabel(item: UploadItem) {
  const labels = { queued: "Waiting to upload", preparing: "Preparing…", uploading: `Uploading… ${item.progress}%`, completing: "Confirming upload…", scanning: "Uploaded · safety check in progress", active: "Published", error: "Needs attention", quarantined: "Unavailable", cancelled: "Cancelled" };
  return labels[item.stage];
}
