import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MetadataCache } from '../backend/src/main/resources/static/assets/metadata-cache.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
test('fresh metadata survives repeated navigation, is isolated from edits, and expires', async () => {
  let now = 0, loads = 0;
  const cache = new MetadataCache({ now: () => now });
  const load = async () => ({ title: 'Version ' + ++loads });
  const first = await cache.read('resource', load); first.title = 'Local edit';
  assert.equal((await cache.read('resource', load)).title, 'Version 1');
  now = 30001;
  assert.equal((await cache.read('resource', load)).title, 'Version 2');
  assert.equal(loads, 2);
});
test('navigation joins a pending prefetch without a duplicate request', async () => {
  const cache = new MetadataCache(); let resolve, loads = 0;
  const load = () => { loads++; return new Promise(done => { resolve = done; }); };
  const warm = cache.read('resource', load);
  const visit = cache.read('resource', load);
  await tick(); resolve({ id:'one' });
  assert.deepEqual(await warm, await visit); assert.equal(loads, 1);
});
test('leaving one page cancels only its waiter while another reader still needs the result', async () => {
  const cache = new MetadataCache(); const page = new AbortController(); let complete, sharedSignal;
  const first = cache.read('resource', signal => { sharedSignal = signal; return new Promise(resolve => { complete = resolve; }); }, { signal: page.signal });
  const second = cache.read('resource', () => assert.fail('Duplicate request'));
  await tick(); page.abort();
  await assert.rejects(first, { name:'AbortError' }); assert.equal(sharedSignal.aborted, false);
  complete({ id:'one' }); assert.deepEqual(await second, { id:'one' });
});
test('leaving the only foreground reader aborts the unused underlying request', async () => {
  const cache = new MetadataCache(), page = new AbortController(); let sharedSignal;
  const read = cache.read('resource', signal => { sharedSignal = signal; return new Promise(() => {}); }, { signal:page.signal });
  await tick(); page.abort(); await assert.rejects(read, { name:'AbortError' });
  assert.equal(sharedSignal.aborted, true); assert.equal(cache.entries.size, 0);
});
test('logout or mutation invalidation prevents late responses refilling the cache', async () => {
  const cache = new MetadataCache(); let complete;
  const old = cache.read('resource', () => new Promise(resolve => { complete = resolve; }));
  await tick(); cache.invalidate();
  await cache.read('resource', async () => ({ title:'New identity' }));
  complete({ title:'Old identity' }); await old;
  assert.deepEqual(await cache.read('resource', () => assert.fail('Unexpected fetch')), { title:'New identity' });
});
test('errors are retryable and the cache has a bounded entry count', async () => {
  const cache = new MetadataCache({ limit:2 });
  await assert.rejects(cache.read('resource', async () => { throw new Error('Offline'); }));
  assert.deepEqual(await cache.read('resource', async () => ({ recovered:true })), { recovered:true });
  await cache.read('second', async () => ({})); await cache.read('third', async () => ({}));
  assert.equal(cache.entries.size, 2);
});

// Exercise the real API wrapper: cached identity is display metadata only;
// write/download requests and server permission checks always go to the server.
globalThis.window = new EventTarget();
globalThis.location = new URL('https://sider.test/resources');
const redirects = [];
window.location = { assign: value => redirects.push(value) };
const { api, prefetchApi, clearPrefetches } = await import('../backend/src/main/resources/static/assets/api.js');
const originalFetch = globalThis.fetch;
afterEach(() => { clearPrefetches(); globalThis.fetch = originalFetch; redirects.length = 0; });
const resource = '/api/resources/11373201-18b6-48fa-b8a7-000000000001';
test('bootstrap and metadata are reused, then writes and explicit refresh read new values', async () => {
  const calls = [];
  globalThis.fetch = async (path, options) => { calls.push([path, options.method]); return Response.json({ version:calls.length }); };
  await api('/api/config', { anonymous:true }); await api('/api/me'); await prefetchApi(resource);
  await api('/api/config', { anonymous:true }); await api('/api/me'); await api(resource); await api(resource);
  assert.equal(calls.length, 3);
  await api(resource, { method:'PATCH', body:{ title:'Changed' } });
  await api(resource); await api(resource, { fresh:true });
  assert.equal(calls.length, 6);
  assert.equal(calls[3][1], 'PATCH');
});
test('signed download URLs are never reused and local sign-out empties display metadata', async () => {
  let calls = 0;
  globalThis.fetch = async () => Response.json({ version:++calls });
  await api(resource); await api('/api/me');
  window.dispatchEvent(new Event('sider-session-cleared'));
  await api(resource); await api('/api/me');
  await api(resource + '/download', { method:'POST', body:{} });
  await api(resource + '/download', { method:'POST', body:{} });
  assert.equal(calls, 6);
});
test('admin preloads are reused and every moderation write invalidates the snapshot', async () => {
  let calls = 0;
  globalThis.fetch = async () => Response.json({ version: ++calls });
  const paths = ['/api/admin/dashboard?range=7d', '/api/admin/reports?view=workspace', '/api/admin/audit?view=workspace'];
  for (const path of paths) { await prefetchApi(path); await api(path); }
  assert.equal(calls, 3);
  await api('/api/admin/reports/report-id', { method: 'POST', body: { note: 'Dismiss' } });
  for (const path of paths) await api(path);
  assert.equal(calls, 7);
  await api(paths[0], { fresh: true }); assert.equal(calls, 8);
});
test('a forbidden admin response drops cached privileged metadata', async () => {
  let calls = 0;
  globalThis.fetch = async () => Response.json({ version: ++calls });
  const path = '/api/admin/dashboard?range=7d'; await prefetchApi(path);
  globalThis.fetch = async () => Response.json({ error: 'forbidden' }, { status: 403 });
  await assert.rejects(api('/api/admin/audit?view=workspace'), { status: 403 });
  globalThis.fetch = async () => Response.json({ version: ++calls });
  await api(path); assert.equal(calls, 2);
});
test('an expired server session discards all warm metadata and redirects foreground navigation', async () => {
  let unauthorized = false, calls = 0;
  globalThis.fetch = async () => { calls++; return unauthorized ? Response.json({ error:'unauthorized' }, { status:401 }) : Response.json({ user:{ id:'one' } }); };
  await api(resource); unauthorized = true;
  await assert.rejects(api('/api/me'), { status:401 });
  assert.equal(redirects.length, 1);
  unauthorized = false; await api(resource); assert.equal(calls, 3);
});
