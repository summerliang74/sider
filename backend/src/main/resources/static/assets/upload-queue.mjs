import { declaredMime } from './helpers.mjs';

export class UploadError extends Error {
  constructor(message, challenge, options = {}) {
    super(message); this.challenge = challenge;
    Object.assign(this, options);
  }
}
export class UploadQueue {
  constructor(files, metadata, transport, changed) {
    this.items = files.map((file, i) => ({ id: String(i), file, stage: 'queued', progress: 0, uploaded: false }));
    this.metadata = metadata; this.transport = transport; this.changed = changed; this.running = new Map(); this.tokens = new Map(); this.disposed = false;
  }
  emit() { if (!this.disposed) this.changed(this.items.map(item => ({ ...item }))); }
  start() { this.emit(); this.pump(); }
  pump() {
    if (this.disposed) return;
    for (const item of this.items) {
      if (this.running.size >= 2) break;
      if (item.stage !== 'queued' || this.running.has(item.id)) continue;
      const controller = new AbortController(); this.running.set(item.id, controller);
      void this.run(item, controller).finally(() => { this.running.delete(item.id); this.pump(); });
    }
  }
  async run(item, controller) {
    const token = this.tokens.get(item.id); this.tokens.delete(item.id);
    try {
      if (!item.intent) {
        item.stage = 'preparing'; this.emit();
        let mimeType;
        try { mimeType = declaredMime(item.file); }
        catch { throw new UploadError('This file type is not supported.', undefined, { status: 415 }); }
        try { item.intent = await this.transport.intent(item.file, { ...this.metadata, mimeType }, controller.signal, token); }
        catch (error) {
          if (!error.challenge && (!error.status || error.status >= 500)) item.uncertain = true;
          throw error;
        }
        item.resourceId = item.intent.resourceId;
        if (controller.signal.aborted) {
          try { await this.transport.cancel(item.resourceId); }
          catch { item.stage = 'error'; item.uncertain = true; item.message = 'Cancellation was not confirmed. Check My uploads before trying again.'; }
          return;
        }
      }
      if (!item.uploaded) {
        item.challenge = undefined; item.stage = 'uploading'; item.progress = 0; this.emit();
        await this.transport.put(item.file, item.intent, controller.signal, value => { item.progress = value; this.emit(); });
        item.uploaded = true;
      }
      controller.signal.throwIfAborted(); item.stage = 'completing'; this.emit();
      const result = await this.transport.complete(item.resourceId, controller.signal, item.challenge === 'complete' ? token : undefined);
      controller.signal.throwIfAborted();
      if (result.id !== item.resourceId) throw new Error('The response did not match this upload.');
      if (result.status === 'scanning' || result.status === 'active') item.stage = result.status;
      else if (result.status === 'deleted') item.stage = 'cancelled';
      else { item.stage = 'quarantined'; item.message = 'This resource is unavailable. Check My uploads.'; }
      item.challenge = undefined; item.progress = 100;
    } catch (error) {
      if (controller.signal.aborted) return;
      item.stage = 'error';
      item.message = item.uncertain ? 'The request result is uncertain. Check My uploads before creating another intent.' : error.message || 'Upload failed. Retry this file.';
      item.challenge = error.challenge;
      item.retryAt = error.status === 429 ? Date.now() + (error.retryAfter || 60) * 1000 : 0;
    } finally { this.emit(); }
  }
  retry(id, token) {
    const item = this.items.find(i => i.id === id);
    if (!item || item.stage !== 'error' || item.uncertain || item.challenge && !token || Date.now() < (item.retryAt || 0)) return;
    if (token) this.tokens.set(id, token);
    item.stage = 'queued'; item.message = ''; this.emit(); this.pump();
  }
  async cancel(id) {
    const item = this.items.find(i => i.id === id);
    if (!item || ['active', 'quarantined', 'cancelled'].includes(item.stage)) return;
    this.running.get(id)?.abort(); item.stage = 'cancelled'; item.message = ''; item.challenge = undefined; this.emit();
    if (item.resourceId) {
      try { await this.transport.cancel(item.resourceId); }
      catch { item.stage = 'error'; item.uncertain = true; item.message = 'Cancellation was not confirmed. Check My uploads before trying again.'; this.emit(); }
    }
  }
  updateStatuses(statuses) {
    for (const state of statuses) {
      const item = this.items.find(i => i.resourceId === state.id && i.stage === 'scanning');
      if (!item) continue;
      if (state.status === 'active') item.stage = 'active';
      else if (state.status === 'deleted') item.stage = 'cancelled';
      else if (['failed', 'quarantined', 'hidden'].includes(state.status)) { item.stage = 'quarantined'; item.message = 'This file is unavailable. See My uploads.'; }
    }
    this.emit();
  }
  dispose() { this.disposed = true; for (const controller of this.running.values()) controller.abort(); }
}
