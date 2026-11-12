import { api as sendApi, prefetchApi, clearPrefetches } from './api.js';
import { createNavigation } from './navigation.mjs';
import { apiPathsForRoute } from './route-prefetch.mjs';
import { initializeSession, saveSession, clearSession, readSession } from './session.js';
import { safeReturnTo, normalizeTags, isPaTag, suggestedTags, formatBytes, validStorageUrl, searchParams, retryDelay, PageCollection } from './helpers.mjs';
import { UploadQueue, UploadError } from './upload-queue.mjs';
import { mountBotChallenge } from './bot-challenge.mjs';
import { dashboardPanels } from './dashboard.mjs';

const liveRoot = document.querySelector('#app');
let root = liveRoot;
let config, user, pageController = new AbortController();
let pageRestore, viewSnapshot = () => null, initializedTransport;
const api = (path, options = {}) => sendApi(path, { ...options, signal: options.signal ? AbortSignal.any([pageController.signal, options.signal]) : pageController.signal });
const scripts = new Map();
const disposers = [];
function publishView(signal = pageController.signal) { signal.throwIfAborted(); if (root !== liveRoot) { liveRoot.replaceChildren(...root.childNodes); root = liveRoot; } }
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'value') node.value = value;
    else if (key === 'checked' || key === 'disabled' || key === 'multiple' || key === 'required') node[key] = !!value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== undefined && child !== null && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const a = (text, href, cls) => el('a', { href, class: cls, 'data-prefetch-intent': /^\/(?:resources(?:\/[^/]+)?|me\/resources|admin\/(?:dashboard|reports|audit))(?:\?|$)/.test(href), 'data-prefetch-idle': href === '/resources/new' }, text);
const message = () => el('p', { class: 'form-error', role: 'status', 'aria-live': 'polite' });
function noticeError(node, error) { node.hidden = false; node.textContent = error.message + (error.retryAfter ? ` Try again in ${error.retryAfter} seconds.` : ''); }
function btn(text, action, cls = 'button') { return el('button', { type: 'button', class: cls, onclick: () => { void action(); } }, text); }
function field(text, input, hint) { return el('label', { class: 'field' }, el('span', {}, text), input, hint && el('small', {}, hint)); }
function date(value) { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' }) : ''; }
function time(value) { return el('time', { datetime: value }, date(value)); }
function status(value) { return el('span', { class: `status ${value}` }, value.charAt(0).toUpperCase() + value.slice(1)); }
function title(text, description, action) { return el('section', { class: 'page-heading' }, el('div', {}, el('h1', {}, text), description && el('p', { class: 'muted' }, description)), action); }
function empty(text, detail = '') { return el('div', { class: 'empty' }, el('h2', {}, text), detail && el('p', {}, detail)); }
function icon(name, width, height = width) { return el('img', { src: `/figma/${name}.svg`, alt: '', width, height, 'aria-hidden': 'true' }); }
function fileLabel(filename, mime = '') { const extension = filename.split('.').pop()?.toUpperCase(); return extension && extension.length <= 5 ? extension : mime.includes('pdf') ? 'PDF' : mime.startsWith('image/') ? 'IMG' : 'FILE'; }
const fileTypeLabels = { pdf: 'PDF', docx: 'Word (DOCX)', pptx: 'PowerPoint (PPTX)', xlsx: 'Excel (XLSX)', txt: 'Text (TXT)', png: 'PNG image', jpeg: 'JPEG image' };
function footer() { return el('footer', { class: 'footer' }, a('Privacy', '/privacy'), el('span', { 'aria-hidden': 'true' }, '·'), a('Terms', '/terms')); }
function loadScript(src) {
  if (!scripts.has(src)) scripts.set(src, new Promise((resolve, reject) => { const script = el('script', { src, async: true }); script.onload = resolve; script.onerror = () => reject(new Error('Sign-in or traffic verification is temporarily unavailable.')); document.head.append(script); }));
  return scripts.get(src);
}
async function challenge(action, target, signal = pageController.signal) {
  signal?.throwIfAborted();
  await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  if (!window.turnstile || !config.botSiteKey) throw new Error('Traffic verification is temporarily unavailable.');
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const error = message(); const widget = el('div', { 'aria-label': 'Automated traffic check' });
    const dialog = target
      ? el('div', { class: 'challenge' }, el('p', {}, 'Please complete the traffic check to continue.'), widget, error)
      : el('dialog', { class: 'challenge-dialog', 'aria-labelledby': 'challenge-title' }, el('h2', { id: 'challenge-title' }, 'A quick traffic check'), el('p', {}, 'Complete this check to continue your request.'), widget, error);
    let id, finished = false;
    const done = (token, failure) => {
      if (finished) return;
      finished = true; signal?.removeEventListener('abort', abort);
      if (id !== undefined) window.turnstile.remove(id);
      if (!target) dialog.close(); dialog.remove(); if (target) target.hidden = true;
      if (token) resolve(token); else reject(failure || new Error('Traffic check cancelled.'));
    };
    const abort = () => done(null, new DOMException('Aborted', 'AbortError'));
    dialog.append(btn('Cancel', () => done(null)));
    dialog.addEventListener('cancel', event => { event.preventDefault(); done(null); });
    if (target) { target.hidden = false; target.replaceChildren(dialog); } else { document.body.append(dialog); dialog.showModal(); }
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try {
      id = window.turnstile.render(widget, { sitekey: config.botSiteKey, action, callback: token => done(token), 'error-callback': () => { error.textContent = 'The check could not be completed. Close it and try again.'; }, 'expired-callback': () => { error.textContent = 'The check expired. Please complete it again.'; } });
    } catch (failure) { done(null, failure); }
  });
}
async function request(path, options = {}, action = 'search') {
  try { return await api(path, options); }
  catch (error) {
    if (!['bot_challenge_required', 'bot_challenge_invalid'].includes(error.code)) throw error;
    const token = await challenge(action, options.challengeContainer, options.signal || pageController.signal);
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return api(path, options.body !== undefined ? { ...options, body: { ...options.body, botToken: token } } : { ...options, token });
  }
}
function shell(current, heading) {
  const preload = { 'data-prefetch-intent': true, 'data-prefetch-idle': true };
  const navigationLink = (name, href, selected, mark) => el('a', { href, ...preload, class: selected ? 'selected' : null, 'aria-current': selected ? 'page' : null }, mark, el('span', {}, name));
  const nav = el('nav', { class: 'nav', 'aria-label': 'Primary navigation' },
    el('div', { class: 'nav-section' },
      navigationLink('Resources', '/resources', current === 'resources', icon('nav-resource', 20)),
      navigationLink('My uploads', '/me/resources', current === 'mine', el('span', { class: 'nav-upload-mark', 'aria-hidden': 'true' }, '↑'))),
    user.role === 'admin' && el('div', { class: 'nav-section nav-section-separated' },
      el('p', { class: 'nav-section-label' }, 'ADMINISTRATION'),
      navigationLink('Dashboard', '/admin/dashboard', current === 'dashboard', '▦ ')));
  const logoutError = message();
  let retryToken;
  async function logout() {
    try {
      if (!retryToken) retryToken = (await readSession())?.accessToken;
      await api('/api/auth/logout', { method: 'POST', redirectOnUnauthorized: false, sessionToken: retryToken });
      retryToken = undefined;
      await clearSession(); window.LaunchpadAuth?.signOut(); location.assign('/login');
    } catch {
      // Keep the revoked-session retry credential only in this closure. It is
      // never persisted, broadcast, displayed or used for another operation.
      await clearSession().catch(() => {});
      logoutError.textContent = 'Local sign-out completed, but server revocation was not confirmed. Close this tab if using a shared device. Any unrevoked session expires within one hour.';
      logoutError.append(btn('Retry server sign-out', logout), a('Return to sign in', '/login', 'button'));
    }
  }
  const content = el('div', { class: 'content' });
  const mobileNav = el('nav', { class: 'mobile-links', 'aria-label': 'Mobile navigation' },
    el('a', { href: '/resources', ...preload, 'aria-current': current === 'resources' ? 'page' : null }, 'Resources'),
    el('a', { href: '/me/resources', ...preload, 'aria-current': current === 'mine' ? 'page' : null }, 'My uploads'),
    user.role === 'admin' && a('Dashboard', '/admin/dashboard'), btn('Sign out', logout, ''));
  const mobile = el('details', { class: 'mobile-menu' }, el('summary', { class: 'button' }, 'Menu ', el('span', { 'aria-hidden': 'true' }, '☰')), mobileNav);
  const signOut = btn('↪', logout, ''); signOut.setAttribute('aria-label', 'Sign out'); signOut.title = 'Sign out';
  const initials = user.displayName.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  root.replaceChildren(el('div', { class: 'shell' }, a('Skip to content', '#main-content', 'skip-link'),
    el('aside', { class: 'sidebar' }, a([icon('sider-mark', 28), el('span', {}, 'Sider')], '/resources', 'brand'), nav,
      el('div', { class: 'profile' }, el('span', { class: 'avatar', 'aria-hidden': 'true' }, initials || 'S'), el('span', { class: 'profile-copy' }, el('strong', {}, user.displayName), el('small', {}, user.role)), signOut)),
    el('main', { class: 'main', id: 'main-content', tabindex: '-1' }, el('header', { class: 'topbar' }, a([icon('sider-mark', 28), ' Sider'], '/resources', 'mobile-brand'), el('div', { class: 'breadcrumbs' }, el('span', {}, 'Workspace'), el('span', { 'aria-hidden': 'true' }, '/'), el('span', {}, heading)), mobile), logoutError, content)));
  document.title = `${heading} · Sider`;
  // Client navigation commits the complete staged view in one paint.
  if (root === liveRoot) publishView();
  return content;
}

