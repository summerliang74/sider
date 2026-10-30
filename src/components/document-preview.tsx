"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

import type { FilePreviewKind } from "@/src/lib/file-preview";

import { BotChallenge } from "./bot-challenge";

type PreviewStatus = "idle" | "loading" | "ready" | "error";

export function DocumentPreview({
  resourceId,
  filename,
  kind,
}: {
  resourceId: string;
  filename: string;
  kind: FilePreviewKind;
}) {
  const documentRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [status, setStatus] = useState<PreviewStatus>("loading");
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("Loading secure preview…");
  const [challengeRequired, setChallengeRequired] = useState(false);

  const replaceObjectUrl = useCallback((next: string | null) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = next;
    setObjectUrl(next);
  }, []);

  const loadPreview = useCallback(async (botToken?: string) => {
    setStatus("loading");
    setMessage("Loading secure preview…");
    setChallengeRequired(false);
    setText("");
    replaceObjectUrl(null);
    documentRef.current?.replaceChildren();

    try {
      const response = await fetch(`/api/resources/${resourceId}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botToken: botToken || undefined }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (result.error === "bot_challenge_required") {
          setChallengeRequired(true);
          setStatus("idle");
          setMessage("Complete the check to open this preview.");
          return;
        }
        throw new Error(result.error || "preview_unavailable");
      }

      const blob = await response.blob();
      if (kind === "docx") {
        if (!documentRef.current) throw new Error("preview_container_missing");
        const { renderAsync } = await import("docx-preview");
        await renderAsync(await blob.arrayBuffer(), documentRef.current, documentRef.current, {
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          renderAltChunks: false,
          renderComments: false,
          useBase64URL: true,
        });
      } else if (kind === "text") {
        setText(await blob.text());
      } else {
        replaceObjectUrl(URL.createObjectURL(blob));
      }

      setStatus("ready");
      setMessage("");
    } catch {
      setStatus("error");
      setMessage("The document preview could not be loaded. You can still download the original file.");
    }
  }, [kind, replaceObjectUrl, resourceId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void loadPreview());
    return () => {
      cancelAnimationFrame(frame);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [loadPreview]);

  return (
    <section className="document-preview" aria-label="Document preview">
      <div className="preview-toolbar">
        <div>
          <strong>Document preview</strong>
          <span>{filename}</span>
        </div>
      </div>
      {message ? <p className={status === "error" ? "form-error" : "action-message"} role="status">{message}</p> : null}
      {challengeRequired ? (
        <div className="challenge">
          <BotChallenge action="download" onToken={(token) => { if (token) void loadPreview(token); }} />
        </div>
      ) : null}
      <div className={`preview-surface preview-${kind}`} aria-busy={status === "loading"}>
        {kind === "pdf" && objectUrl ? <iframe src={objectUrl} title={`Preview of ${filename}`} /> : null}
        {kind === "image" && objectUrl ? <Image src={objectUrl} alt={`Preview of ${filename}`} width={1600} height={1200} unoptimized /> : null}
        {kind === "text" && status === "ready" ? <pre>{text}</pre> : null}
        {kind === "docx" ? <div className="docx-preview-body" ref={documentRef} /> : null}
      </div>
    </section>
  );
}
