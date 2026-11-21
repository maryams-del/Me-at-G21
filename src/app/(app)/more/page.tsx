import { PageHeader } from "@/components/ui";
import { type GlyphKind } from "@/components/Glyph";
import { pageOwner, attentionCount, customSpacesState, dashboardState } from "@/server/queries";
import { isSpaceGlyph, spacesOrderOf, spacesPinsOf, bySavedOrder, SECTION_TINT, CUSTOM_TINT } from "@/lib/spaces";
import { formatMoney } from "@/lib/money";
import { relDays } from "@/lib/format";
import { addDays, dmy } from "@/lib/time";
import { SpacesStacks, type StackGroup } from "@/components/SpacesStacks";
import { spaceFields } from "../spaces/fields";

type Item = { href: string; label: string; glyph: GlyphKind; d: string; note?: string; stat?: string };

/** Spaces: every section of the app in one place (the "Spaces" menu item on phone and web). */
export default async function Spaces() {
  const o = await pageOwner();
  const n = await attentionCount(o);
  const mine = await customSpacesState(o);
  const s = await dashboardState(o);
  const money = (rows: { sum: number | string; cur: string }[]) => rows.length ? rows.map((c) => formatMoney(Number(c.sum), c.cur)).join(" + ") : null;
  const owedToMe = s.debts.filter((d) => d.debt.status === "open" && d.debt.direction === "lent");
  const subTotals = Object.entries(s.subscriptions.totals);
  const nextRoutine = s.routines.filter((r) => r.due && !r.routine.paused).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))[0];
  const stat: Record<string, string | undefined> = {
    "/finance/charity": money(s.charityMonth) ? `${money(s.charityMonth)} this month` : undefined,
    "/finance/savings": s.savings.length ? `${s.savings.length} goal${s.savings.length === 1 ? "" : "s"} · ${Math.round(s.savings.reduce((a, g) => a + g.pct, 0) / s.savings.length)}%` : undefined,
    "/finance/debts": owedToMe.length ? `${owedToMe.length} owe${owedToMe.length === 1 ? "s" : ""} you` : undefined,
    "/finance/subscriptions": subTotals.length ? `${subTotals.map(([c, t]) => formatMoney(t.monthly, c)).join(" + ")} a month` : undefined,
    "/care/routines": nextRoutine ? `${nextRoutine.routine.name} ${nextRoutine.overdue ? "overdue" : `due ${relDays(nextRoutine.daysLeft)}`}` : undefined,
    "/faith/fasts": s.fasts.hasInitial || s.fasts.ledger.length ? `${s.fasts.balance} left` : undefined,
    "/education/applications": s.appDeadlines.length ? `${s.appDeadlines.length} deadline${s.appDeadlines.length === 1 ? "" : "s"} soon` : undefined,
    "/projects": s.tasksDueSoon.length ? `${s.tasksDueSoon.length} due this week` : undefined,
    "/admin/expiries": s.expiring[0] ? `${s.expiring[0].label} · ${dmy(s.expiring[0].expiresOn)}` : undefined,
    "/inbox": n ? `${n} to look at` : undefined,
  };
  // A small dot on a space means something there needs the owner soon.
  const in30 = addDays(s.today, 30);
  const needs: Record<string, boolean> = {
    "/admin/expiries": s.expiring.some((e) => e.expiresOn <= in30) || s.overdue.some((x) => x.href === "/admin/expiries"),
    "/inbox": n > 0,
    "/education/applications": s.appDeadlines.length > 0,
    "/care/routines": !!nextRoutine && (nextRoutine.overdue || (nextRoutine.daysLeft ?? 99) <= 3),
    "/projects": s.tasksDueSoon.length > 0,
    "/finance/debts": s.debts.some((d) => d.overdue),
  };
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
  ];
  // The owner's own spaces: under a built-in group, or in sections they made up.
  for (const c of mine) {
    const item: Item = { href: `/spaces/${c.space.id}`, label: c.space.name, glyph: isSpaceGlyph(c.space.glyph) ? c.space.glyph : "projects",
      d: c.space.description ?? "Your own space", stat: c.open ? `${c.open} to do` : c.done ? "All done" : undefined };
    const g = groups.find((x) => x.title === c.space.section);
    if (g) g.items.push(item); else groups.push({ title: c.space.section, items: [item] });
  }
  const sections = [...new Set(mine.map((c) => c.space.section))];
  const order = spacesOrderOf(o.settings);
  const builtIn = new Set(Object.keys(SECTION_TINT));
  const stacked: StackGroup[] = bySavedOrder(groups, (g) => g.title, order.sections).map((g) => ({
    title: g.title,
    tint: SECTION_TINT[g.title] ?? CUSTOM_TINT,
    custom: !builtIn.has(g.title),
    cards: bySavedOrder(g.items, (i) => i.href, order.cards[g.title]).map((i) => ({ key: i.href, href: i.href, label: i.label, glyph: i.glyph, d: i.d, stat: i.stat ?? stat[i.href], needs: !!needs[i.href] })),
  }));
  return (
    <>
      <PageHeader title="Spaces" />
      <SpacesStacks groups={stacked} pins={spacesPinsOf(o.settings)} addFields={spaceFields(sections)} addInitial={{ section: "Life admin", glyph: "projects" }} />
    </>
  );
}