async function login(signal = pageController.signal) {
  signal.throwIfAborted();
  document.title = 'Sign in · Sider';
  const { mountBotChallenge } = await import('./bot-challenge.mjs');
  signal.throwIfAborted();
  const departed = error => signal.aborted || error?.name === 'AbortError';
  const target = safeReturnTo(new URLSearchParams(location.search).get('returnTo'));
  let busy = false, syncing = false, needsChallenge = new URLSearchParams(location.search).get('challenge') === 'required';
  let botToken = '', text = needsChallenge ? 'Please complete the traffic check before continuing.' : '', widget;
  const challengeSlot = el('div', { hidden: true });
  const err = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const start = el('button', { type: 'button', class: 'button primary login-button' });
  const challengeMessage = el('p');
  function render() {
    if (signal.aborted) return;
    start.disabled = busy || needsChallenge && !botToken;
    start.replaceChildren(...(busy ? ['Connecting…'] : needsChallenge ? ['Continue'] : ['Continue with Launchpad ', el('span', { 'aria-hidden': 'true' }, '→')]));
    err.hidden = needsChallenge || !text; err.textContent = text;
    challengeMessage.textContent = text;
  }
  function setMessage(value) { text = value; render(); }
  async function showChallenge() {
    if (signal.aborted) return;
    widget?.destroy(); botToken = ''; needsChallenge = true;
    const host = el('div'); challengeSlot.hidden = false;
    challengeSlot.replaceChildren(el('div', { class: 'challenge' }, challengeMessage, host)); render();
    try {
      const handle = await mountBotChallenge(host, 'oauth_start', token => { if (!signal.aborted) { botToken = token; render(); } }, { siteKey: config.botSiteKey, signal, onError: () => { if (!signal.aborted) setMessage('Launchpad sign-in is temporarily unavailable.'); } });
      if (signal.aborted) { handle.destroy(); return; } widget = handle;
    } catch (error) { if (!departed(error)) setMessage('Launchpad sign-in is temporarily unavailable.'); }
  }
  disposers.push(() => widget?.destroy());
  start.addEventListener('click', () => { void (needsChallenge ? completeSession(botToken) : signIn()); });
  const editorial = el('section', { class: 'auth-editorial' },
      el('div', { class: 'auth-brand' }, icon('sider-mark', 28), el('strong', {}, 'Sider')),
      el('div', { class: 'auth-editorial-copy' }, el('h1', {}, 'The useful things your classmates found, kept in one place.'), el('p', {}, 'Search notes, guides, worksheets, and reference files shared inside the SHSID student community.')),
      el('div', { class: 'resource-preview' }, [
        ['Calculus I — Complete Summary', 'PDF · 2.4 MB'], ['IB Economics Data Set', 'XLS · 4.8 MB'], ['Biology SL — Cell Division', 'PPT · 7.1 MB'],
      ].map(([name, info]) => el('div', {}, icon('resource-dot', 8), el('span', {}, el('strong', {}, name), el('small', {}, info))))));
  const panel = el('section', { class: 'auth-panel' }, el('div', { class: 'auth-card', 'aria-labelledby': 'login-title' },
      el('div', { class: 'auth-monogram', 'aria-hidden': 'true' }, 'S'), el('h2', { id: 'login-title' }, 'A shared shelf for student knowledge.'),
      el('p', { class: 'auth-intro' }, 'Sign in with your school workspace to browse and share verified resources.'), challengeSlot, err, start,
      el('p', { class: 'privacy-note' }, 'By continuing, you agree to the student resource ', a('policy', '/terms'), ' and ', a('privacy notice', '/privacy'), '.')));
  root.replaceChildren(el('main', { class: 'auth-page' }, editorial, panel));
  publishView();
  render();
  try { const result = await api('/api/me', { redirectOnUnauthorized: false, signal }); signal.throwIfAborted(); if (result.user) { location.replace(target); return; } }
  catch (error) { if (departed(error)) return; if (error.status !== 401) noticeError(err, error); }
  async function completeSession(challengeToken, interactive = true) {
    const sdk = window.LaunchpadAuth;
    if (!sdk || syncing || signal.aborted) return;
    syncing = true; busy = true; setMessage('');
    try {
      const state = await sdk.ready(); signal.throwIfAborted(); const accessToken = state.accessToken || sdk.state.accessToken;
      if (!state.user || !accessToken) { if (interactive) { await sdk.signIn(); signal.throwIfAborted(); } busy = false; render(); return; }
      let returnTo = target;
      try { if (target === '/resources') returnTo = safeReturnTo(sessionStorage.getItem('sider-return-to')); } catch { /* Navigation hint only. */ }
      let result;
      try { result = await api('/api/auth/launchpad/session', { method: 'POST', body: { accessToken, returnTo, ...(challengeToken ? { botToken: challengeToken } : {}) }, anonymous: true, signal }); signal.throwIfAborted(); }
      catch (error) {
        if (departed(error)) return;
        if (['bot_challenge_required', 'bot_challenge_invalid'].includes(error.code)) {
          busy = false; setMessage('Please complete the traffic check before continuing.'); await showChallenge(); return;
        }
        if (['invalid_token', 'login_exchange_replayed'].includes(error.code)) sdk.signOut();
        busy = false; setMessage(error.code === 'suspended' ? 'This Sider account is suspended.' : error.code === 'login_exchange_replayed' ? error.message : 'Launchpad sign-in could not be completed. Please try again.'); return;
      }
      signal.throwIfAborted(); await saveSession(result); signal.throwIfAborted();
      try { await api('/api/me', { redirectOnUnauthorized: false, signal }); signal.throwIfAborted(); }
      catch (error) { if (departed(error)) return; busy = false; setMessage('Sider could not save your session. Please try again.'); return; }
      sdk.signOut(); try { sessionStorage.removeItem('sider-return-to'); } catch { /* optional navigation hint */ }
      signal.throwIfAborted();
      location.assign(safeReturnTo(result.redirectUrl));
    } catch (error) {
      if (departed(error)) return;
      busy = false; setMessage('Launchpad sign-in is temporarily unavailable.');
    } finally { syncing = false; render(); }
  }
  async function signIn() {
    if (signal.aborted) return;
    const sdk = window.LaunchpadAuth;
    if (!sdk) { setMessage('Launchpad sign-in is still loading. Please try again.'); return; }
    busy = true; setMessage('');
    try {
      sessionStorage.setItem('sider-return-to', target);
      const state = await sdk.ready(); signal.throwIfAborted();
      if (state.user && state.accessToken) await completeSession(); else await sdk.signIn();
      signal.throwIfAborted();
    } catch (error) { if (!departed(error)) { busy = false; setMessage('Launchpad sign-in is temporarily unavailable.'); } }
  }
  if (needsChallenge) void showChallenge();
  try {
    await loadScript('/dashboard-api/oauth/sdk.js');
    signal.throwIfAborted();
    if (!needsChallenge) await completeSession(undefined, false);
    signal.throwIfAborted();
  } catch (error) { if (!departed(error)) setMessage('Launchpad sign-in is temporarily unavailable.'); }
}

