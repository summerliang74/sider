"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

import { clearBrowserSession } from "@/src/lib/auth/browser-session";

export function LogoutButton({
  children,
  ariaLabel,
  title,
}: {
  children: ReactNode;
  ariaLabel?: string;
  title?: string;
}) {
  const router = useRouter();

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST", redirect: "manual" });
    } finally {
      await clearBrowserSession().catch(() => undefined);
      window.LaunchpadAuth?.signOut();
      router.replace("/login");
      router.refresh();
    }
  }

  return <button type="button" aria-label={ariaLabel} title={title} onClick={() => { void signOut(); }}>{children}</button>;
}
