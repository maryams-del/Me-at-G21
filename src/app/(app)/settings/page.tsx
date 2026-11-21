import Link from "next/link";
import { pageOwner } from "@/server/queries";
import { PageHeader, Section } from "@/components/ui";
import { ProfileForm, SignOut } from "./SettingsClient";
import { OpForm, OpButton } from "@/components/OpForm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { env } from "@/lib/env";
import { invitedEmailsOf } from "@/lib/invites";

export default async function SettingsPage() {
  const o = await pageOwner();
  // Only the site owner manages who else can have an account.
  const isOwner = o.email === env.ownerEmail;
  const invited = isOwner ? invitedEmailsOf(o.settings) : [];
  const joined = invited.length
    ? new Map((await getDb().select({ email: users.email, step: users.onboardingStep }).from(users).where(inArray(users.email, invited))).map((u) => [u.email, u.step]))
    : new Map<string, string>();
  return (
    <>
      <PageHeader glyph="settings" title="Me @ G21" />
      <div className="grid gap-3 sm:grid-cols-2 mb-9">
        <Link href="/settings/security" className="tile min-h-0"><p className="t-h3">Security</p></Link>
        <Link href="/settings/notifications" className="tile min-h-0"><p className="t-h3">Notifications</p></Link>
        <Link href="/settings/data" className="tile min-h-0"><p className="t-h3">Data & backups</p></Link>
      </div>
      <Section title="Profile"><div className="panel p-4"><ProfileForm initial={{ displayName: o.displayName ?? "", timezone: o.timezone, defaultCurrency: o.defaultCurrency }} /></div></Section>
      {isOwner && (
        <Section title="People">
          <div className="panel p-4 grid gap-4">
            <p className="t-small text-ink-2 prose-w">Invite someone to make their own Me @ G21. They sign up with the email you add here and get a separate, private account with their own passkey. You never see their things, and they never see yours.</p>
            <OpForm op="invite.add" compact resetOnSuccess submitLabel="Invite" fields={[{ name: "email", label: "Their email", required: true, placeholder: "name@example.com" }]} />
            {invited.length > 0 && (() => {
              const done = invited.filter((e) => joined.get(e) === "complete").length;
              return <p className="t-small"><strong>{done}</strong> of {invited.length} invited {invited.length === 1 ? "person has" : "people have"} signed up. You&apos;ll get an email each time someone finishes signing up.</p>;
            })()}
            {invited.length > 0 && (
              <ul className="list">
                {invited.map((e) => {
                  const step = joined.get(e);
                  return (
                    <li key={e} className="py-2.5 flex items-center justify-between gap-3">
                      <span className="min-w-0 grid">
                        <span className="truncate font-medium">{e}</span>
                        <span className="t-meta">{step === "complete" ? "Has an account" : step ? "Setting up" : "Invited, not signed up yet"}</span>
                      </span>
                      <OpButton op="invite.remove" input={{ email: e }} label="Remove" icon="trash" className="btn btn-sm"
                        confirmText={step === "complete" ? `Remove ${e} from your invite list? They keep their account and can still sign in.` : `Remove the invite for ${e}? They won't be able to sign up.`} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Section>
      )}
      <Section title="Session"><SignOut /></Section>
    </>
  );
}
