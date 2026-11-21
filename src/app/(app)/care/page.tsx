import { SpaceHub } from "@/components/SpaceHub";

export default async function CareIndex({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const items = [
    { href: "/care/period", label: "Period log", glyph: "period" as const },
    { href: "/care/routines", label: "Routines", glyph: "routines" as const },
  ];
  return <SpaceHub title="Personal care" glyph="care" items={items} fromHome={from === "home"} />;
}
