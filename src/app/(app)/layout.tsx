import { redirect } from "next/navigation";
import { missingConfig } from "@/lib/config";
import { AppShell } from "@/components/AppShell";
import { pageOwner, inboxCount } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (missingConfig().length) redirect("/setup");
  const owner = await pageOwner();
  const n = await inboxCount(owner.id);
  return (
    <AppShell name={owner.displayName ?? ""} inboxCount={n}>
      {owner.sessionMethod === "recovery" && (
        <div className="panel p-3 mb-5 t-small" style={{ background: "var(--tint-rust)" }} role="status">
          You signed in with account recovery. <a className="underline" href="/settings/security">Secure your account</a>: add a new passkey and sign out any lost device.
        </div>
      )}
      {children}
    </AppShell>
  );
}
