import { SpaceHub } from "@/components/SpaceHub";

export default async function AdminIndex({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const items = [
    { href: "/admin/expiries", label: "Expiries & renewals", glyph: "expiries" as const },
    { href: "/admin/documents", label: "Documents & IDs", glyph: "documents" as const },
  ];
  return <SpaceHub title="Life admin" glyph="admin" items={items} fromHome={from === "home"} />;
}
