import Link from "next/link";
import { pageOwner } from "@/server/queries";
import { PageHeader, Section } from "@/components/ui";
import { ProfileForm, SignOut } from "./SettingsClient";

export default async function SettingsPage() {
  const o = await pageOwner();
  return (
    <>
      <PageHeader glyph="settings" title="Settings" />
      <div className="grid gap-3 sm:grid-cols-2 mb-9">
        <Link href="/settings/security" className="tile min-h-0"><p className="t-h3">Security</p></Link>
        <Link href="/settings/notifications" className="tile min-h-0"><p className="t-h3">Notifications</p></Link>
        <Link href="/settings/data" className="tile min-h-0"><p className="t-h3">Data & backups</p></Link>
      </div>
      <Section title="Profile"><div className="panel p-4"><ProfileForm initial={{ displayName: o.displayName ?? "", timezone: o.timezone, defaultCurrency: o.defaultCurrency }} /></div></Section>
      <Section title="Session"><SignOut /></Section>
    </>
  );
}
