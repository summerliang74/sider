import { z } from "zod";
import { UploadError, type UploadTransport } from "./upload-queue";

const resourceStatus = z.enum(["pending", "scanning", "active", "hidden", "quarantined", "failed", "deleted"]);
const intentResponse = z.object({ resourceId: z.uuid(), uploadUrl: z.url().refine((value) => new URL(value).protocol === "https:"), headers: z.record(z.string(), z.string()) });
const completionResponse = z.object({ id: z.uuid(), status: resourceStatus });
export const uploadStatusResponse = z.object({ items: z.array(completionResponse).max(5) });

async function jsonRequest(path: string, body: unknown, signal: AbortSignal, action: "upload" | "complete") {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
  const data: unknown = await response.json().catch(() => null);
  if (response.ok) return data;
  const failure = z.object({ error: z.string() }).safeParse(data);
  const errorCode = failure.success ? failure.data.error : "unknown";
  if (errorCode === "bot_challenge_required") throw new UploadError("Complete the traffic check to continue this file.", action);
  const messages: Record<string, string> = {
    unauthorized: "Your session expired. Sign in again before retrying.",
    rate_limited: "Too many requests. Wait before retrying this file.",
    file_too_large: "This file exceeds the upload limit.",
    file_type_not_allowed: "This file type is not supported.",
    pa_tag_admin_only: "Only administrators can assign the PA tag.",
    upload_expired: "This upload expired. Choose the file again in a new batch.",
    object_mismatch: "The stored file did not match the upload. Start a new batch for this file.",
    uploads_disabled: "Uploads are temporarily unavailable.",
  };
  throw new UploadError(messages[errorCode] ?? "The request failed. Retry this file or check My uploads.");
}

export const browserUploadTransport: UploadTransport = {
  async intent(file, metadata, signal, token) {
    const result = await jsonRequest("/api/resources/upload-intents", { ...metadata, originalFilename: file.name, sizeBytes: file.size, mimeType: file.type || "application/octet-stream", botToken: token }, signal, "upload");
    const parsed = intentResponse.safeParse(result);
    if (!parsed.success) throw new UploadError("The upload could not be prepared.");
    return parsed.data;
  },
  put(file, intent, signal, progress) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      const finish = (error?: UploadError) => { signal.removeEventListener("abort", abort); if (error) reject(error); else resolve(); };
      xhr.open("PUT", intent.uploadUrl);
      xhr.withCredentials = false;
      xhr.timeout = 120_000;
      for (const [key, value] of Object.entries(intent.headers)) xhr.setRequestHeader(key, value);
      xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
      xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? undefined : new UploadError("Storage rejected this upload. Retry this file."));
      xhr.onerror = () => finish(new UploadError("The upload connection failed. Retry this file."));
      xhr.ontimeout = () => finish(new UploadError("The upload timed out. Retry this file."));
      xhr.onabort = () => finish(new UploadError("Upload cancelled."));
      if (signal.aborted) { finish(new UploadError("Upload cancelled.")); return; }
      signal.addEventListener("abort", abort, { once: true });
      xhr.send(file);
    });
  },
  async complete(id, signal, token) {
    const result = completionResponse.parse(await jsonRequest(`/api/resources/${id}/complete`, { botToken: token }, signal, "complete"));
    if (result.id !== id) throw new UploadError("The upload response did not match this file.");
    return result;
  },
  async cancel(id) {
    const response = await fetch(`/api/resources/${id}`, { method: "DELETE", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new UploadError("Cancellation failed.");
  },
};