function renderHighlighted(segments, fallback) {
  return !Array.isArray(segments) || !segments.length ? [document.createTextNode(fallback)] : segments.map(part => el(part.highlighted ? 'mark' : 'span', {}, part.text));
}
function resourceRows(items) {
  return el('div', { class: 'resource-list' }, items.map((item, index) => el('a', { class: 'resource-row group', href: `/resources/${item.id}?source=search`, 'data-prefetch-intent': true, 'data-prefetch-idle': index < 3 },
    el('span', { class: 'row-handle', 'aria-hidden': 'true' }, '⋮⋮'),
    el('span', { class: 'file-icon', 'aria-hidden': 'true' }, fileLabel(item.originalFilename, item.mimeType)),
    el('div', { class: 'row-main' }, el('strong', { class: 'resource-title' }, renderHighlighted(item.highlights?.title, item.title)),
      el('p', { class: 'resource-description' }, renderHighlighted(item.highlights?.description, item.description || item.originalFilename)),
      el('div', { class: 'row-meta' }, el('span', { class: 'row-author' }, item.authorName), el('span', { 'aria-hidden': 'true' }, '·'),
        el('time', { class: 'row-date', datetime: item.publishedAt }, date(item.publishedAt)), el('span', { 'aria-hidden': 'true' }, '·'), el('span', { class: 'row-size' }, formatBytes(item.sizeBytes)))),
    el('span', { class: 'row-trailing' }, el('span', { class: 'tag' }, item.tags[0] || 'Resource'), el('span', { class: 'row-arrow', 'aria-hidden': 'true' }, '↗')))));
}
async function resources(signal = pageController.signal) {
  signal.throwIfAborted();
  const content = shell('resources', 'Resources');
  content.append(title('Resources', null, el('a', { href: '/resources/new', class: 'button primary', 'data-prefetch-intent': true, 'data-prefetch-idle': true }, el('span', { 'aria-hidden': 'true' }, '＋'), ' Upload resource')));
  const params = new URLSearchParams(location.search), pages = new PageCollection();
  const saved = pageRestore?.view?.resources;
  let q = (params.get('q') || '').trim().slice(0, 120), type = Object.hasOwn(fileTypeLabels, params.get('type')) ? params.get('type') : '';
  let tag = (params.has('tag') ? params.get('tag') : params.get('collection') === 'peer-advisors' ? 'PA' : '').trim().slice(0, 30); if (isPaTag(tag)) tag = 'PA';
  const input = el('input', { id: 'resource-search', name: 'q', value: q, maxlength: '120', placeholder: 'Search resources…', autocomplete: 'off' });
  const err = message(), summary = el('span', { class: 'results-summary', role: 'status' }), resultsTitle = el('h2'), list = el('div', { class: 'search-results' });
  const challengeSlot = el('div', { hidden: true });
  const chips = el('div', { class: 'active-filters', 'aria-label': 'Applied search filters', hidden: true });
  const more = btn('Load more resources', () => load(true)); more.hidden = true;
  const pagination = el('div', { class: 'pagination', hidden: true }, more);
  const tagSelect = el('select', { 'aria-label': 'Filter by tag', onchange: () => { tag = tagSelect.value; void load(false); } }, el('option', { value: '' }, 'All tags'));
  const typeSelect = el('select', { 'aria-label': 'Filter by file type', onchange: () => { type = typeSelect.value; void load(false); } }, el('option', { value: '' }, 'All file types'), Object.entries(fileTypeLabels).map(([value, label]) => el('option', { value }, label))); typeSelect.value = type;
  if (saved) input.value = saved.draft;
  let filtersOpen = saved?.filtersOpen || false;
  const filters = el('div', { class: `library-filters${filtersOpen ? ' expanded' : ''}` });
  const toggle = btn([], () => { filtersOpen = !filtersOpen; filters.classList.toggle('expanded', filtersOpen); toggle.setAttribute('aria-expanded', String(filtersOpen)); }, 'button filter-toggle');
  toggle.setAttribute('aria-expanded', String(filtersOpen)); toggle.setAttribute('aria-controls', 'file-type-options');
  filters.append(toggle, el('label', { class: 'file-type-filter', id: 'file-type-options' }, el('span', {}, 'File type'), typeSelect));
  const submit = el('button', { class: 'button search-submit', type: 'submit' }, 'Search');
  const retry = btn('Try again', () => load(false)); retry.hidden = true;
  content.append(el('form', { class: 'searchbox', role: 'search', 'aria-label': 'Search the resource library', onsubmit: event => { event.preventDefault(); q = input.value.trim().slice(0, 120); input.value = q; void load(false); } },
    icon('search', 20), el('label', { for: 'resource-search', class: 'sr-only' }, 'Search resources'), input, submit),
    el('div', { class: 'library-controls' }, el('label', { class: 'file-type-filter' }, el('span', {}, 'Tag'), tagSelect), filters), chips,
    el('div', { class: 'results-heading' }, resultsTitle, summary), challengeSlot, err, list, retry, pagination, footer());
  let controller, widget, awaitingChallenge = false;
  disposers.push(() => { controller?.abort(); widget?.destroy(); });
  viewSnapshot = () => ({ resources: { draft: input.value, filtersOpen, items: structuredClone(pages.items), nextCursor: pages.nextCursor } });
  function renderFilters() {
    chips.hidden = !q && !type && !tag;
    const typeChip = type ? btn([fileTypeLabels[type], ' ', el('span', { 'aria-hidden': 'true' }, '×')], () => { type = ''; typeSelect.value = ''; return load(false); }, 'filter-chip') : null;
    if (typeChip) typeChip.setAttribute('aria-label', `Remove ${fileTypeLabels[type]} filter`);
    chips.replaceChildren(
      tag && btn(`${tag} ×`, () => { tag = ''; tagSelect.value = ''; return load(false); }, 'filter-chip'),
      q && el('span', { class: 'filter-chip' }, `Search · ${q}`),
      typeChip || '',
      btn('Clear all', () => { input.value = q = tag = type = ''; tagSelect.value = typeSelect.value = ''; return load(false); }, 'clear-filters'));
    toggle.replaceChildren(`File type${type ? ' · 1' : ''}`, el('span', { 'aria-hidden': 'true' }, '⌄'));
    resultsTitle.textContent = q ? 'Search results' : 'Latest resources';
  }
  function renderSummary(state) {
    summary.replaceChildren(state || `${pages.items.length}${pages.nextCursor ? '+' : ''} ${pages.items.length === 1 ? 'resource' : 'resources'}`, el('span', { 'aria-hidden': 'true' }, ' · '), q ? 'By relevance' : 'Newest first');
  }
  async function load(append, botToken, initial = false) {
    if (signal.aborted) return;
    widget?.destroy(); widget = null; challengeSlot.hidden = true; awaitingChallenge = false;
    controller?.abort(); controller = new AbortController();
    const ownController = controller; const cursor = append ? pages.nextCursor : null;
    if (!append) { pages.reset(); list.replaceChildren(el('div', { class: 'empty' }, el('p', {}, 'Loading resources…'))); if (!initial) history.replaceState(history.state, '', '/resources' + (searchParams({ q, type, tag }).size ? '?' + searchParams({ q, type, tag }) : '')); }
    renderFilters(); renderSummary('Updating…'); submit.textContent = 'Searching…'; more.textContent = 'Loading…';
    submit.disabled = more.disabled = true; retry.hidden = true; err.textContent = ''; list.setAttribute('aria-busy', 'true');
    try {
      const result = await api('/api/resources?' + searchParams({ q, type, tag }, cursor), { signal: ownController.signal, token: botToken, fresh: !initial });
      if (ownController.signal.aborted) return;
      pages.accept(result, append);
      list.replaceChildren(pages.items.length ? resourceRows(pages.items) : q || type || tag ? empty('No matching resources', 'Try another search, tag, or file type.') : empty('No resources yet', 'The first scanned resource will appear here after it is published.'));
      renderSummary();
    } catch (error) {
      if (ownController.signal.aborted) return;
      renderSummary('Search unavailable');
      if (['bot_challenge_required', 'bot_challenge_invalid'].includes(error.code)) {
        awaitingChallenge = true;
        err.textContent = ''; challengeSlot.hidden = false; challengeSlot.className = 'challenge';
        const target = el('div'); challengeSlot.replaceChildren(el('p', {}, 'Please complete the traffic check to continue searching.'), target);
        if (!pages.items.length) list.replaceChildren(el('div', { class: 'empty' }, el('p', {}, 'Complete the traffic check above to view resources.')));
        try { widget = await mountBotChallenge(target, 'search', token => { if (token) void load(append, token); }, { siteKey: config.botSiteKey, signal: AbortSignal.any([signal, ownController.signal]) }); }
        catch (failure) { if (!ownController.signal.aborted) noticeError(err, failure); }
      } else {
        err.textContent = error.code === 'rate_limited' ? 'Too many searches. Please wait and try again.' : 'Search is temporarily unavailable.';
        if (!append) list.replaceChildren(empty('Couldn’t load resources', 'Try your search again in a moment.'));
        retry.textContent = error.code === 'invalid_cursor' ? 'Reload first page' : 'Try again'; retry.hidden = false;
      }
    } finally { if (!ownController.signal.aborted) { submit.disabled = more.disabled = false; submit.textContent = 'Search'; more.textContent = 'Load more resources'; more.hidden = !pages.nextCursor || !retry.hidden || awaitingChallenge; pagination.hidden = more.hidden; list.setAttribute('aria-busy', 'false'); } }
  }
  try {
    const options = await api('/api/resources/tags', { signal }); const tags = [...new Set([...(options.tags || suggestedTags), ...(tag ? [tag] : [])])];
    tagSelect.append(...tags.map(t => el('option', { value: t }, t))); tagSelect.value = tag;
  } catch { if (signal.aborted) return; tagSelect.append(...suggestedTags.map(t => el('option', { value: t }, t))); }
  if (signal.aborted) return;
  if (saved) { pages.accept({ items: saved.items, nextCursor: saved.nextCursor }); renderFilters(); renderSummary(); list.replaceChildren(pages.items.length ? resourceRows(pages.items) : empty('No matching resources', 'Try another search, tag, or file type.')); more.hidden = !pages.nextCursor; pagination.hidden = more.hidden; }
  else await load(false, undefined, true);
}

