// The widget only supplies an action-bound token. Its caller owns the action,
// button state and retry decision; passing a challenge never submits a request.
const source = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading;
function load() {
  if (window.turnstile) return Promise.resolve();
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = source; script.async = true;
    script.onload = resolve;
    script.onerror = () => { loading = null; script.remove(); reject(new Error('Traffic verification is temporarily unavailable.')); };
    document.head.append(script);
  });
  return loading;
}
export async function mountBotChallenge(target, action, onToken, { signal, onError, siteKey } = {}) {
  signal?.throwIfAborted();
  let destroyed = false, widgetId;
  const container = document.createElement('div'); container.setAttribute('aria-label', 'Automated traffic check');
  target.replaceChildren(container); target.hidden = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true; signal?.removeEventListener('abort', destroy);
    if (widgetId !== undefined) window.turnstile?.remove(widgetId);
    container.remove(); onToken('');
  };
  signal?.addEventListener('abort', destroy, { once: true });
  const failure = () => { if (!destroyed) { onToken(''); onError?.(); } };
  try {
    await load();
    if (!destroyed && !signal?.aborted) {
      if (!siteKey || !window.turnstile) throw new Error('Traffic verification is temporarily unavailable.');
      widgetId = window.turnstile.render(container, {
        sitekey: siteKey, action,
        callback: token => { if (!destroyed) onToken(token); },
        'error-callback': failure,
        'expired-callback': () => { if (!destroyed) onToken(''); },
      });
    }
  } catch (error) {
    failure();
    if (signal?.aborted) { destroy(); signal.throwIfAborted(); }
    throw error;
  }
  return { destroy };
}
