"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function UploadStatusRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 10_000);
    return () => clearInterval(timer);
  }, [enabled, router]);
  return null;
}