function tagPicker(initial = []) {
  const tags = el('input', { name: 'tags', value: initial.map(tag => isPaTag(tag) ? 'PA' : tag).join(', '), maxlength: '309', placeholder: 'Add tags, separated by commas' });
  const select = el('select', { 'aria-label': 'Choose a tag' });
  function refresh() {
    const selected = tags.value.split(',').map(value => isPaTag(value) ? 'PA' : value.trim()).filter(Boolean);
    select.replaceChildren(el('option', { value: '' }, 'Choose a tag…'), ...suggestedTags.map(tag => el('option', { value: tag, disabled: (user.role !== 'admin' && isPaTag(tag)) || selected.includes(tag) }, tag + (isPaTag(tag) && user.role !== 'admin' ? ' (admin only)' : ''))));
    select.value = '';
  }
  tags.addEventListener('input', refresh);
  select.addEventListener('change', () => {
    const selected = tags.value.split(',').map(value => isPaTag(value) ? 'PA' : value.trim()).filter(Boolean);
    if (select.value && selected.length < 10 && !selected.some(value => value.toLowerCase() === select.value.toLowerCase())) tags.value = [...selected, select.value].join(', ');
    refresh();
  });
  refresh();
  return { input: tags, node: el('div', { class: 'field' }, el('label', {}, el('span', {}, 'Tags'), tags), el('label', {}, el('span', { class: 'sr-only' }, 'Choose a tag'), select), el('small', {}, 'Up to 10 tags. PA requires an administrator.')) };
}
function metadataForm(initial = {}, editing = false) {
  const titleInput = el('input', { name: 'title', value: initial.title || '', required: true, minlength: editing ? undefined : '1', maxlength: '120', placeholder: editing ? undefined : 'Enter a clear resource title' });
  const description = el('textarea', { name: 'description', maxlength: '2000', rows: editing ? '4' : '5', placeholder: editing ? undefined : 'Describe what this resource covers' }, initial.description || '');
  const tags = tagPicker(initial.tags || []);
  const fields = [field('Title', titleInput, !editing && 'Keep it specific and easy to scan.'), field('Description', description, !editing && 'A short summary helps classmates judge relevance.'), tags.node];
  const form = el('form', { class: editing ? 'inline-form' : 'upload-form' }, fields);
  return { form, fields, values: () => ({ title: titleInput.value.trim(), description: description.value.trim(), tags: normalizeTags(tags.input.value, user.role === 'admin') }) };
}
async function detail(id, options = {}) {
  const signal = options.signal || pageController.signal;
  signal.throwIfAborted();
  signal.throwIfAborted();
  const departed = error => signal.aborted || error?.name === 'AbortError';
  const content = shell('resources', 'Resource detail'); content.classList.add('resource-detail-page'); content.append(a('← Back to resources', '/resources', 'back'));
  const { resource } = await api(`/api/resources/${id}`, { signal }); signal.throwIfAborted();
  const managed = resource.authorId === user.id || user.role === 'admin';
  const err = message(); err.className = 'action-message'; err.hidden = !options.message; err.textContent = options.message || '';
  const panels = el('div'), challengeSlot = el('div', { hidden: true }), actions = el('div', { class: 'action-row' });
  const menuItems = el('div', { class: 'action-menu-popover' });
  const moreMenu = el('details', { class: 'action-menu' }, el('summary', { class: 'button icon-button', 'aria-label': 'More resource actions' }, el('span', { 'aria-hidden': 'true' }, '•••')), menuItems);
  const actionSection = el('section', { class: 'resource-actions', 'aria-label': 'Resource actions' }, actions, challengeSlot, err, panels);
  const extension = fileLabel(resource.originalFilename, resource.mimeType);
  content.append(el('div', { class: 'detail-columns' }, el('article', { class: 'resource-article' },
    el('div', { class: 'file-icon', 'aria-hidden': 'true' }, extension), el('h1', {}, resource.title),
    el('div', { class: 'detail-meta' }, el('span', {}, `Shared by ${resource.authorName}`), el('span', {}, '·'), el('span', {}, resource.status === 'active' ? 'Active' : resource.status), resource.publishedAt && [el('span', {}, '·'), time(resource.publishedAt)]),
    el('div', { class: 'tags' }, resource.tags.map((tag, index) => el('span', { class: `tag tone-${index % 3}` }, tag))),
    el('section', { class: 'file-panel', 'aria-label': 'File details' }, el('div', { class: 'file-icon', 'aria-hidden': 'true' }, extension),
      el('div', {}, el('strong', {}, resource.originalFilename), el('small', {}, `${resource.mimeType} · ${formatBytes(resource.sizeBytes)} · ${resource.status === 'active' ? 'scanned and verified' : resource.status}`)), status(resource.status)),
    resource.status !== 'active' && el('p', { class: 'notice' }, 'This resource is visible only to its author or an administrator and cannot be downloaded in its current state.'), actionSection,
    el('section', { class: 'resource-description-section', 'aria-labelledby': 'description-heading' }, el('h2', { id: 'description-heading' }, 'About this resource'), el('p', { class: 'detail-body' }, resource.description || 'No description was provided.')),
    el('p', { class: 'notice' }, el('span', { 'aria-hidden': 'true' }, '●'), 'Shared privately with SHSID students. Download links are available while you are signed in.'))));
  let editing = false, reporting = false, removing = false, challengeAction = null, botToken = '', widget, challengeAbort;
  let reportSubmit, editButton, reportButton, saving = false, submittingReport = false, deleting = false, removingResource = false;
  const button = (text, handler, cls = 'button') => el('button', { type: 'button', class: cls, onclick: () => { if (!signal.aborted) void handler(); } }, text);
  const setMessage = text => { if (!signal.aborted) { err.textContent = text; err.hidden = !text; } };
  function updateButtons() {
    editButton?.setAttribute('aria-expanded', String(editing));
    if (reportButton) reportButton.textContent = reporting ? 'Close report form' : 'Report resource';
    if (reportSubmit) reportSubmit.disabled = challengeAction === 'report' && !botToken;
  }
  function clearChallenge() {
    challengeAbort?.abort(); widget?.destroy(); widget = undefined; challengeAbort = undefined;
    challengeAction = null; botToken = ''; challengeSlot.replaceChildren(); challengeSlot.hidden = true; updateButtons();
  }
  async function setChallenge(action) {
    if (signal.aborted) return;
    clearChallenge(); challengeAction = action; challengeAbort = new AbortController();
    const controller = challengeAbort;
    const host = el('div'); challengeSlot.hidden = false; challengeSlot.replaceChildren(el('div', { class: 'challenge' }, host)); updateButtons();
    const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
    controller.signal.addEventListener('abort', () => signal.removeEventListener('abort', abort), { once: true });
    try {
      const handle = await mountBotChallenge(host, action, token => { if (challengeAction === action && !controller.signal.aborted) { botToken = token; updateButtons(); } }, { siteKey: config.botSiteKey, signal: controller.signal });
      if (signal.aborted || controller.signal.aborted) handle.destroy(); else widget = handle;
    } catch (error) { if (!departed(error)) setMessage('The traffic check is temporarily unavailable.'); }
  }
  disposers.push(clearChallenge);
  const needsChallenge = error => ['bot_challenge_required', 'bot_challenge_invalid'].includes(error.code);
  function failureMessage(text, error) { setMessage(text + (error.status === 429 ? ` Wait ${error.retryAfter || 60} seconds before trying again.` : '')); }
  async function download() {
    if (signal.aborted) return;
    setMessage('Preparing a private download link…');
    try {
      const result = await api(`/api/resources/${id}/download`, { method: 'POST', body: botToken ? { botToken } : {}, signal }); signal.throwIfAborted();
      if (!result.url) { setMessage('The download is not available right now.'); return; }
      const url = validStorageUrl(result.url, location.origin); clearChallenge(); signal.throwIfAborted(); location.assign(url); setMessage('');
    } catch (error) {
      if (departed(error)) return;
      if (needsChallenge(error)) { setMessage('Complete the check and try downloading again.'); await setChallenge('download'); return; }
      failureMessage('The download is not available right now.', error);
    }
  }
  async function save(metadata) {
    if (saving || signal.aborted) return; saving = true;
    try {
      let values;
      try { values = metadata.values(); }
      catch (error) { setMessage(error.message.includes('administrators') ? 'Only administrators can assign the PA tag.' : 'The changes could not be saved.'); return; }
      await api(`/api/resources/${id}`, { method: 'PATCH', body: { ...values, ...(challengeAction === 'resource_write' && botToken ? { botToken } : {}) }, signal }); signal.throwIfAborted();
      editing = false; updateButtons(); panels.replaceChildren(); clearChallenge(); setMessage('Resource details updated.');
      signal.throwIfAborted(); await refreshPage({ message: 'Resource details updated.' });
    } catch (error) {
      if (departed(error)) return;
      if (needsChallenge(error)) { setMessage('Complete the check and save your changes again.'); await setChallenge('resource_write'); return; }
      failureMessage(error.status === 403 ? 'Only administrators can assign the PA tag.' : 'The changes could not be saved.', error);
    } finally { saving = false; }
  }
  async function report(reason, details) {
    if (submittingReport || signal.aborted) return; submittingReport = true;
    try {
      await api(`/api/resources/${id}/reports`, { method: 'POST', body: { reason: reason.value, details: details.value, ...(botToken ? { botToken } : {}) }, signal }); signal.throwIfAborted();
      setMessage('Report submitted for administrator review.'); reporting = false; panels.replaceChildren(); clearChallenge(); updateButtons();
    } catch (error) {
      if (departed(error)) return;
      if (needsChallenge(error)) { setMessage('Complete the check and submit the report again.'); await setChallenge('report'); return; }
      failureMessage(error.code === 'report_already_open' ? 'You already have an open report for this resource.' : 'The report could not be submitted.', error);
    } finally { submittingReport = false; }
  }
  async function deleteOwn() {
    if (signal.aborted) return;
    moreMenu.open = false;
    if (deleting || !confirm('Delete this resource? New download links will stop immediately.')) return;
    deleting = true;
    try { await api(`/api/resources/${id}`, { method: 'DELETE', token: challengeAction === 'resource_write' ? botToken : undefined, signal }); signal.throwIfAborted(); await navigate('/me/resources'); }
    catch (error) {
      if (departed(error)) return;
      if (needsChallenge(error)) { setMessage('Complete the check and delete the resource again.'); await setChallenge('resource_write'); return; }
      failureMessage('The resource could not be deleted.', error);
    } finally { deleting = false; }
  }
  async function removeAsAdmin(reason) {
    if (removingResource || signal.aborted) return; removingResource = true;
    try { await api(`/api/admin/resources/${id}/moderate`, { method: 'POST', body: { action: 'remove', reason: reason.value, ...(challengeAction === 'admin' && botToken ? { botToken } : {}) }, signal }); signal.throwIfAborted(); await navigate('/resources'); }
    catch (error) {
      if (departed(error)) return;
      if (needsChallenge(error)) { setMessage('Complete the check and remove the resource again.'); await setChallenge('admin'); return; }
      failureMessage('The resource could not be removed.', error);
    } finally { removingResource = false; }
  }
  function renderPanel() {
    panels.replaceChildren(); reportSubmit = undefined;
    if (removing) {
      const reason = el('textarea', { name: 'reason', required: true, maxlength: '1000', rows: '3', placeholder: 'Explain the policy or safety reason for removal' });
      const form = el('form', { class: 'inline-form destructive-form', onsubmit: event => { event.preventDefault(); void removeAsAdmin(reason); } },
        el('h2', {}, 'Remove this resource'), el('p', {}, 'It will disappear immediately. The stored file will be deleted after the configured recovery period, and this action will be recorded in the audit log.'), field('Reason', reason),
        el('div', { class: 'action-row' }, el('button', { type: 'submit', class: 'button danger' }, 'Remove resource'), button('Cancel', () => { removing = false; renderPanel(); })));
      panels.append(form);
    } else if (reporting) {
      const reason = el('select', { name: 'reason', required: true }, [['copyright_privacy', 'Copyright or privacy'], ['malware', 'Malicious file'], ['inappropriate', 'Inappropriate content'], ['spam', 'Spam'], ['other', 'Other']].map(([value, label]) => el('option', { value }, label)));
      const details = el('textarea', { name: 'details', rows: '3', maxlength: '1000' }); reportSubmit = el('button', { type: 'submit', class: 'button' }, 'Submit report');
      panels.append(el('form', { class: 'inline-form', onsubmit: event => { event.preventDefault(); void report(reason, details); } }, field('Reason', reason), field('Details', details), reportSubmit));
    } else if (editing) {
      const metadata = metadataForm(resource, true);
      metadata.form.append(el('button', { type: 'submit', class: 'button' }, 'Save changes'));
      metadata.form.addEventListener('submit', event => { event.preventDefault(); void save(metadata); }); panels.append(metadata.form);
    }
    updateButtons();
  }
  if (resource.status === 'active') actions.append(button('Download', download, 'button primary'));
  if (managed) {
    editButton = button('Edit details', () => { editing = !editing; reporting = false; removing = false; clearChallenge(); renderPanel(); }); editButton.setAttribute('aria-expanded', 'false'); actions.append(editButton);
    if (user.role === 'admin') menuItems.append(button('Remove resource', () => {
      moreMenu.open = false;
      const alreadyOpen = removing; removing = true; editing = false; reporting = false; clearChallenge(); setMessage('');
      if (!alreadyOpen) renderPanel(); else updateButtons();
    }, 'danger'));
    else menuItems.append(button('Delete resource', deleteOwn, 'danger'));
  } else if (resource.status === 'active') {
    reportButton = button('Report resource', () => { moreMenu.open = false; reporting = !reporting; editing = false; removing = false; clearChallenge(); renderPanel(); }, ''); menuItems.append(reportButton);
  }
  actions.append(moreMenu);
}

