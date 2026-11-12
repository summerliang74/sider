const DB = 'sider-auth';
const STORE = 'session';
const CHANNEL = 'sider-session-events';
let transport = 'cookie';
let channel;
function database() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' }); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(new Error('Secure session storage is unavailable.'));
  });
}
async function write(value) {
  if (!('indexedDB' in window)) return;
  const db = await database();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite'); const store = tx.objectStore(STORE);
    if (value) store.put(value); else store.delete('current');
    tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(new Error('Could not update secure session storage.')); };
  });
}
export async function readSession() {
  if (transport !== 'header-compat') return null;
  const db = await database();
  const value = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly'); const request = tx.objectStore(STORE).get('current');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Could not read your session.'));
    tx.oncomplete = () => db.close();
  });
  if (value && Date.parse(value.expiresAt) > Date.now()) return value;
  if (value) await write(null);
  return null;
}
export async function initializeSession(mode) {
  if (!['cookie', 'header-compat'].includes(mode)) throw new Error('Invalid session configuration.');
  transport = mode;
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = event => { if (event.data?.type === 'signed-out') window.location.replace('/login'); };
  }
  if (mode === 'header-compat') {
    if (!('serviceWorker' in navigator) || !('indexedDB' in window)) throw new Error('This browser cannot initialize secure sign-in.');
    const registration = await navigator.serviceWorker.register('/auth-session-sw.js?v=3', { scope: '/', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
    const expected = worker => worker && new URL(worker.scriptURL).searchParams.get('v') === '3';
    if (!expected(navigator.serviceWorker.controller) && !(!navigator.serviceWorker.controller && expected(registration.active))) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', changed); reject(new Error('Secure session transport could not be updated. Reload and try again.')); }, 8000);
        function changed() { if (expected(navigator.serviceWorker.controller)) { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve(); } }
        navigator.serviceWorker.addEventListener('controllerchange', changed); changed();
      });
    }
  } else {
    // Clear the old credential before unregistering legacy workers. A controlling
    // worker can survive until navigation, but now has no header credential.
    await write(null);
    if ('serviceWorker' in navigator) {
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        const worker = registration.active || registration.waiting || registration.installing;
        if (worker && new URL(worker.scriptURL).pathname === '/auth-session-sw.js') await registration.unregister();
      }
    }
  }
}
export async function saveSession(result) {
  if (result.sessionTransport !== transport) throw new Error('The sign-in transport does not match this deployment.');
  if (transport === 'header-compat') {
    if (!result.accessToken || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error('The server returned an invalid session.');
    await write({ key: 'current', accessToken: result.accessToken, expiresAt: result.expiresAt });
  } else if (result.accessToken) throw new Error('Unexpected script-readable cookie credential.');
}
export async function clearSession() {
  window.dispatchEvent(new Event('sider-session-cleared'));
  await write(null); channel?.postMessage({ type: 'signed-out' });
}
