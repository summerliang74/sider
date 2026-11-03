"use client";

import Link, { useLinkStatus } from "next/link";
import { useState, type ComponentProps } from "react";

function NavigationProgress() {
  const { pending } = useLinkStatus();
  return pending ? <span className="navigation-progress" role="status"><span className="sr-only">Loading page…</span></span> : null;
}

export function NavigationLink({ children, prefetchOnIntent = false, prefetch, onMouseEnter, onFocus, onTouchStart, ...props }: ComponentProps<typeof Link> & { prefetchOnIntent?: boolean }) {
  const [intent, setIntent] = useState(false);
  return <Link {...props} prefetch={prefetchOnIntent ? intent : prefetch}
    onMouseEnter={(event) => { onMouseEnter?.(event); if (prefetchOnIntent && !event.defaultPrevented) setIntent(true); }}
    onFocus={(event) => { onFocus?.(event); if (prefetchOnIntent && !event.defaultPrevented) setIntent(true); }}
    onTouchStart={(event) => { onTouchStart?.(event); if (prefetchOnIntent && !event.defaultPrevented) setIntent(true); }}
  >{children}<NavigationProgress /></Link>;
}