async function mine(signal = pageController.signal) {
  const content = shell('mine', 'My uploads'); content.classList.add('uploads-page');
  const params = new URLSearchParams(location.search), filter = ['all', 'active', 'scanning', 'unavailable'].includes(params.get('status')) ? params.get('status') : 'all';
  const pages = new PageCollection(), list = el('div'), err = message(), challengeSlot = el('div', { hidden: true }); let busy = false;
  const more = btn('Load more uploads', () => load(true)); more.hidden = true;
  const pagination = el('div', { class: 'pagination', hidden: true }, more);
  content.append(title('My uploads', null, a('Upload resource', '/resources/new', 'button primary')), challengeSlot, err, list, pagination);
  const matches = value => filter === 'all' || (filter === 'active' ? value === 'active' : filter === 'scanning' ? ['pending', 'scanning'].includes(value) : !['active', 'pending', 'scanning'].includes(value));
  function render() {
    const visibleItems = pages.items.filter(item => matches(item.status));
    const activeCount = pages.items.filter(item => item.status === 'active').length;
    const scanningCount = pages.items.filter(item => ['pending', 'scanning'].includes(item.status)).length;
    if (!pages.items.length) {
      const block = empty('No uploads yet', 'Upload your first resource when you are ready.'); block.append(a('Start an upload', '/resources/new', 'button primary')); list.replaceChildren(block);
    } else {
      const summary = el('section', { class: 'upload-summary' },
        el('div', {}, el('strong', {}, `${pages.items.length} resources`), el('small', {}, `${activeCount} active · ${scanningCount} scanning`)),
        el('div', { class: 'status-legend' }, status('active'), status('scanning')));
      const toolbar = el('div', { class: 'uploads-toolbar' }, el('h2', {}, filter === 'all' ? 'All uploads' : `${filter.charAt(0).toUpperCase()}${filter.slice(1)} uploads`),
        el('nav', { class: 'status-filters', 'aria-label': 'Filter uploads by status' }, ['all', 'active', 'scanning', 'unavailable'].map(value => el('a', { href: value === 'all' ? '/me/resources' : `/me/resources?status=${value}`, class: filter === value ? 'selected' : null, 'aria-current': filter === value ? 'page' : null }, value.charAt(0).toUpperCase() + value.slice(1)))));
      const head = el('div', { class: 'upload-table-head', 'aria-hidden': 'true' }, el('span'), el('span', {}, 'Name'), el('span', {}, 'Uploaded'), el('span', {}, 'Status'));
      const rows = visibleItems.length ? el('div', { class: 'upload-list' }, visibleItems.map(item => el('article', { class: 'upload-row group' },
        el('span', { class: 'file-icon', 'aria-hidden': 'true' }, fileLabel(item.originalFilename)),
        el('div', { class: 'upload-copy' }, el('strong', {}, item.status === 'deleted' ? item.title : a(item.title, `/resources/${item.id}`)), el('small', {}, item.originalFilename)), time(item.createdAt), status(item.status))))
        : empty(`No ${filter} uploads`, 'Choose another status to see the rest of your resources.');
      if (!visibleItems.length) rows.classList.add('compact');
      list.replaceChildren(summary, toolbar, head, rows);
    }
    more.hidden = true; pagination.hidden = true;
  }
  async function load(fresh = false) {
    if (busy) return; busy = true; more.disabled = true; err.textContent = '';
    try { pages.accept(await api('/api/me/resources?view=workspace', { signal, fresh })); render(); }
    catch (error) { noticeError(err, error); err.append(btn('Reload first page', () => load(true))); }
    finally { busy = false; more.disabled = false; }
  }
  await load(false);
  if (signal.aborted) return;
  if (pages.items.some(item => item.status === 'scanning')) schedulePoll(async () => { await load(true); return pages.items.some(item => item.status === 'scanning'); }, err, 10000);
}

function schedulePoll(work, errorNode, initial = 5000) {
  let delay = initial, timer, active = true;
  async function tick() {
    if (!active || pageController.signal.aborted) return;
    if (document.visibilityState === 'visible') {
      try { const again = await work(); delay = initial; if (!again) { active = false; return; } }
      catch (error) { if (pageController.signal.aborted) return; delay = retryDelay(error, delay); errorNode.textContent = 'Status updates are temporarily unavailable. Your files remain private until checks pass. ' + (error.retryAfter ? `Retrying in ${error.retryAfter} seconds.` : 'Check My uploads later.'); }
    }
    timer = setTimeout(tick, delay);
  }
  timer = setTimeout(tick, delay); disposers.push(() => { active = false; clearTimeout(timer); });
}

