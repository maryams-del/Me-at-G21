import { pageOwner } from "@/server/queries";
import { PageHeader } from "@/components/ui";
import { SecurityClient } from "./SecurityClient";

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ recovered?: string }> }) {
  await pageOwner();
  const sp = await searchParams;
  return (
    <>
      <PageHeader glyph="settings" title="Security" />
      <SecurityClient recovered={sp.recovered === "1"} />
    </>
  );
}
