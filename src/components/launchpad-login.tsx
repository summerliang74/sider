"use client";

import { useState } from "react";

import { BotChallenge } from "./bot-challenge";

export function LaunchpadLogin() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [needsChallenge, setNeedsChallenge] = useState(false);
  const [botToken, setBotToken] = useState("");

  async function signIn() {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/auth/launchpad/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botToken: botToken || undefined, returnTo: "/resources" }),
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
      setMessage(result.error === "rate_limited" ? "Too many sign-in attempts. Please wait and try again." : "Launchpad sign-in is temporarily unavailable.");
      setBusy(false);
      return;
    }
    window.location.assign(result.redirectUrl);
  }

  return <>
    {needsChallenge ? <div className="challenge"><p>{message}</p><BotChallenge action="oauth_start" onToken={setBotToken} /></div> : null}
    {!needsChallenge && message ? <p className="form-error" role="alert">{message}</p> : null}
    <button className="button primary login-button" type="button" onClick={signIn} disabled={busy || (needsChallenge && !botToken)}>{busy ? "Connecting…" : <>Continue with Launchpad <span aria-hidden="true">→</span></>}</button>
  </>;
}
