export type UploadStage = "queued" | "preparing" | "uploading" | "completing" | "scanning" | "active" | "error" | "quarantined" | "cancelled";
export type UploadMetadata = { title: string; description: string; tags: string[] };
export type UploadIntent = { resourceId: string; uploadUrl: string; headers: Record<string, string> };
export type UploadItem = {
  id: string; file: File; stage: UploadStage; progress: number; resourceId?: string;
  uploaded: boolean; message?: string; challenge?: "upload" | "complete";
};
export class UploadError extends Error {
  constructor(message: string, public readonly challenge?: "upload" | "complete") { super(message); }
}
export type UploadTransport = {
  intent: (file: File, metadata: UploadMetadata, signal: AbortSignal, token?: string) => Promise<UploadIntent>;
  put: (file: File, intent: UploadIntent, signal: AbortSignal, progress: (value: number) => void) => Promise<void>;
  complete: (id: string, signal: AbortSignal, token?: string) => Promise<{ status: string }>;
  cancel: (id: string) => Promise<void>;
};

// One queue owns concurrency and retry state; React only renders snapshots.
export class UploadQueue {
  private items: UploadItem[];
  private running = new Map<string, AbortController>();
  private tokens = new Map<string, string>();
  private disposed = false;
  constructor(files: File[], private metadata: UploadMetadata, private transport: UploadTransport, private onChange: (items: UploadItem[]) => void) {
    this.items = files.map((file, i) => ({ id: String(i), file, stage: "queued", progress: 0, uploaded: false }));
  }
  start() { this.emit(); this.pump(); }
  dispose() { this.disposed = true; for (const controller of this.running.values()) controller.abort(); }
  retry(id: string, token?: string) {
    const item = this.items.find((entry) => entry.id === id);
    if (!item || item.stage !== "error" || (item.challenge && !token)) return;
    if (token) this.tokens.set(id, token);
    item.stage = "queued"; item.message = undefined; this.emit(); this.pump();
  }
  async cancel(id: string) {
    const item = this.items.find((entry) => entry.id === id);
    if (!item || ["active", "quarantined", "cancelled"].includes(item.stage)) return;
    this.running.get(id)?.abort();
    item.stage = "cancelled"; item.challenge = undefined; this.emit();
    if (item.resourceId) {
      try { await this.transport.cancel(item.resourceId); }
      catch { item.stage = "error"; item.message = "Cancellation could not be confirmed. Check My uploads before retrying."; this.emit(); }
    }
  }
  updateStatuses(statuses: Array<{ id: string; status: string }>) {
    for (const result of statuses) {
      const item = this.items.find((entry) => entry.resourceId === result.id && entry.stage === "scanning");
      if (!item) continue;
      if (result.status === "active") item.stage = "active";
      else if (["quarantined", "failed", "hidden", "deleted"].includes(result.status)) {
        item.stage = result.status === "deleted" ? "cancelled" : "quarantined";
        item.message = "This file is unavailable. See My uploads for its status.";
      }
    }
    this.emit();
  }
  private emit() { if (!this.disposed) this.onChange(this.items.map((item) => ({ ...item }))); }
  private pump() {
    if (this.disposed) return;
    for (const item of this.items) {
      if (this.running.size >= 2) break;
      if (item.stage !== "queued" || this.running.has(item.id)) continue;
      const controller = new AbortController();
      this.running.set(item.id, controller);
      void this.run(item, controller).finally(() => { this.running.delete(item.id); this.pump(); });
    }
  }
  private async run(item: UploadItem, controller: AbortController) {
    const token = this.tokens.get(item.id); this.tokens.delete(item.id);
    try {
      if (!item.uploaded) {
        item.stage = "preparing"; item.progress = 0; this.emit();
        const intent = await this.transport.intent(item.file, this.metadata, controller.signal, token);
        item.resourceId = intent.resourceId;
        if (controller.signal.aborted) { await this.transport.cancel(intent.resourceId); return; }
        item.challenge = undefined; item.stage = "uploading"; this.emit();
        await this.transport.put(item.file, intent, controller.signal, (value) => { item.progress = value; this.emit(); });
        item.uploaded = true;
      }
      controller.signal.throwIfAborted();
      item.stage = "completing"; this.emit();
      const result = await this.transport.complete(item.resourceId!, controller.signal, item.challenge === "complete" ? token : undefined);
      controller.signal.throwIfAborted();
      if (!["scanning", "active"].includes(result.status)) throw new UploadError("The file could not be published. Check My uploads for its status.");
      item.stage = result.status as "scanning" | "active"; item.challenge = undefined; item.progress = 100;
    } catch (error) {
      if (controller.signal.aborted) return;
      item.stage = "error";
      item.message = error instanceof UploadError ? error.message : "The request failed. Check your connection and retry this file.";
      item.challenge = error instanceof UploadError ? error.challenge : undefined;
    } finally { this.emit(); }
  }
}