async function upload(signal = pageController.signal) {
  const pageSignal = signal; pageSignal.throwIfAborted();
  pageSignal.throwIfAborted();
  pageSignal.throwIfAborted();
  const content = shell('resources', 'Upload resource'); content.classList.add('upload-page');
  content.append(a('←  Back to resources', '/resources', 'back'));
  const main = el('section', { class: 'upload-main' }, el('h1', {}, 'Upload a resource'), el('p', { class: 'upload-intro' }, 'Add a useful file to the shared shelf. Every upload is validated and scanned before other students can see it.'));
  const guidance = el('aside', { class: 'upload-guidance' }, el('h2', {}, 'Make it useful, safe, and easy to find.'),
    [['01', 'Use a specific title', 'Mention the subject and what the file contains.'], ['02', 'Remove personal data', 'Check names, IDs, comments, and hidden metadata.'], ['03', 'Add focused tags', 'Three to five precise tags are usually enough.']].map(([number, heading, description]) => el('div', { class: 'guidance-item' }, el('span', {}, number), el('div', {}, el('strong', {}, heading), el('p', {}, description)))));
  content.append(el('div', { class: 'upload-columns' }, main, guidance));
  if (config.uploadsEnabled === false) { main.append(empty('Uploads temporarily unavailable', 'The malware scanning service has not been configured. Sign-in and existing resources remain available, but new files cannot be accepted safely.')); return; }
  let metadata = metadataForm(); const form = metadata.form;
  const err = el('p', { class: 'form-error', role: 'alert' }); const pollError = el('p', { role: 'status', hidden: true }); const rows = el('ul', { class: 'upload-queue', 'aria-label': 'File upload progress' });
  rows.hidden = true;
  const uploadBytes = bytes => bytes < 1024 ** 2 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  const selectedNames = el('strong', {}, 'Choose up to 5 files from your device');
  const files = el('input', { name: 'file', type: 'file', multiple: true, required: true, accept: '.pdf,.docx,.pptx,.xlsx,.txt,.png,.jpg,.jpeg' });
  const dropzone = el('span', { class: 'dropzone' }, selectedNames, el('small', {}, `PDF, Office, text, PNG or JPEG · up to ${uploadBytes(config.uploadMaxBytes)} per file`), files);
  files.addEventListener('change', () => { const selected = Array.from(files.files); files.setCustomValidity(selected.length > 5 ? 'Choose at most 5 files.' : ''); selectedNames.textContent = selected.length ? selected.map(file => file.name).join(', ') : 'Choose up to 5 files from your device'; dropzone.classList.toggle('selected', selected.length > 0); });
  const fileField = el('label', { class: 'field file-field' }, el('span', {}, 'FILES (5 files at most)'), dropzone, el('small', {}, 'Each file becomes a separate resource with the same title, description and tags.'));
  const fields = el('fieldset', { class: 'upload-fields' }, metadata.fields, fileField);
  const submit = el('button', { type: 'submit', class: 'button primary' }, 'Upload resources');
  const bottomMessage = el('small', {}, 'Files remain private until the safety check passes.');
  const bottom = el('div', { class: 'form-bottom' }, bottomMessage, submit);
  const another = el('button', { type: 'button', class: 'button', hidden: true, onclick: () => resetBatch() }, 'Start another batch');
  form.replaceChildren(fields, err, rows, pollError, bottom, another); main.append(form);
  let queue, batchNumber = 0, pollTimer, pollController = new AbortController(), stopped = false;
  const queueRows = new Map();
  function clearWidget(row) {
    row.controller?.abort(); row.widget?.destroy(); row.widget = undefined; row.controller = undefined;
    row.challengeAction = undefined; row.challenge.replaceChildren(); row.challenge.hidden = true;
  }
  function resetBatch() {
    if (pageSignal.aborted) return;
    queue?.dispose(); queue = undefined; batchNumber++;
    pollController.abort(); pollController = new AbortController();
    for (const row of queueRows.values()) clearWidget(row); queueRows.clear(); rows.replaceChildren(); rows.hidden = true;
    const fresh = metadataForm(); metadata = { ...fresh, form }; fields.replaceChildren(...fresh.fields, fileField); fields.disabled = false;
    form.reset(); files.value = ''; files.setCustomValidity(''); selectedNames.textContent = 'Choose up to 5 files from your device'; dropzone.classList.remove('selected');
    err.textContent = ''; pollError.textContent = ''; pollError.hidden = true; another.hidden = true;
    bottomMessage.textContent = 'Files remain private until the safety check passes.'; bottom.replaceChildren(bottomMessage, submit);
  }
  function showItemChallenge(row, item) {
    if (pageSignal.aborted) return;
    if (row.challengeAction === item.challenge) return;
    clearWidget(row); if (!item.challenge) return;
    row.challengeAction = item.challenge; row.controller = new AbortController(); const controller = row.controller;
    const currentQueue = queue; row.challenge.hidden = false;
    void mountBotChallenge(row.challenge, item.challenge, token => {
      if (token && !pageSignal.aborted && !controller.signal.aborted && queue === currentQueue) currentQueue.retry(item.id, token);
    }, { siteKey: config.botSiteKey, signal: AbortSignal.any([controller.signal, pageSignal]), onError: () => { if (!pageSignal.aborted && !controller.signal.aborted) row.error.textContent = 'Traffic verification is temporarily unavailable. Try again or cancel this file.'; } })
      .then(handle => { if (pageSignal.aborted || controller.signal.aborted) handle.destroy(); else row.widget = handle; })
      .catch(error => { if (!pageSignal.aborted && error.name !== 'AbortError') row.error.textContent = 'Traffic verification is temporarily unavailable. Try again or cancel this file.'; });
  }
  function changed(items) {
    if (pageSignal.aborted) return;
    for (const item of items) {
      let row = queueRows.get(item.id);
      if (!row) { row = { root: el('li', { class: 'upload-queue-item' }), stage: el('p', { role: 'status' }), progress: el('progress', { max: '100', 'aria-label': item.file.name + ' upload progress' }), challenge: el('div', { hidden: true }), error: message(), actions: el('div', { class: 'upload-item-actions' }) }; row.root.append(el('div', {}, el('strong', {}, item.file.name), el('small', {}, uploadBytes(item.file.size))), row.stage, row.progress, row.error, row.challenge, row.actions); queueRows.set(item.id, row); rows.append(row.root); }
      row.stage.textContent = ({ queued: 'Waiting to upload', preparing: 'Preparing…', uploading: `Uploading… ${item.progress}%`, completing: 'Confirming upload…', scanning: 'Uploaded · safety check in progress', active: 'Published', error: 'Needs attention', quarantined: 'Unavailable', cancelled: 'Cancelled' })[item.stage];
      row.progress.value = item.progress; row.progress.hidden = item.stage !== 'uploading'; row.error.textContent = item.message || ''; row.actions.replaceChildren();
      if (item.stage === 'error' && !item.challenge && !item.uncertain) row.actions.append(el('button', { type: 'button', class: 'button', onclick: () => queue.retry(item.id) }, 'Retry this file'));
      if (!['active', 'quarantined', 'cancelled'].includes(item.stage)) row.actions.append(el('button', { type: 'button', class: 'button', onclick: () => { void queue.cancel(item.id); } }, 'Cancel'));
      if (item.stage === 'active') row.actions.append(a('View resource', `/resources/${item.resourceId}`));
      if (item.stage === 'error' && item.challenge) showItemChallenge(row, item); else if (row.challengeAction) clearWidget(row);
    }
    const transferring = items.some(i => ['queued', 'preparing', 'uploading', 'completing'].includes(i.stage));
    another.hidden = transferring;
    bottomMessage.textContent = transferring ? 'Keep this page open while files are uploading.' : 'Uploaded files are checked in the background. You can leave this page and check My uploads.';
  }
  const uploadErrors = {
    unauthorized: 'Your session expired. Sign in again before retrying.',
    rate_limited: 'Too many requests. Wait before retrying this file.',
    file_too_large: 'This file exceeds the upload limit.', file_type_not_allowed: 'This file type is not supported.',
    pa_tag_admin_only: 'Only administrators can assign the PA tag.',
    upload_expired: 'This upload expired. Choose the file again in a new batch.',
    object_mismatch: 'The stored file did not match the upload. Start a new batch for this file.',
    uploads_disabled: 'Uploads are temporarily unavailable.',
  };
  async function uploadRequest(path, body, signal, action) {
    const operationSignal = AbortSignal.any([signal, pageSignal]);
    operationSignal.throwIfAborted();
    try { const result = await api(path, { method: 'POST', body, signal: operationSignal }); operationSignal.throwIfAborted(); return result; }
    catch (error) {
      if (operationSignal.aborted || error.name === 'AbortError') throw error;
      const options = { status: error.status, code: error.code, retryAfter: error.retryAfter };
      if (['bot_challenge_required', 'bot_challenge_invalid'].includes(error.code)) throw new UploadError('Complete the traffic check to continue this file.', action, options);
      throw new UploadError(uploadErrors[error.code] || 'The request failed. Retry this file or check My uploads.', undefined, options);
    }
  }
  const transport = {
    async intent(file, values, signal, token) {
      const result = await uploadRequest('/api/resources/upload-intents', { ...values, originalFilename: file.name, sizeBytes: file.size, ...(token ? { botToken: token } : {}) }, signal, 'upload');
      pageSignal.throwIfAborted(); signal.throwIfAborted();
      if (typeof result.resourceId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(result.resourceId) || !result.headers || typeof result.headers !== 'object') throw new UploadError('The upload could not be prepared.');
      try { validStorageUrl(result.uploadUrl, location.origin); } catch { throw new UploadError('The upload could not be prepared.'); }
      return result;
    },
    put(file, intent, signal, progress) {
      signal = AbortSignal.any([signal, pageSignal]);
      return new Promise((resolve, reject) => {
        let url; try { url = validStorageUrl(intent.uploadUrl, location.origin); } catch (error) { reject(error); return; }
        const xhr = new XMLHttpRequest(); const abort = () => xhr.abort();
        const finish = error => { signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(); };
        xhr.open('PUT', url); xhr.withCredentials = false; xhr.timeout = 120000;
        for (const [key, value] of Object.entries(intent.headers)) if (['content-type', 'x-amz-meta-resource'].includes(key.toLowerCase())) xhr.setRequestHeader(key, value);
        xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
        xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? null : new UploadError('Storage rejected this upload. Retry this file.'));
        xhr.onerror = () => finish(new UploadError('The upload connection failed. Retry this file.')); xhr.ontimeout = () => finish(new UploadError('The upload timed out. Retry this file.')); xhr.onabort = () => finish(new DOMException('Aborted', 'AbortError'));
        if (signal.aborted) { finish(new DOMException('Aborted', 'AbortError')); return; } signal.addEventListener('abort', abort, { once: true }); xhr.send(file);
      });
    },
    async complete(id, signal, token) {
      const result = await uploadRequest(`/api/resources/${id}/complete`, token ? { botToken: token } : {}, signal, 'complete');
      pageSignal.throwIfAborted(); signal.throwIfAborted();
      if (result.id !== id) throw new UploadError('The upload response did not match this file.');
      return result;
    },
    cancel(id) { pageSignal.throwIfAborted(); return api(`/api/resources/${id}`, { method: 'DELETE', signal: AbortSignal.any([pageSignal, AbortSignal.timeout(15000)]) }); },
  };
  form.addEventListener('submit', event => {
    event.preventDefault(); if (queue || pageSignal.aborted) return;
    try {
      const selected = Array.from(files.files);
      if (!selected.length || selected.length > 5 || selected.some(file => !file.size || file.size > config.uploadMaxBytes)) { err.textContent = `Choose 1–5 non-empty files, each no larger than ${uploadBytes(config.uploadMaxBytes)}.`; return; }
      const data = new FormData(form);
      const values = { title: String(data.get('title') || ''), description: String(data.get('description') || ''), tags: String(data.get('tags') || '').split(',').map(tag => tag.trim()).filter(Boolean) };
      queue = new UploadQueue(selected, values, transport, changed);
      fields.disabled = true; rows.hidden = false; bottom.replaceChildren(bottomMessage, a('My uploads', '/me/resources', 'button'));
      err.textContent = ''; queue.start();
    } catch (error) { if (!pageSignal.aborted && error.name !== 'AbortError') noticeError(err, error); }
  });
  async function poll(delay = 5000) {
    if (stopped || pageSignal.aborted) return;
    const currentQueue = queue, batch = batchNumber;
    const ids = currentQueue?.items.filter(item => item.stage === 'scanning').map(item => item.resourceId) || [];
    let nextDelay = 5000;
    if (ids.length && document.visibilityState === 'visible') {
      try {
        const result = await api('/api/resources/upload-status', { method: 'POST', body: { ids }, signal: AbortSignal.any([pollController.signal, pageSignal, AbortSignal.timeout(15000)]) });
        pageSignal.throwIfAborted();
        if (!stopped && queue === currentQueue && batchNumber === batch) { currentQueue.updateStatuses(result.items); pollError.textContent = ''; pollError.hidden = true; }
      } catch (error) {
        if (!stopped && !pageSignal.aborted && batchNumber === batch) { pollError.hidden = false; pollError.textContent = 'Status updates are temporarily unavailable. Your files remain private until checks pass. You can also check My uploads.'; nextDelay = error.status === 429 ? Math.max(5000, (error.retryAfter || 60) * 1000) : Math.min(60000, delay * 2); }
      }
    }
    if (!stopped && !pageSignal.aborted) pollTimer = setTimeout(() => { void poll(nextDelay); }, nextDelay);
  }
  pollTimer = setTimeout(() => { void poll(); }, 5000);
  const dispose = () => { if (stopped) return; stopped = true; pageSignal.removeEventListener('abort', dispose); clearTimeout(pollTimer); pollController.abort(); queue?.dispose(); for (const row of queueRows.values()) clearWidget(row); };
  pageSignal.addEventListener('abort', dispose, { once: true }); disposers.push(dispose);
}

