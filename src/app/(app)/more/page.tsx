import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Glyph, type GlyphKind } from "@/components/Glyph";
import { pageOwner, inboxCount, customSpacesState } from "@/server/queries";
import { OpForm, Reveal } from "@/components/OpForm";
import { isSpaceGlyph } from "@/lib/spaces";
import { spaceFields } from "../spaces/fields";

type Item = { href: string; label: string; glyph: GlyphKind; d: string; note?: string };

/** Spaces: every section of the app in one place (the "Spaces" menu item on phone and web). */
export default async function Spaces() {
  const o = await pageOwner();
  const n = await inboxCount(o.id);
  const mine = await customSpacesState(o);
  const groups: { title: string; items: Item[] }[] = [
    { title: "Money", items: [
      { href: "/finance/charity", label: "Charity", glyph: "charity", d: "Donations, monthly and yearly totals" },
      { href: "/finance/savings", label: "Savings", glyph: "savings", d: "Goals and actual deposits" },
      { href: "/finance/debts", label: "Lent & borrowed", glyph: "debts", d: "Who owes whom, repayments" },
      { href: "/finance/subscriptions", label: "Subscriptions", glyph: "subscriptions", d: "Monthly cost and upcoming charges" },
      { href: "/finance/zakat", label: "Zakat", glyph: "zakat", d: "Step-by-step estimate and payments" },
    ] },
    { title: "Care", items: [
      { href: "/care/routines", label: "Routines", glyph: "routines", d: "Waxing, dental scaling, bedsheets and more" },
      { href: "/care/period", label: "Period log", glyph: "period", d: "Private, never sent to the AI" },
    ] },
    { title: "Faith", items: [
      { href: "/faith/fasts", label: "Make-up fasts", glyph: "fasts", d: "Balance and completed fasts" },
      { href: "/quran", label: "Quran class", glyph: "quran", d: "Classes, homework, study time" },
    ] },
    { title: "Education & career", items: [
      { href: "/education/applications", label: "Master's applications", glyph: "applications", d: "Deadlines, requirements, status" },
      { href: "/education/achievements", label: "Achievements & hobbies", glyph: "achievements", d: "Accomplishments and CV bullets" },
      { href: "/projects", label: "Projects & tasks", glyph: "projects", d: "Deadlines and checklists" },
    ] },
    { title: "Life admin", items: [
      { href: "/admin/expiries", label: "Expiries & renewals", glyph: "expiries", d: "IDs, licences, anything that runs out" },
      { href: "/admin/documents", label: "Documents & IDs", glyph: "documents", d: "Encrypted files and ID numbers" },
      { href: "/vault", label: "Secure vault", glyph: "vault", d: "Locked away" },
    ] },
    { title: "You", items: [
      { href: "/inbox", label: "Needs details", glyph: "inbox", d: "Captures waiting for more info", note: n ? `${n} waiting` : undefined },
      { href: "/history", label: "History & search", glyph: "history", d: "Everything you've logged" },
      { href: "/settings", label: "Settings", glyph: "settings", d: "Profile, security, notifications" },
      { href: "/settings/data", label: "Data & backups", glyph: "documents", d: "Exports, backups, undo" },
    ] },
  ];
  // The owner's own spaces: under a built-in group, or in sections they made up.
  for (const c of mine) {
    const item: Item = { href: `/spaces/${c.space.id}`, label: c.space.name, glyph: isSpaceGlyph(c.space.glyph) ? c.space.glyph : "projects",
      d: c.space.description ?? (c.open || c.done ? `${c.open} to do · ${c.done} done` : "Your own space"), note: c.open ? `${c.open}` : undefined };
    const g = groups.find((x) => x.title === c.space.section);
    if (g) g.items.push(item); else groups.push({ title: c.space.section, items: [item] });
  }
  const sections = [...new Set(mine.map((c) => c.space.section))];
  return (
    <>
      <PageHeader title="Spaces" intro="Every part of Me @ G21 in one place. Add your own spaces under any section, or start a new section." />
      <div className="mb-8">
        <Reveal label="+ Add a space" buttonClass="btn btn-accent">
          <OpForm op="space.create" fields={spaceFields(sections)} initial={{ section: "You", glyph: "projects" }} submitLabel="Add space" />
        </Reveal>
      </div>
      <div className="grid gap-8">
        {groups.map((g) => (
          <section key={g.title} aria-labelledby={`sp-${g.title}`}>
            <h2 id={`sp-${g.title}`} className="t-label mb-3">{g.title}</h2>
            <ul className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              {g.items.map((i) => (
                <li key={i.href}>
                  <Link href={i.href} className="tile h-full" style={{ minHeight: "7.5rem" }}>
                    <span className="flex items-start justify-between gap-2">
                      <Glyph kind={i.glyph} size={28} accent="var(--mustard)" />
                      {i.note && <span className="chip chip-mustard">{i.note}</span>}
                    </span>
                    <p className="t-h3 mt-3">{i.label}</p>
                    <p className="t-small text-ink-2 mt-0.5">{i.d}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
