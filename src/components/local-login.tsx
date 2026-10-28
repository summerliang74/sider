"use client";

import { FormEvent, useState } from "react";

import { BotChallenge } from "./bot-challenge";

export function LocalLogin() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [needsChallenge, setNeedsChallenge] = useState(false);
  const [botToken, setBotToken] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
        botToken: botToken || undefined,
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
      setMessage(result.error === "rate_limited"
        ? "Too many sign-in attempts. Please wait and try again."
        : result.error === "invalid_credentials"
          ? "Incorrect username or password."
          : "Sign-in is temporarily unavailable.");
      setBusy(false);
      return;
    }
    window.location.assign(result.redirectUrl);
  }

  return (
    <form className="local-login" onSubmit={signIn}>
      <label htmlFor="username">Username</label>
      <input id="username" name="username" autoComplete="username" required maxLength={64} />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024} />
      {needsChallenge ? <div className="challenge"><p>{message}</p><BotChallenge action="local_login" onToken={setBotToken} /></div> : null}
      {!needsChallenge && message ? <p className="form-error" role="alert">{message}</p> : null}
      <button className="button primary login-button" type="submit" disabled={busy || (needsChallenge && !botToken)}>
        {busy ? "Signing in…" : <>Sign in <span aria-hidden="true">→</span></>}
      </button>
    </form>
  );
}
