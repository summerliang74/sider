"use client";

import Script from "next/script";
import { useRef, useState } from "react";

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

export function LaunchpadLogin() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [needsChallenge, setNeedsChallenge] = useState(false);
  const [botToken, setBotToken] = useState("");
  const syncing = useRef(false);

  async function completeSession(challengeToken?: string) {
    const sdk = window.LaunchpadAuth;
    if (!sdk || syncing.current) return;
    syncing.current = true;
    setBusy(true);
    setMessage("");
    try {
      const state = await sdk.ready();
      const accessToken = state.accessToken ?? sdk.state.accessToken;
      if (!state.user || !accessToken) {
        setBusy(false);
        return;
      }

      const response = await fetch("/api/auth/launchpad/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessToken,
          botToken: challengeToken || undefined,
          returnTo: "/resources",
        }),
      });
      const result = await response.json() as { redirectUrl?: string; error?: string };
      if (result.error === "bot_challenge_required") {
        setNeedsChallenge(true);
        setBotToken("");
        setMessage("Please complete the traffic check before continuing.");
        setBusy(false);
        return;
      }
      if (!response.ok || !result.redirectUrl) {
        if (result.error === "invalid_token") sdk.signOut();
        setMessage(
          result.error === "invalid_token"
            ? "Your Launchpad session expired. Please sign in again."
            : result.error === "org_not_allowed"
            ? "Your Launchpad organization is not allowed to access Sider."
            : result.error === "not_verified"
              ? "Verify your Launchpad account before continuing."
              : result.error === "suspended"
                ? "This Sider account is suspended."
                : "Launchpad sign-in could not be completed. Please try again.",
        );
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
      await sdk.ready();
      await sdk.signIn();
    } catch {
      setMessage("Launchpad sign-in is temporarily unavailable.");
      setBusy(false);
    }
  }

  return <>
    <Script
      src="/dashboard-api/oauth/sdk.js"
      strategy="afterInteractive"
      onReady={() => { void completeSession(); }}
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
