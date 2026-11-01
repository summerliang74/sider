"use client";

const DATABASE_NAME = "sider-auth";
const STORE_NAME = "session";
const SESSION_KEY = "current";
const SERVICE_WORKER_PATH = "/auth-session-sw.js?v=2";

type BrowserSession = {
  key: typeof SESSION_KEY;
  accessToken: string;
  expiresAt: string;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the Sider session store."));
  });
}

function writeSession(session: BrowserSession | null): Promise<void> {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    if (session) store.put(session);
    else store.delete(SESSION_KEY);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Could not update the Sider session store.")); };
  }));
}

export async function ensureAuthTransport(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("indexedDB" in window)) {
    throw new Error("This browser does not support secure Sider sessions.");
  }

  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH, {
    scope: "/",
    updateViaCache: "none",
  });
  await registration.update();
  await navigator.serviceWorker.ready;
  const expectedWorker = (worker: ServiceWorker | null) => {
    if (!worker) return false;
    const url = new URL(worker.scriptURL);
    return url.pathname === "/auth-session-sw.js" && url.searchParams.get("v") === "2";
  };
  if (expectedWorker(navigator.serviceWorker.controller)) return;
  // A first-time visitor has no controller until the next navigation. Once
  // the root-scoped worker is active, that navigation will be controlled, so
  // do not turn a normal first login into an eight-second timeout.
  if (!navigator.serviceWorker.controller && expectedWorker(registration.active)) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      reject(new Error("Sider could not initialize its session transport."));
    }, 8_000);
    function onControllerChange() {
      if (!expectedWorker(navigator.serviceWorker.controller)) return;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      resolve();
    }
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
  });
}

export async function saveBrowserSession(accessToken: string, expiresAt: string): Promise<void> {
  await ensureAuthTransport();
  await writeSession({ key: SESSION_KEY, accessToken, expiresAt });
}

export async function clearBrowserSession(): Promise<void> {
  if (!("indexedDB" in window)) return;
  await writeSession(null);
}
