export const fileTypes = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain', png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg' };
export const suggestedTags = ['Notes', 'Revision', 'Worksheets', 'Guides', 'PA'];
export function safeReturnTo(value) {
  if (typeof value !== 'string' || value.length > 500 || /[\\\u0000-\u001f\u007f]/.test(value) || !value.startsWith('/') || value.startsWith('//')) return '/resources';
  try {
    const decoded = decodeURIComponent(value);
    if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//')) return '/resources';
    const u = new URL(value, 'https://sider.invalid');
    if (u.origin !== 'https://sider.invalid' || !/^\/(?:resources|me\/resources|admin\/(?:dashboard|reports|audit))(?:\/|$)/.test(u.pathname)) return '/resources';
    return u.pathname + u.search;
  } catch { return '/resources'; }
}
export function isPaTag(tag) { return ['pa', 'peeradvisor', 'peeradvisors'].includes(tag.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '')); }
export function normalizeTags(value, admin = false) {
  const list = Array.isArray(value) ? value : String(value).split(',').map(t => t.trim()).filter(Boolean);
  if (list.length > 10 || list.some(t => !t.trim() || t.trim().length > 30)) throw new Error('Use up to 10 tags, each 1–30 characters.');
  if (!admin && list.some(isPaTag)) throw new Error('Only administrators can assign or retain PA. Remove PA to save, or ask an administrator to edit this resource.');
  const unique = new Map();
  for (const value of list) { const tag = isPaTag(value) ? 'PA' : value.trim(); if (!unique.has(tag.toLowerCase())) unique.set(tag.toLowerCase(), tag); }
  return [...unique.values()];
}
export function formatBytes(n) { return n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`; }
export function declaredMime(file) {
  const expected = fileTypes[file.name.split('.').pop().toLowerCase()];
  if (!expected || (file.type && file.type !== expected && file.type !== 'application/octet-stream')) throw new Error(`${file.name}: unsupported file type.`);
  return expected;
}
export function validateFiles(files, maxBytes) {
  if (!files.length || files.length > 5) throw new Error('Choose 1–5 files.');
  for (const file of files) { if (!file.size || file.size > maxBytes) throw new Error(`${file.name}: choose a non-empty file no larger than ${formatBytes(maxBytes)}.`); declaredMime(file); }
}
export function searchParams({ q = '', type = '', tag = '', status = '' } = {}, cursor) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries({ q: q.trim(), type, tag, status })) if (value) result.set(key, value);
  if (cursor) result.set('cursor', cursor);
  return result;
}
export function retryDelay(error, previous = 5000) { return error?.status === 429 ? Math.max(5000, (error.retryAfter || 60) * 1000) : Math.min(60000, previous * 2); }
export class PageCollection {
  constructor() { this.reset(); }
  reset() { this.items = []; this.nextCursor = null; }
  accept(page, append = false, key = 'items') {
    if (!Array.isArray(page[key])) throw new Error('The server returned an invalid list.');
    const merged = append ? [...this.items, ...page[key]] : page[key];
    this.items = [...new Map(merged.map(item => [item.id, item])).values()];
    this.nextCursor = page.nextCursor || null;
    return this.items;
  }
}
export function validStorageUrl(value, origin) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (origin && url.origin === origin)) throw new Error('The server returned an invalid storage link.');
  return url.href;
}
