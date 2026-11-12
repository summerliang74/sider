import { readSession, clearSession } from './session.js';
import { MetadataCache } from './metadata-cache.mjs';
const metadata = new MetadataCache();
function cacheKey(path) {
  const url = new URL(path, 'https://sider.invalid'); url.searchParams.sort();
  return url.pathname + (url.searchParams.size ? '?' + url.searchParams : '');
}
function cacheTtl(path, anonymous) {
  if (path === '/api/config' && anonymous) return 60000;
  if (anonymous) return 0;
  if (path === '/api/me' || path === '/api/resources/tags' || path === '/api/me/resources?view=workspace') return 30000;
  if (/^\/api\/resources\/[0-9a-f-]{36}$/i.test(path)) return 30000;
  const url = new URL(path, 'https://sider.invalid');
  if (['/api/admin/reports?view=workspace', '/api/admin/audit?view=workspace'].includes(path)) return 30000;
  if (url.pathname === '/api/admin/dashboard' && url.searchParams.size === 1 && ['24h', '7d', '30d'].includes(url.searchParams.get('range'))) return 30000;
  if (url.pathname === '/api/resources' && [...url.searchParams.keys()].every(key => ['q', 'type', 'tag'].includes(key))) return 30000;
  return 0;
}
/** Successful allowlisted page metadata only; never tokens, signed URLs or files. */
export function prefetchApi(path, options = {}) { return api(path, { ...options, redirectOnUnauthorized: false }); }
export function clearPrefetches() { metadata.invalidate(); }
if (typeof window !== 'undefined') window.addEventListener('sider-session-cleared', clearPrefetches);
export class ApiError extends Error {
  constructor(status, data, retryAfter) { super(errorMessage(data?.error)); this.status = status; this.code = data?.error || 'request_failed'; this.retryAfter = Number(retryAfter || data?.retryAfter || 0); }
}
export function errorMessage(code) {
  return ({ unauthorized: 'Your session expired. Sign in again.', suspended: 'This Sider account is suspended.', forbidden: 'This action is not allowed.', pa_tag_admin_only: 'Only administrators can assign or retain PA.', invalid_cursor: 'This page has expired. Reload the first page.', rate_limited: 'Too many requests. Wait before trying again.', report_already_open: 'You already have an open report for this resource.', login_exchange_replayed: 'This sign-in request was already used. Start a new Launchpad sign-in.', invalid_token: 'Launchpad sign-in expired. Start sign-in again.', file_too_large: 'This file exceeds the upload limit.', file_type_not_allowed: 'This file type is not supported.', upload_expired: 'This upload expired. Check My uploads before creating another.', object_mismatch: 'The stored file did not match the upload. Check My uploads.', uploads_disabled: 'Uploads are temporarily unavailable.', resource_unavailable: 'This resource is unavailable.', cannot_suspend_self: 'You cannot suspend your own account.', bot_challenge_required: 'Complete the traffic check to continue.', bot_challenge_invalid: 'The traffic check expired. Try again.', bot_challenge_unavailable: 'The traffic check is temporarily unavailable.' })[code] || 'The request could not be completed. Please try again.';
}
export async function api(path, { method = 'GET', body, signal, token, anonymous = false, redirectOnUnauthorized = true, sessionToken, fresh = false } = {}) {
  if (!path.startsWith('/api/') || path.startsWith('//')) throw new Error('Invalid API path.');
  const key = cacheKey(path);
  const ttl = method === 'GET' && body === undefined && !token && !sessionToken ? cacheTtl(key, anonymous) : 0;
  const mutation = method !== 'GET' && method !== 'HEAD' && key !== '/api/resources/upload-status';
  if (mutation) clearPrefetches();
  try {
    const load = ownSignal => send(path, { method, body, signal: ownSignal, token, anonymous, sessionToken });
    return await (ttl ? metadata.read(key, load, { ttl, signal, fresh }) : load(signal));
  } catch (error) {
    if (error.status === 401 || error.status === 403 || error.code === 'suspended') clearPrefetches();
    if (error.status === 401 && !anonymous && redirectOnUnauthorized && !signal?.aborted) {
      await clearSession().catch(() => {});
      window.location.assign('/login?returnTo=' + encodeURIComponent(location.pathname + location.search));
    }
    throw error;
  } finally { if (mutation) clearPrefetches(); }
}
async function send(path, { method, body, signal, token, anonymous, sessionToken }) {
  signal?.throwIfAborted();
  const headers = new Headers({ accept: 'application/json' });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (token) headers.set('x-bot-token', token);
  if (!anonymous) { const session = await readSession(); if (sessionToken || session) headers.set('x-sider-session', sessionToken || session.accessToken); }
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(65000)]) : AbortSignal.timeout(65000), credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, data, response.headers.get('retry-after'));
  }
  return data;
}
