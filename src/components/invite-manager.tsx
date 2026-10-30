"use client";

import { FormEvent, useState } from "react";

type InviteItem = {
  id: string;
  status: "active" | "consumed" | "expired" | "revoked";
  note: string | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  createdBy: { id: string; displayName: string };
};

type InvitePage = { items: InviteItem[]; nextCursor: string | null };

export function InviteManager({ initial, defaultTtlHours }: { initial: InvitePage; defaultTtlHours: number }) {
  const [page, setPage] = useState(initial);
  const [createdCode, setCreatedCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/admin/registration-invites", { cache: "no-store" });
    if (response.ok) setPage(await response.json() as InvitePage);
  }

  async function loadMore() {
    if (!page.nextCursor || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/admin/registration-invites?cursor=${encodeURIComponent(page.nextCursor)}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setMessage("Older invitations could not be loaded.");
        return;
      }
      const next = await response.json() as InvitePage;
      setPage((current) => ({
        items: [...current.items, ...next.items],
        nextCursor: next.nextCursor,
      }));
    } catch {
      setMessage("Older invitations could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setMessage("");
    setCreatedCode("");
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/admin/registration-invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expiresInHours: Number(form.get("expiresInHours")),
          note: String(form.get("note") ?? "").trim() || undefined,
        }),
      });
      const result = await response.json() as { invite?: { code: string }; error?: string };
      if (!response.ok || !result.invite) {
        setMessage(result.error === "rate_limited" ? "Invitation creation limit reached. Try again later." : "The invitation could not be created.");
        return;
      }
      setCreatedCode(result.invite.code);
      setMessage("Invitation created. Copy it now; it will not be shown again.");
      formElement.reset();
      await refresh();
    } catch {
      setMessage("The invitation could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this unused invitation? This cannot be undone.")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/registration-invites/${id}`, { method: "DELETE" });
      if (!response.ok) {
        setMessage("The invitation is no longer available to revoke.");
        return;
      }
      setMessage("Invitation revoked.");
      await refresh();
    } catch {
      setMessage("The invitation could not be revoked.");
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(createdCode);
      setMessage("Invitation copied. It will not be shown again after you leave this page.");
    } catch {
      setMessage("Copy failed. Select the invitation code and copy it manually.");
    }
  }

  return (
    <div className="invite-admin-grid">
      <section className="invite-create-card" aria-labelledby="create-invite-title">
        <h2 id="create-invite-title">Create invitation</h2>
        <form className="invite-create-form" onSubmit={createInvite}>
          <label className="field" htmlFor="invite-expiry">
            <span>Valid for</span>
            <select id="invite-expiry" name="expiresInHours" defaultValue={defaultTtlHours}>
              {[...new Set([24, 48, 72, 120, 168, defaultTtlHours])].sort((left, right) => left - right).map((hours) => <option key={hours} value={hours}>{hours} hours</option>)}
            </select>
          </label>
          <label className="field" htmlFor="invite-note">
            <span>Private note <small>(optional)</small></span>
            <input id="invite-note" name="note" maxLength={120} placeholder="e.g. Grade 11 onboarding" />
          </label>
          <button className="button primary" type="submit" disabled={busy}>{busy ? "Working…" : "Create invitation"}</button>
        </form>
        {createdCode ? (
          <div className="created-invite" role="status">
            <strong>Shown once</strong>
            <code>{createdCode}</code>
            <button className="button" type="button" onClick={copyCode}>Copy code</button>
          </div>
        ) : null}
        {message ? <p className="action-message" role="status">{message}</p> : null}
      </section>
      <section className="invite-list" aria-labelledby="invite-list-title">
        <div className="section-heading"><div><p className="eyebrow">RECENT</p><h2 id="invite-list-title">Invitation history</h2></div><span>{page.items.length} shown</span></div>
        {page.items.length === 0 ? <div className="empty"><h2>No invitations yet</h2><p>Create one to invite a student.</p></div> : (
          <div className="data-list">
            {page.items.map((invite) => (
              <div className="data-row invite-row" key={invite.id}>
                <div>
                  <span className={`status ${invite.status}`}>{invite.status}</span>
                  <strong>{invite.note || "No private note"}</strong>
                  <small>Created by {invite.createdBy.displayName} · {new Date(invite.createdAt).toLocaleString()}</small>
                  <small>Expires {new Date(invite.expiresAt).toLocaleString()}{invite.consumedAt ? ` · Used ${new Date(invite.consumedAt).toLocaleString()}` : ""}</small>
                </div>
                {invite.status === "active" ? <button className="button danger" type="button" disabled={busy} onClick={() => revoke(invite.id)}>Revoke</button> : null}
              </div>
            ))}
          </div>
        )}
        {page.nextCursor ? <button className="button" type="button" disabled={busy} onClick={loadMore}>{busy ? "Loading…" : "Load older invitations"}</button> : null}
      </section>
    </div>
  );
}