async function adminDashboard() {
  const signal = pageController.signal;
  const content = shell('dashboard', 'Dashboard'); content.classList.add('dashboard-content');
  const rawRange = new URLSearchParams(location.search).get('range') || '7d';
  const range = ['24h', '7d', '30d'].includes(rawRange) ? rawRange : '7d';
  const select = el('select', { 'aria-label': 'Dashboard time range', onchange: () => navigate('/admin/dashboard?range=' + select.value) },
    ...[['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']].map(([value, label]) => el('option', { value }, label)));
  select.value = range;
  const panels = el('div'), err = message(), updated = el('p', { class: 'dashboard-updated', role: 'status' });
  const reload = btn('↻ Refresh', () => load(true));
  content.append(title('Dashboard', 'Resource activity and moderation at a glance.', el('div', { class: 'dashboard-controls' }, select, reload)),
    err, updated, panels);
  async function load(fresh = false) {
    reload.disabled = true; select.disabled = true; err.textContent = '';
    try {
      const data = await request('/api/admin/dashboard?range=' + range, { fresh }, 'admin'); signal.throwIfAborted();
      panels.replaceChildren(dashboardPanels(el, data));
      updated.textContent = 'Snapshot ' + new Date(data.generatedAt).toLocaleString('en') + ' · Charts use UTC; the current bucket is partial.';
    } catch (error) {
      if (signal.aborted) throw error;
      noticeError(err, error);
      if (panels.childNodes.length) updated.textContent += ' · Refresh failed; showing the previous snapshot.';
    } finally { reload.disabled = false; select.disabled = false; }
  }
  await load();
}
async function adminReports() {
  const content = shell('reports', 'Reports'); content.append(el('section', { class: 'hero' }, el('div', {}, el('h1', {}, 'Reports'), el('p', {}, 'Review open reports, control resource visibility, and suspend abusive accounts. Every action is audited.'))));
  const reportStatus = 'open', messages = new Map();
  const pages = new PageCollection(), list = el('div', { class: 'report-list' }), err = message(), challengeSlot = el('div', { hidden: true });
  const more = btn('Load more reports', () => load(true)); more.hidden = true; const pagination = el('div', { class: 'pagination', hidden: true }, more); content.append(challengeSlot, err, list, pagination);
  let loading = false;
  async function action(path, body, note, success) {
    err.textContent = ''; note.textContent = ''; note.hidden = false;
    try {
      const result = await request(path, { method: 'POST', body, challengeContainer: challengeSlot }, 'admin');
      note.textContent = success; messages.set(body.reportId || note.dataset.reportId, success);
      if (body.reportId && !result.resolvedReportIds?.includes(body.reportId)) err.textContent = 'Resource action completed. The selected report was already closed or did not match; it was not changed.';
      if (!path.endsWith('/suspend')) await load(true);
    } catch (error) { noticeError(note, error); if (error.status >= 500 || !error.status) note.append(a('Check audit log before retrying', '/admin/audit', 'button')); }
  }
  async function moderate(report, type, note) { const reason = prompt('Reason for this moderation action:'); if (reason?.trim()) await action(`/api/admin/resources/${report.resourceId}/moderate`, { action: type, reason: reason.trim(), reportId: report.id }, note, 'Action recorded.'); }
  function render() {
    const cards = pages.items.map(report => {
      const note = el('p', { class: 'action-message', role: 'status', hidden: !messages.has(report.id), 'data-report-id': report.id }, messages.get(report.id) || '');
      const withNote = task => task();
      const controls = el('div', { class: 'action-row' },
        report.resourceStatus === 'active' && btn('Hide', () => withNote(() => moderate(report, 'hide', note))),
        report.resourceStatus === 'hidden' && btn('Restore', () => withNote(() => moderate(report, 'restore', note))),
        btn('Remove', () => withNote(() => moderate(report, 'remove', note)), 'button danger'),
        reportStatus === 'open' && btn('Dismiss report', async () => { const explanation = prompt('Why is this report being dismissed?'); if (explanation?.trim()) await withNote(() => action(`/api/admin/reports/${report.id}`, { note: explanation.trim() }, note, 'Report dismissed.')); }),
        btn('Suspend author', async () => { const reason = prompt('Reason for suspending this resource author:'); if (reason?.trim()) await withNote(() => action(`/api/admin/users/${report.authorId}/suspend`, { reason: reason.trim() }, note, 'User suspended and active sessions revoked.')); }, 'button danger'));
      return el('article', { class: 'report-card' },
        el('div', { class: 'report-heading' }, el('div', {}, el('strong', {}, report.resourceTitle), el('small', {}, `Reported by ${report.reporterName} · ${new Date(report.createdAt).toLocaleString('en')}`)), status(report.resourceStatus)),
        el('p', {}, el('strong', {}, report.reason.replaceAll('_', ' ')), report.details ? ' — ' + report.details : ''), el('div', {}, controls, note));
    });
    list.replaceChildren(...(cards.length ? cards : [reportStatus === 'open' ? empty('No open reports', 'The moderation queue is clear.') : empty(`No ${reportStatus} reports`)]));
    more.hidden = true; pagination.hidden = true;
  }
  async function load(preserveError = false) {
    if (loading) return; loading = true; more.disabled = true; if (!preserveError) err.textContent = '';
    try { pages.accept(await api('/api/admin/reports?view=workspace', { fresh: preserveError }), false, 'reports'); render(); }
    catch (error) { noticeError(err, error); err.append(btn('Reload first page', () => load(false))); }
    finally { loading = false; more.disabled = false; }
  }
  await load(false);
}
async function audit() {
  const content = shell('audit', 'Audit log');
  content.append(el('section', { class: 'hero' }, el('div', {}, el('h1', {}, 'Audit log'), el('p', {}, 'Recent moderation and governance actions. Sensitive tokens and signed URLs are never written here.'))));
  const pages = new PageCollection(), list = el('div', { class: 'data-list' }), err = message(), challengeSlot = el('div', { hidden: true }), more = btn('Load more events', () => load(true)); more.hidden = true; const pagination = el('div', { class: 'pagination', hidden: true }, more); content.append(challengeSlot, err, list, pagination);
  async function load() {
    more.disabled = true; err.textContent = '';
    try { pages.accept(await api('/api/admin/audit?view=workspace')); list.replaceChildren(...(pages.items.length ? pages.items.map(entry => el('div', { class: 'data-row audit-row' }, el('div', {}, el('strong', {}, entry.action), el('small', {}, `${entry.actor || 'System'} · ${entry.targetType} ${entry.targetId || ''}`), el('small', {}, JSON.stringify(entry.metadata))), el('time', { datetime: entry.createdAt }, new Date(entry.createdAt).toLocaleString('en')))) : [empty('No audit events')])); more.hidden = true; pagination.hidden = true; }
    catch (error) { noticeError(err, error); err.append(btn('Reload first page', () => load(false))); }
    finally { more.disabled = false; }
  }
  await load(false);
}

