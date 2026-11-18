import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Glyph, type GlyphKind } from "@/components/Glyph";
import { pageOwner, inboxCount } from "@/server/queries";

export default async function More() {
  const o = await pageOwner();
  const n = await inboxCount(o.id);
  const items: { href: string; label: string; glyph: GlyphKind; note?: string }[] = [
    { href: "/inbox", label: "Needs details", glyph: "inbox", note: n ? `${n} waiting` : undefined },
    { href: "/faith/fasts", label: "Make-up fasts", glyph: "fasts" }, { href: "/quran", label: "Quran class", glyph: "quran" },
    { href: "/projects", label: "Projects & tasks", glyph: "projects" },
    { href: "/admin/expiries", label: "Expiries & renewals", glyph: "expiries" }, { href: "/admin/documents", label: "Documents & IDs", glyph: "documents" },
    { href: "/history", label: "History & search", glyph: "history" },
    { href: "/vault", label: "Secure vault", glyph: "vault" }, { href: "/settings", label: "Settings", glyph: "settings" },
  ];
  return (
    <>
      <PageHeader title="More" />
      <ul className="list panel px-2">
        {items.map((i) => <li key={i.href}><Link href={i.href} className="nav-link"><Glyph kind={i.glyph} size={20} accent="var(--rust)" /><span>{i.label}</span>{i.note && <span className="ml-auto chip chip-mustard">{i.note}</span>}</Link></li>)}
      </ul>
    </>
  );
}
