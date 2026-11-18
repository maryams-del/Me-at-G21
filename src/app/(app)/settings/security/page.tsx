import { pageOwner } from "@/server/queries";
import { PageHeader } from "@/components/ui";
import { SecurityClient } from "./SecurityClient";

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ recovered?: string }> }) {
  await pageOwner();
  const sp = await searchParams;
  return (
    <>
      <PageHeader glyph="settings" title="Security" intro="Passkeys are your everyday sign-in. The authenticator app and offline recovery codes are backups for when a passkey isn't available." />
      <SecurityClient recovered={sp.recovered === "1"} />
    </>
  );
}