function legal(kind) {
  const content = el('main', { class: 'simple-page' }, a('← Back', '/login', 'back'));
  if (kind === 'privacy') content.append(
    el('h1', {}, 'Privacy notice'), el('h2', {}, 'What we collect'),
    el('p', {}, 'SHSID Online stores the Launchpad subject identifier, display name, email, organization and verification attributes, resource metadata, private file object keys, reports, and necessary moderation records.'),
    el('h2', {}, 'How it is used'), el('p', {}, 'This information verifies eligibility, provides search and file sharing, protects the service from abuse, and allows administrators to investigate reports. Files remain in private object storage and are scanned before publication.'),
    el('h2', {}, 'Security and sharing'), el('p', {}, 'Launchpad performs sign-in; SHSID Online does not collect or store Launchpad passwords. Plaintext session identifiers are not stored in the database or application logs. Challenge tokens and signed storage URLs are also excluded from logs. Data is shared only with the infrastructure providers required to operate storage, scanning, abuse prevention, and the database.'),
    el('h2', {}, 'Retention and requests'), el('p', {}, 'Deleting a resource immediately removes it from search and stops new download links. Its object is removed after the configured recovery window. Security and audit records may be retained as required by school policy. Contact the designated school administrator to request access, correction, or deletion.'),
    el('p', {}, el('strong', {}, 'Deployment note:'), ' the school must approve provider names, data regions, retention periods, and the contact channel before student beta.'));
  else content.append(
    el('h1', {}, 'Acceptable use'), el('p', {}, 'SHSID Online is a private learning-resource service for active SHSID students using Launchpad. Access is personal and may not be shared or automated.'),
    el('h2', {}, 'You may'), el('ul', {}, el('li', {}, 'Upload learning materials you created or are permitted to distribute.'), el('li', {}, 'Download resources for legitimate educational use.'), el('li', {}, 'Report files that create a safety, privacy, copyright, or school-policy concern.')),
    el('h2', {}, 'You may not'), el('ul', {}, el('li', {}, 'Upload malware, executable content, scripts, macro files, archives, or disguised file types.'), el('li', {}, 'Share personal or confidential information without authorization.'), el('li', {}, 'Infringe copyright, harass others, spam the service, evade limits, or probe another user’s data.'), el('li', {}, 'Replace a published file silently or misuse signed storage links.')),
    el('h2', {}, 'Moderation'), el('p', {}, 'Administrators may hide or remove resources, dismiss reports, suspend accounts, and preserve audit records. A suspended account immediately loses its active SHSID Online sessions.'),
    el('p', {}, el('strong', {}, 'Deployment note:'), ' school leadership must approve these rules and the appeal/contact process before student beta.'));
  root.replaceChildren(content); publishView(); document.title = `${kind === 'privacy' ? 'Privacy' : 'Terms'} · Sider`;
}
function fatal(error) {
  if (error.status === 404) root.replaceChildren(el('main', { class: 'simple-page' }, el('p', { class: 'eyebrow' }, '404'), el('h1', {}, 'Resource unavailable'), el('p', {}, 'This resource does not exist or is no longer available. Hidden, quarantined, and deleted resources use the same response.'), a('Back to resources', '/resources', 'button')));
  else root.replaceChildren(el('main', { class: 'simple-page' }, el('h1', {}, 'This page could not be loaded.'), el('p', {}, 'The service kept the operation closed rather than continuing without its required security or storage dependency.'), btn('Try again', () => refreshPage())));
  publishView();
}
async function main(signal = pageController.signal) {
  signal.throwIfAborted();
  const path = location.pathname;
  if (path === '/privacy' || path === '/terms') { legal(path.slice(1)); return; }
  if (path === '/auth/error') {
    const reason = new URLSearchParams(location.search).get('reason');
    const errors = {
      cancelled: ['Sign-in was cancelled', 'Nothing changed. You can return and try again when you are ready.'],
      invalid_state: ['This sign-in link is no longer valid', 'For your security, sign-in links are short-lived and can only be used once.'],
      suspended: ['This account is suspended', 'Contact an administrator if you believe this is a mistake.'],
      platform_unavailable: ['Sign-in is temporarily unavailable', 'Launchpad could not complete the request. Please try again in a moment.'],
    };
    const [heading, description] = errors[reason] || errors.platform_unavailable;
    root.replaceChildren(el('main', { class: 'auth-page' }, el('section', { class: 'auth-card', 'aria-labelledby': 'error-title' },
      el('div', { class: 'monogram large', 'aria-hidden': 'true' }, 'S'), el('h1', { id: 'error-title' }, heading), el('p', { class: 'auth-intro' }, description), a('Back to sign in', '/login', 'button primary login-button'))));
    return;
  }
  const nextConfig = await api('/api/config', { anonymous: true, signal }); signal.throwIfAborted(); config = nextConfig;
  if (initializedTransport !== config.sessionTransport) { await initializeSession(config.sessionTransport); signal.throwIfAborted(); initializedTransport = config.sessionTransport; }
  if (path === '/login') { await login(signal); return; }
  const principal = await api('/api/me', { signal }); signal.throwIfAborted(); user = principal.user;
  if (pageRestore?.userId !== user.id) pageRestore = null;
  if (path.startsWith('/admin/') && user.role !== 'admin') { location.replace('/resources'); return; }
  if (path === '/' || path === '/resources') await resources(signal);
  else if (path === '/resources/new') await upload(signal);
  else if (/^\/resources\/[^/]+$/.test(path)) await detail(path.split('/').pop(), { message: pageRestore?.message, signal });
  else if (path === '/me/resources') await mine(signal);
  else if (path === '/admin/dashboard') await adminDashboard();
  else if (path === '/admin/reports') await adminReports();
  else if (path === '/admin/audit') await audit();
  else throw new Error('This page is unavailable.');
}
function captureView() {
  const fields = [...liveRoot.querySelectorAll('input[name], textarea[name], select[name]')].filter(node => !['file', 'password', 'hidden'].includes(node.type)).map(node => ({ name: node.name, value: node.value, checked: node.checked }));
  return { userId: user?.id, fields, view: viewSnapshot() };
}
function restoreView(saved) {
  if (!saved || saved.userId !== user?.id) return;
  for (const field of saved.fields || []) {
    const node = [...liveRoot.querySelectorAll('[name]')].find(node => node.name === field.name);
    if (node && !['file', 'password', 'hidden'].includes(node.type)) { node.value = field.value; if ('checked' in node) node.checked = field.checked; }
  }
}
const navigation = createNavigation({ root: liveRoot, capture: captureView, restoreFields: restoreView, prefetch: url => {
  if (!user || !/^\/(?:resources(?:\/[^/]+)?|me\/resources|admin\/(?:dashboard|reports|audit))$/.test(url.pathname)) return;
  if (url.pathname.startsWith('/admin/') && user.role !== 'admin') return;
  return Promise.all([prefetchApi('/api/config', { anonymous: true }), prefetchApi('/api/me'), ...apiPathsForRoute(url.href, location.href).map(path => prefetchApi(path))]);
}, render: async (url, { restore, message, refresh }) => {
  if (refresh) clearPrefetches();
  pageController.abort();
  for (const dispose of disposers.splice(0)) dispose();
  const controller = new AbortController(); pageController = controller;
  pageRestore = restore || (message ? { userId: user?.id, message } : null); viewSnapshot = () => null;
  const stage = el('div'); root = stage;
  try { await main(controller.signal); }
  catch (error) { if (!controller.signal.aborted && error.name !== 'AbortError') fatal(error); }
  if (controller.signal.aborted) return null;
  root = liveRoot;
  return stage.childNodes.length ? stage : liveRoot;
} });
async function navigate(href, options) { return navigation.navigate(href, options); }
async function refreshPage(options) { return navigation.refresh(options); }
window.addEventListener('pagehide', () => { pageController.abort(); navigation.clear(); clearPrefetches(); for (const dispose of disposers.splice(0)) dispose(); });
window.addEventListener('sider-session-cleared', () => { user = null; navigation.invalidate(); });
// A browser back/forward cache can otherwise resurrect private DOM after logout.
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
const startupController = pageController;
void main(startupController.signal).catch(error => { if (startupController === pageController && !startupController.signal.aborted && error.name !== 'AbortError') fatal(error); });
