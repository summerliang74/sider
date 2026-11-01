"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

import { ensureAuthTransport, saveBrowserSession } from "@/src/lib/auth/browser-session";

import { BotChallenge } from "./bot-challenge";

type LaunchpadSdkState = {
  user: { sub?: string } | null;
  accessToken: string | null;
};

type LaunchpadSdk = {
  ready: () => Promise<LaunchpadSdkState>;
  signIn: () => Promise<void>;
  signOut: () => void;
  readonly state: LaunchpadSdkState;
};

declare global {
  interface Window {
    LaunchpadAuth?: LaunchpadSdk;
  }
}

export function LaunchpadLogin({ challengeRequired = false }: { challengeRequired?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    challengeRequired ? "Please complete the traffic check before continuing." : "",
  );
  const [needsChallenge, setNeedsChallenge] = useState(challengeRequired);
  const [botToken, setBotToken] = useState("");
  const syncing = useRef(false);

  useEffect(() => {
    void ensureAuthTransport().catch(() => {
      setMessage("Sider could not initialize secure sign-in in this browser.");
    });
  }, []);

  async function completeSession(challengeToken?: string, interactive = true) {
    const sdk = window.LaunchpadAuth;
    if (!sdk || syncing.current) return;
    syncing.current = true;
    setBusy(true);
    setMessage("");
    try {
      const state = await sdk.ready();
      const accessToken = state.accessToken ?? sdk.state.accessToken;
      if (!state.user || !accessToken) {
        if (interactive) await sdk.signIn();
        setBusy(false);
        return;
      }

      const response = await fetch("/api/auth/launchpad/session", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessToken,
          botToken: challengeToken || undefined,
          returnTo: "/resources",
        }),
      });
      const result = await response.json() as {
        accessToken?: string;
        expiresAt?: string;
        redirectUrl?: string;
        error?: string;
      };
      if (result.error === "bot_challenge_required") {
        setNeedsChallenge(true);
        setBotToken("");
        setMessage("Please complete the traffic check before continuing.");
        setBusy(false);
        return;
      }
      if (!response.ok || !result.accessToken || !result.expiresAt || !result.redirectUrl) {
        if (result.error === "invalid_token") sdk.signOut();
        setMessage(result.error === "suspended"
          ? "This Sider account is suspended."
          : "Launchpad sign-in could not be completed. Please try again.");
        setBusy(false);
        return;
      }

      await saveBrowserSession(result.accessToken, result.expiresAt);
      const sessionCheck = await fetch("/api/me", {
        cache: "no-store",
        headers: { "x-sider-session": result.accessToken },
      });
      if (!sessionCheck.ok) {
        setMessage("Sider could not save your session. Please try again.");
        setBusy(false);
        return;
      }

      sdk.signOut();
      window.location.assign(result.redirectUrl);
    } catch {
      setMessage("Launchpad sign-in is temporarily unavailable.");
      setBusy(false);
    } finally {
      syncing.current = false;
    }
  }

  async function signIn() {
    const sdk = window.LaunchpadAuth;
    if (!sdk) {
      setMessage("Launchpad sign-in is still loading. Please try again.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await ensureAuthTransport();
      const state = await sdk.ready();
      if (state.user && state.accessToken) {
        await completeSession();
      } else {
        await sdk.signIn();
      }
    } catch {
      setMessage("Launchpad sign-in is temporarily unavailable.");
      setBusy(false);
    }
  }

  return <>
    <Script
      src="/dashboard-api/oauth/sdk.js"
      strategy="afterInteractive"
      onReady={() => { if (!needsChallenge) void completeSession(undefined, false); }}
      onError={() => { setMessage("Launchpad sign-in is temporarily unavailable."); }}
    />
    {needsChallenge ? <div className="challenge"><p>{message}</p><BotChallenge action="oauth_start" onToken={setBotToken} /></div> : null}
    {!needsChallenge && message ? <p className="form-error" role="alert">{message}</p> : null}
    <button
      className="button primary login-button"
      type="button"
      onClick={() => { void (needsChallenge ? completeSession(botToken) : signIn()); }}
      disabled={busy || (needsChallenge && !botToken)}
    >
      {busy ? "Connecting…" : needsChallenge ? "Continue" : <>Continue with Launchpad <span aria-hidden="true">→</span></>}
    </button>
  </>;
}
