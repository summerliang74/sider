import { redirect } from "next/navigation";

import { InviteManager } from "@/src/components/invite-manager";
import { AppShell } from "@/src/components/app-shell";
import { getCurrentUser } from "@/src/lib/auth/session";
import { getServerEnv } from "@/src/lib/env";
import { listRegistrationInvites } from "@/src/lib/registration-invites";

export const metadata = { title: "Registration invitations" };

export default async function RegistrationInvitesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin" || getServerEnv().AUTH_MODE !== "local") redirect("/resources");
  const initial = await listRegistrationInvites(null);
  return (
    <AppShell user={user} current="admin" title="Invitations">
      <div className="content admin-invites-page">
        <section className="hero compact-hero">
          <div>
            <p className="eyebrow">ADMINISTRATION</p>
            <h1>Registration invitations</h1>
            <p>Create a single-use invitation, share it through a trusted channel, or revoke it before use.</p>
          </div>
        </section>
        <InviteManager initial={initial} defaultTtlHours={getServerEnv().REGISTRATION_INVITE_TTL_HOURS} />
      </div>
    </AppShell>
  );
}
