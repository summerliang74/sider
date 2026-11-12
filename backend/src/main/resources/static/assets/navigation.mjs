const allowed = path => /^(?:\/|\/login|\/resources(?:\/[^/]+)?|\/me\/resources|\/admin\/(?:dashboard|reports|audit)|\/privacy|\/terms|\/auth\/error)$/.test(path);

export function automaticPrefetchAllowed(navigatorLike = navigator, documentLike = document) {
  const connection = navigatorLike.connection;
  return documentLike.visibilityState === 'visible' && navigatorLike.onLine !== false && !connection?.saveData && !['slow-2g', '2g', '3g'].includes(connection?.effectiveType || '');
}

/** History contains identifiers only; private view state stays in this tab's memory. */
export function createNavigation({ render, capture, restoreFields, root, prefetch = async () => {} }) {
  const views = new Map();
  const prefetched = new Map();
  const idleTimers = new Map();
  let entry = history.state?.siderView || crypto.randomUUID();
  let sequence = 0, rendering = false;
  history.replaceState({ ...history.state, siderView: entry }, '', location.href);
  history.scrollRestoration = 'manual';
  function prepare(href) {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || url.href === location.href || !allowed(url.pathname) || prefetched.has(url.href)) return;
    // Only deduplicate in flight. The data cache owns expiry and retry policy.
    const pending = Promise.resolve().then(() => prefetch(url)).catch(() => {}).finally(() => prefetched.delete(url.href));
    prefetched.set(url.href, pending);
  }
  function scheduleIdle(link) {
    if (!link?.matches?.('a[data-prefetch-idle][href]') || idleTimers.has(link) || !automaticPrefetchAllowed()) return;
    const timer = setTimeout(() => {
      idleTimers.delete(link);
      if (!link.isConnected || !automaticPrefetchAllowed()) return;
      const run = () => { if (link.isConnected && automaticPrefetchAllowed()) prepare(link.href); };
      if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 2000 }); else run();
    }, 700);
    idleTimers.set(link, timer);
  }
  const intersection = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) { visibleLinks.add(entry.target); scheduleIdle(entry.target); }
      else { visibleLinks.delete(entry.target); clearTimeout(idleTimers.get(entry.target)); idleTimers.delete(entry.target); }
    }
  }, { rootMargin: '100px' }) : null;
  const visibleLinks = new Set();
  const observed = new WeakSet();
  function scanIdle() {
    for (const link of visibleLinks) if (!link.isConnected) { visibleLinks.delete(link); intersection?.unobserve(link); }
    document.querySelectorAll('a[data-prefetch-idle][href]').forEach(link => {
      if (intersection) { if (!observed.has(link)) { observed.add(link); intersection.observe(link); } }
      else scheduleIdle(link);
    });
  }
  const observer = new MutationObserver(scanIdle);
  observer.observe(root, { childList: true, subtree: true });
  scanIdle();
  const resumeIdle = () => { if (automaticPrefetchAllowed()) { scanIdle(); visibleLinks.forEach(scheduleIdle); } };
  document.addEventListener('visibilitychange', resumeIdle);
  window.addEventListener('online', resumeIdle);
  navigator.connection?.addEventListener?.('change', resumeIdle);
  const intent = event => {
    const link = event.target.closest?.('a[data-prefetch-intent][href]');
    if (link) prepare(link.href);
  };
  document.addEventListener('mouseover', intent);
  document.addEventListener('focusin', intent);
  document.addEventListener('touchstart', intent, { passive: true });
  function remember() {
    if (rendering) return;
    views.set(entry, { state: capture(), scroll: [scrollX, scrollY] });
    if (views.size > 20) views.delete(views.keys().next().value);
  }
  async function navigate(href, { replace = false, pop = false, refresh = false, message } = {}) {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || !allowed(url.pathname)) { location.assign(url.href); return; }
    if (!pop && !refresh && url.href === location.href) return;
    if (!refresh) prepare(url.href);
    const id = ++sequence;
    const previousScroll = [scrollX, scrollY];
    remember();
    if (pop) entry = history.state?.siderView || crypto.randomUUID();
    else if (!refresh) {
      entry = replace ? entry : crypto.randomUUID();
      history[replace ? 'replaceState' : 'pushState']({ ...history.state, siderView: entry }, '', url);
    }
    const saved = pop ? views.get(entry) : null;
    const progress = document.createElement('span');
    progress.className = 'navigation-progress'; progress.setAttribute('role', 'status');
    const text = document.createElement('span'); text.className = 'sr-only'; text.textContent = 'Loading page…'; progress.append(text);
    const progressTimer = setTimeout(() => document.body.append(progress), 150);
    rendering = true;
    try {
      const result = await render(url, { restore: saved?.state, message, refresh });
      if (id !== sequence || !result) return;
      if (result !== root) root.replaceChildren(...result.childNodes);
      restoreFields(saved?.state);
      const position = saved?.scroll || (refresh ? previousScroll : [0, 0]);
      window.scrollTo(...position);
    } finally { clearTimeout(progressTimer); progress.remove(); if (id === sequence) rendering = false; }
  }
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.target && link.target !== '_self' || link.hasAttribute('download')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !allowed(url.pathname) || url.hash) return;
    event.preventDefault();
    void navigate(url.href).catch(() => {});
  });
  window.addEventListener('popstate', () => { void navigate(location.href, { pop: true }).catch(() => {}); });
  return { navigate, invalidate: () => views.clear(), refresh: options => navigate(location.href, { ...options, refresh: true }), clear: () => {
    views.clear(); prefetched.clear(); observer.disconnect(); intersection?.disconnect();
    for (const timer of idleTimers.values()) clearTimeout(timer);
    idleTimers.clear(); visibleLinks.clear();
    document.removeEventListener('visibilitychange', resumeIdle);
    window.removeEventListener('online', resumeIdle);
    navigator.connection?.removeEventListener?.('change', resumeIdle);
    document.removeEventListener('mouseover', intent);
    document.removeEventListener('focusin', intent);
    document.removeEventListener('touchstart', intent);
  } };
}
