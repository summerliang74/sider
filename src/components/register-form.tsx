"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { BotChallenge } from "./bot-challenge";

const errorMessages: Record<string, string> = {
  invalid_request: "Check each field and try again.",
  weak_password: "Use a password between 16 and 128 characters.",
  terms_required: "Accept the terms and privacy notice to continue.",
  invalid_invite: "This invitation is invalid or no longer available.",
  username_taken: "That username is already in use. Choose another one.",
  rate_limited: "Too many registration attempts. Please wait and try again.",
  bot_challenge_required: "Complete the traffic check to continue.",
  bot_challenge_invalid: "The traffic check expired. Complete it again.",
  registration_closed: "Registration is currently closed.",
  service_unavailable: "Registration is temporarily unavailable.",
};

export function RegisterForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [needsChallenge, setNeedsChallenge] = useState(false);
  const [challengeFailed, setChallengeFailed] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [challengeKey, setChallengeKey] = useState(0);
  const [showPassword, setShowPassword] = useState(false);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmPassword") ?? "");
    if (password !== confirmation) {
      setMessage("The password confirmation does not match.");
      return;
    }
    if (Array.from(password).length < 16 || Array.from(password).length > 128) {
      setMessage(errorMessages.weak_password ?? "Use a password between 16 and 128 characters.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          displayName: form.get("displayName"),
          password,
          inviteCode: form.get("inviteCode"),
          botToken: botToken || undefined,
          acceptTerms: form.get("acceptTerms") === "on",
        }),
      });
      const result = await response.json() as { redirectUrl?: string; error?: string };
      if (result.error === "bot_challenge_required") {
        setNeedsChallenge(true);
        setChallengeFailed(false);
        setBotToken("");
        setMessage(errorMessages.bot_challenge_required ?? "Complete the traffic check to continue.");
        return;
      }
      if (result.error === "bot_challenge_invalid") {
        setNeedsChallenge(true);
        setChallengeFailed(false);
        setBotToken("");
        setChallengeKey((value) => value + 1);
        setMessage(errorMessages.bot_challenge_invalid ?? "Complete the traffic check again.");
        return;
      }
      if (!response.ok || !result.redirectUrl) {
        setMessage(errorMessages[result.error ?? ""] ?? "Registration is temporarily unavailable.");
        if (needsChallenge) {
          setBotToken("");
          setChallengeKey((value) => value + 1);
        }
        return;
      }
      window.location.assign(result.redirectUrl);
    } catch {
      setMessage("Registration is temporarily unavailable.");
      if (needsChallenge) {
        setBotToken("");
        setChallengeKey((value) => value + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="register-form" onSubmit={register}>
      <div className="register-grid">
        <label className="field" htmlFor="register-username">
          <span>Username</span>
          <input id="register-username" name="username" autoComplete="username" required minLength={3} maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}" aria-describedby="username-help" />
          <small id="username-help">3–64 letters, numbers, dots, underscores, or hyphens.</small>
        </label>
        <label className="field" htmlFor="register-display-name">
          <span>Display name</span>
          <input id="register-display-name" name="displayName" autoComplete="name" required maxLength={240} aria-describedby="display-name-help" />
          <small id="display-name-help">Shown beside resources you share.</small>
        </label>
      </div>
      <label className="field" htmlFor="register-password">
        <span>Password</span>
        <input id="register-password" name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={16} maxLength={256} aria-describedby="password-help" />
        <small id="password-help">Use 16–128 characters and a password unique to Sider.</small>
      </label>
      <label className="field" htmlFor="register-confirm-password">
        <span>Confirm password</span>
        <input id="register-confirm-password" name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={16} maxLength={256} />
      </label>
      <label className="password-toggle">
        <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
        <span>Show password</span>
      </label>
      <label className="field" htmlFor="register-invite">
        <span>Invitation code</span>
        <input id="register-invite" name="inviteCode" autoComplete="one-time-code" required maxLength={256} spellCheck={false} />
        <small>Codes are single-use and are never stored in your browser.</small>
      </label>
      <label className="terms-check">
        <input name="acceptTerms" type="checkbox" required />
        <span>I accept the <Link href="/terms" target="_blank">student resource policy</Link> and <Link href="/privacy" target="_blank">privacy notice</Link>.</span>
      </label>
      {needsChallenge ? (
        <div className="challenge register-challenge">
          <p>This registration needs an additional traffic check.</p>
          <BotChallenge
            key={challengeKey}
            action="register"
            onToken={(token) => {
              setBotToken(token);
              if (token) setChallengeFailed(false);
            }}
            onError={() => {
              setBotToken("");
              setChallengeFailed(true);
              setMessage("The traffic check could not load. Check your connection or script blocker, then retry.");
            }}
          />
          {challengeFailed ? (
            <button
              className="button"
              type="button"
              onClick={() => {
                setChallengeFailed(false);
                setMessage("Complete the traffic check to continue.");
                setChallengeKey((value) => value + 1);
              }}
            >
              Retry traffic check
            </button>
          ) : null}
        </div>
      ) : null}
      {message ? <p className="form-error" role="alert">{message}</p> : null}
      <button className="button primary register-button" type="submit" disabled={busy || (needsChallenge && !botToken)}>
        {busy ? "Creating account…" : <>Create account <span aria-hidden="true">→</span></>}
      </button>
    </form>
  );
}
