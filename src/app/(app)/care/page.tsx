import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Glyph } from "@/components/Glyph";

export default function CareIndex() {
  const items = [
    { href: "/care/waxing", label: "Waxing", glyph: "waxing" as const, d: "40-day window from your last session" },
    { href: "/care/dental", label: "Dental scaling", glyph: "dental" as const, d: "Every six calendar months" },
    { href: "/care/routines", label: "Routines", glyph: "routines" as const, d: "Toothbrush, brushes, bedsheets and more" },
  ];
  return (
    <>
      <PageHeader glyph="care" title="Personal care" />
      <ul className="grid gap-3 sm:grid-cols-3">
        {items.map((i) => <li key={i.href}><Link href={i.href} className="tile"><Glyph kind={i.glyph} size={30} accent="var(--rust)" /><p className="t-h3 mt-3">{i.label}</p><p className="t-small text-ink-2">{i.d}</p></Link></li>)}
      </ul>
      <p className="t-meta mt-6">The private period log arrives in Phase B.</p>
    </>
  );
}
