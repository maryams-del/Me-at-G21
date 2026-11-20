import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Glyph } from "@/components/Glyph";

export default function AdminIndex() {
  const items = [
    { href: "/admin/expiries", label: "Expiries & renewals", glyph: "expiries" as const, d: "Passport, ID, licences, cards. Reminders 90, 30 and 7 days ahead" },
    { href: "/admin/documents", label: "Documents & IDs", glyph: "documents" as const, d: "Encrypted files and protected ID numbers" },
  ];
  return (
    <>
      <PageHeader glyph="admin" title="Life admin" />
      <ul className="grid gap-3 grid-cols-2">
        {items.map((i) => <li key={i.href}><Link href={i.href} className="tile min-h-0"><Glyph kind={i.glyph} size={30} accent="var(--rust)" /><p className="t-h3 mt-3">{i.label}</p></Link></li>)}
      </ul>
    </>
  );
}
