"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: { sitekey: string; action: string; callback: (token: string) => void; "error-callback": () => void }) => string;
      remove: (widgetId: string) => void;
    };
  }
}

export function BotChallenge({
  action,
  onToken,
  onError,
}: {
  action: string;
  onToken: (token: string) => void;
  onError?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const callback = useRef(onToken);
  const errorCallback = useRef(onError);
  const [ready, setReady] = useState(false);
  const siteKey = process.env.NEXT_PUBLIC_BOT_SITE_KEY;

  useEffect(() => { callback.current = onToken; }, [onToken]);
  useEffect(() => { errorCallback.current = onError; }, [onError]);

  useEffect(() => {
    if (!ready || !siteKey || !container.current || !window.turnstile || widget.current) return;
    widget.current = window.turnstile.render(container.current, {
      sitekey: siteKey,
      action,
      callback: (token) => callback.current(token),
      "error-callback": () => {
        callback.current("");
        errorCallback.current?.();
      },
    });
    return () => {
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [action, ready, siteKey]);

  return <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={() => setReady(true)} onReady={() => setReady(true)} onError={() => errorCallback.current?.()} /><div ref={container} aria-label="Automated traffic check" /></>;
}
