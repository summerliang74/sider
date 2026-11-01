const DATABASE_NAME = "sider-auth";
const STORE_NAME = "session";
const SESSION_KEY = "current";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readSession() {
  const database = await openDatabase();
  return new Promise((resolve) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(SESSION_KEY);
    request.onsuccess = () => {
      const session = request.result;
      if (session && Date.parse(session.expiresAt) <= Date.now()) {
        store.delete(SESSION_KEY);
        resolve(null);
      } else {
        resolve(session || null);
      }
    };
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => database.close();
  });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const protectedRequest = event.request.mode === "navigate" || /^\/(?:api|resources|me|admin)(?:\/|$)/.test(url.pathname);
  if (url.origin !== self.location.origin || !protectedRequest || url.pathname.startsWith("/dashboard-api/")) return;

  event.respondWith((async () => {
    const session = await readSession().catch(() => null);
    if (!session || !session.accessToken || event.request.headers.has("x-sider-session")) {
      return fetch(event.request);
    }
    const headers = new Headers(event.request.headers);
    headers.set("x-sider-session", session.accessToken);
    return fetch(new Request(event.request, { headers }));
  })());
});
