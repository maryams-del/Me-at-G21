import Link from "next/link";
import { pageOwner, dashboardState, customSpacesState } from "@/server/queries";
import { isSpaceGlyph, builtinSpace, BUILTIN_SPACES, spacesOrderOf, bySavedOrder } from "@/lib/spaces";
import { formatMoney } from "@/lib/money";
import { addDays, formatInstant, formatLocalDate, instantToLocal } from "@/lib/time";
import { WeekRings, type Day } from "@/components/home/WeekRings";
import { AiBar } from "@/components/home/AiBar";
import { FrequentlyVisited } from "@/components/home/FrequentlyVisited";
import { HomeNoZoom } from "@/components/home/HomeNoZoom";
import { SpacePages } from "@/components/home/SpacePages";
import { Glyph, type GlyphKind } from "@/components/Glyph";

export default async function Dashboard() {
  const o = await pageOwner();
  const s = await dashboardState(o);
  const mine = await customSpacesState(o);
  const tz = o.timezone;
  const hm = (at: Date) => formatInstant(at, tz, { hour: "2-digit", minute: "2-digit", hour12: false });

  // Next 7 days: the actual dates of things (classes, expiries, deadlines, due dates, charges), grouped by
  // local day. Reminders are deliberately not listed: they're notifications about these same things.
  const days: Day[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(s.today, i);
    const weekday = formatLocalDate(date, { weekday: "short" });
    return { date, weekday, dayNum: date.slice(8, 10), title: i === 0 ? "Today" : formatLocalDate(date, { weekday: "long", day: "numeric" }), items: [] };
  });
  const byDate = new Map(days.map((d) => [d.date, d]));
  const add = (date: string, text: string, href?: string, when?: string) => {
    const d = byDate.get(date);
    if (d && !d.items.some((x) => x.text === text)) d.items.push({ text, href, when });
  };
  for (const e of s.weekEvents) add(e.date, e.title, "/quran", hm(e.startsAt));
  for (const h of s.openHomework) if (h.dueAt) add(instantToLocal(h.dueAt, tz).date, `Homework: ${h.title}`, "/quran", "due");
  for (const tk of s.tasksDueSoon) if (tk.dueOn) add(tk.dueOn, `Task: ${tk.title}`, "/projects");
  for (const e of s.expiring) add(e.expiresOn, `${e.label} expires`, "/admin/expiries");
  for (const d of s.debts) if (d.debt.status === "open" && d.debt.dueDate) {
    add(d.debt.dueDate, d.debt.direction === "lent" ? `${d.debt.counterparty} owes you ${formatMoney(d.outstanding, d.debt.currency)}` : `Repay ${d.debt.counterparty} ${formatMoney(d.outstanding, d.debt.currency)}`, "/finance/debts");
  }

  for (const r of s.routines) if (r.due && !r.routine.paused) add(r.due, `${r.routine.name} due`, "/care/routines");
  for (const c of s.subscriptions.upcoming) add(c.date, `${c.name} renews · ${formatMoney(c.amountMinor, c.currency)}`, "/finance/subscriptions");
  for (const r of s.appDeadlines) if (r.app.deadlineAt) add(instantToLocal(r.app.deadlineAt, tz).date, `${r.app.university} deadline`, `/education/applications/${r.app.id}`, hm(r.app.deadlineAt));

  // Spaces, as quiet icon tiles: every space by its own name (never a section heading), in the order set on the
  // Spaces page. Removed spaces stay off. Tapping one opens that space.
  const order = spacesOrderOf(o.settings);
  const items: { key: string; name: string; href: string; glyph: GlyphKind; section: string }[] = [
    ...BUILTIN_SPACES.flatMap((base) => {
      const b = builtinSpace(base.href, o.settings)!;
      return b.hidden ? [] : [{ key: b.href, name: b.label, href: b.href, glyph: b.glyph, section: b.section }];
    }),
    ...mine.map((c) => ({ key: `/spaces/${c.space.id}`, name: c.space.name, href: `/spaces/${c.space.id}`, glyph: isSpaceGlyph(c.space.glyph) ? c.space.glyph : ("projects" as const), section: c.space.section })),
  ];
  const sectionNames = [...new Set(items.map((x) => x.section))];
  const spaces = [
    ...bySavedOrder(sectionNames, (t) => t, order.sections).flatMap((t) => bySavedOrder(items.filter((x) => x.section === t), (x) => x.key, order.cards[t])),
    { key: "/history", name: "History", href: "/history", glyph: "history" as GlyphKind, section: "" },
  ];

  return (
    <div className="grid gap-9 md:gap-12">
      <HomeNoZoom />
      <h1 className="sr-only">Today</h1>
      <section aria-label="Ask AI" className="w-full max-w-[640px] mx-auto">
        <AiBar />
        <FrequentlyVisited />
      </section>
      <div className="grid gap-9 lg:grid-cols-2 lg:gap-7 items-start">
        <WeekRings days={days} />
        <section aria-labelledby="spaces-h" className="home-spaces">
          <h2 id="spaces-h" className="t-label mb-4" style={{ color: "var(--ink-3)" }}>Spaces</h2>
          <SpacePages spaces={spaces} />
        </section>
      </div>
    </div>
  );
}
