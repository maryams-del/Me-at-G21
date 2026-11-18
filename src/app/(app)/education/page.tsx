import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Glyph } from "@/components/Glyph";

export default function EducationIndex() {
  const items = [
    { href: "/education/applications", label: "Master's applications", glyph: "applications" as const, d: "Deadlines, requirements, status and follow-ups" },
    { href: "/projects", label: "Projects & tasks", glyph: "projects" as const, d: "Deadlines and checklists" },
  ];
  return (
    <>
      <PageHeader glyph="applications" title="Education & career" />
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((i) => <li key={i.href}><Link href={i.href} className="tile"><Glyph kind={i.glyph} size={30} accent="var(--rust)" /><p className="t-h3 mt-3">{i.label}</p><p className="t-small text-ink-2">{i.d}</p></Link></li>)}
      </ul>
    </>
  );
}
