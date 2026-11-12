import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../backend/src/main/resources/static/auth-session-sw.js', import.meta.url), 'utf8');
function harness(session) {
  const handlers = {}, requests = [], deleted = [];
  const context = { URL, Request, Headers, self: { location: { origin: 'https://sider.test' }, addEventListener: (name, fn) => { handlers[name] = fn; } }, fetch: async request => { requests.push(request); return new Response('ok'); }, indexedDB: { open() {
    const open = {};
    queueMicrotask(() => {
      open.result = { close() {}, transaction() {
        return { objectStore() { return { get() { const request = { result: session }; queueMicrotask(() => request.onsuccess()); return request; }, delete(key) { deleted.push(key); } }; } };
      } };
      open.onsuccess();
    });
    return open;
  } } };
  vm.runInNewContext(source, context);
  async function send(url, headers) {
    let reply;
    handlers.fetch({ request: new Request(url, { headers }), respondWith(value) { reply = value; } });
    if (reply) await reply;
    return requests.at(-1);
  }
  return { send, requests, deleted };
}
test('compatibility worker never injects to external, SDK, public or internal destinations', async () => {
  const mock = harness({ accessToken: 'opaque-fixture-token', expiresAt: new Date(Date.now() + 60000).toISOString() });
  for (const path of ['https://storage.test/file', 'https://sider.test/dashboard-api/oauth/sdk.js', 'https://sider.test/api/config', 'https://sider.test/api/health', 'https://sider.test/api/auth/launchpad/session', 'https://sider.test/api/internal/jobs/uploads', 'https://sider.test/resources']) await mock.send(path);
  assert.equal(mock.requests.length, 0);
});
test('compatibility fetch injects only opaque session and blocks redirect credential forwarding', async () => {
  const mock = harness({ accessToken: 'opaque-fixture-token', expiresAt: new Date(Date.now() + 60000).toISOString() });
  const request = await mock.send('https://sider.test/api/me');
  assert.equal(request.headers.get('x-sider-session'), 'opaque-fixture-token');
  assert.equal(request.redirect, 'error'); assert.equal(request.cache, 'no-store');
});
test('expired worker credentials are removed, and existing explicit headers are not replaced', async () => {
  const mock = harness({ accessToken: 'expired', expiresAt: '2000-01-01T00:00:00Z' });
  assert.equal((await mock.send('https://sider.test/api/me')).headers.has('x-sider-session'), false);
  assert.deepEqual(mock.deleted, ['current']);
  assert.equal((await mock.send('https://sider.test/api/me', { 'x-sider-session': 'explicit' })).headers.get('x-sider-session'), 'explicit');
});
