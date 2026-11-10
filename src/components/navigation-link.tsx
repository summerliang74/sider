"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, useState, type ComponentProps } from "react";

function NavigationProgress() {
  const { pending } = useLinkStatus();
  return pending ? <span className="navigation-progress" role="status"><span className="sr-only">Loading page…</span></span> : null;
}

export function NavigationLink({ children, prefetchOnIntent = false, prefetchWhenIdle = false, prefetch, onMouseEnter, onFocus, onTouchStart, ...props }: ComponentProps<typeof Link> & { prefetchOnIntent?: boolean; prefetchWhenIdle?: boolean }) {
  const [intent, setIntent] = useState(false);
  const hrefKey = typeof props.href === "string" ? props.href : JSON.stringify(props.href);
  const [idleHref, setIdleHref] = useState<string | null>(null);
  useEffect(() => {
    if (!prefetchWhenIdle) return;
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    function schedule() {
      if (document.visibilityState !== "visible" || !navigator.onLine || connection?.saveData || ["slow-2g", "2g", "3g"].includes(connection?.effectiveType ?? "")) return;
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        const ready = () => { if (document.visibilityState === "visible") setIdleHref(hrefKey); };
        if ("requestIdleCallback" in window) idle = window.requestIdleCallback(ready);
        else ready();
      }, 700);
    }
    schedule();
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("online", schedule);
    return () => {
      clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("online", schedule);
    };
  }, [hrefKey, prefetchWhenIdle]);
  const controlled = prefetchOnIntent || prefetchWhenIdle;
  return <Link {...props} prefetch={controlled ? intent || (prefetchWhenIdle && idleHref === hrefKey) : prefetch}
    onMouseEnter={(event) => { onMouseEnter?.(event); if (prefetchOnIntent && !event.defaultPrevented) setIntent(true); }}
    onFocus={(event) => { onFocus?.(event); if (prefetchOnIntent && !event.defaultPrevented) setIntent(true); }}
    onTouchStart={(event) => { onTouchStart?.(event); if (prefetchOnIntent && !event.defaultPrevented) setIntent(true); }}
  >{children}<NavigationProgress /></Link>;
}
