import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Glyph } from "@/components/Glyph";

export default function CareIndex() {
  const items = [
    { href: "/care/period", label: "Period log", glyph: "period" as const, d: "Private log, calendar and your own estimates" },
    { href: "/care/routines", label: "Routines", glyph: "routines" as const, d: "Waxing, dental scaling, toothbrush, bedsheets, anything on a cycle" },
  ];
  return (
    <>
      <PageHeader glyph="care" title="Personal care" />
      <ul className="grid gap-3 grid-cols-2">
        {items.map((i) => <li key={i.href}><Link href={i.href} className="tile min-h-0"><Glyph kind={i.glyph} size={30} accent="var(--rust)" /><p className="t-h3 mt-3">{i.label}</p></Link></li>)}
      </ul>
    </>
  );
}
