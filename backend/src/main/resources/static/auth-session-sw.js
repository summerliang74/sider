// Compatibility profile only. No caching and no credentials on navigation,
// external storage, SDK requests, public endpoints or cross-origin redirects.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
function readSession() {
  return new Promise(resolve => {
    const open = indexedDB.open('sider-auth', 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('session')) open.result.createObjectStore('session', { keyPath: 'key' }); };
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result; const tx = db.transaction('session', 'readwrite'); const store = tx.objectStore('session');
      const req = store.get('current');
      req.onsuccess = () => { const value = req.result; if (value && Date.parse(value.expiresAt) > Date.now()) resolve(value); else { store.delete('current'); resolve(null); } };
      req.onerror = () => resolve(null); tx.oncomplete = () => db.close();
    };
  });
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/internal/') || ['/api/config', '/api/health', '/api/auth/launchpad/session', '/api/auth/launchpad/start'].includes(url.pathname)) return;
  event.respondWith((async () => {
    const headers = new Headers(event.request.headers);
    if (!headers.has('x-sider-session')) {
      const session = await readSession().catch(() => null);
      if (session) headers.set('x-sider-session', session.accessToken);
    }
    return fetch(new Request(event.request, { headers, redirect: 'error', cache: 'no-store' }));
  })());
});
