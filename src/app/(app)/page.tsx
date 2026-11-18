import Link from "next/link";
import { pageOwner, dashboardState } from "@/server/queries";
import { formatMoney } from "@/lib/money";
import { addDays, dmy, formatInstant, formatLocalDate, instantToLocal } from "@/lib/time";
import { relDays, fmtDateTime, fmtShort } from "@/lib/format";
import { NextSevenDays, type Day } from "@/components/home/NextSevenDays";
import { AiBar } from "@/components/home/AiBar";
import { SpacesWave, type Space } from "@/components/home/SpacesWave";
import { FrequentlyVisited } from "@/components/home/FrequentlyVisited";

const TINT = {
  amber: "radial-gradient(circle at 35% 30%, #FFE2B5, #F0A94B)",
  blush: "radial-gradient(circle at 35% 30%, #FFDCCD, #E8A08A)",
  sky: "radial-gradient(circle at 35% 30%, #DCE8F6, #8FB0D8)",
  moss: "radial-gradient(circle at 35% 30%, #E3F0D2, #9DBE78)",
};

export default async function Dashboard() {
  const o = await pageOwner();
  const s = await dashboardState(o);
  const tz = o.timezone;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz }).format(new Date()));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const hm = (at: Date) => formatInstant(at, tz, { hour: "2-digit", minute: "2-digit", hour12: false });

  // Next 7 days: everything with a date, grouped by local day.
  const days: Day[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(s.today, i);
    const weekday = formatLocalDate(date, { weekday: "short" });
    return { date, weekday, dayNum: date.slice(8, 10), title: i === 0 ? "Today" : `${weekday} ${dmy(date).slice(0, 5)}`, items: [] };
  });
  const byDate = new Map(days.map((d) => [d.date, d]));
  const add = (date: string, text: string, href?: string) => {
    const d = byDate.get(date);
    if (d && !d.items.some((x) => x.text === text)) d.items.push({ text, href });
  };
  if (s.nextClass) add(instantToLocal(s.nextClass.startsAt, tz).date, `Quran class · ${hm(s.nextClass.startsAt)}`, "/quran");
  for (const r of s.upcoming) add(instantToLocal(r.fireAt, tz).date, `${r.title} · ${hm(r.fireAt)}`);
  for (const tk of s.tasksDueSoon) if (tk.dueOn) add(tk.dueOn, `Task: ${tk.title}`, "/projects");
  for (const e of s.expiring) add(e.expiresOn, `${e.label} expires`, "/admin/expiries");
  for (const d of s.debts) if (d.debt.status === "open" && d.debt.dueDate) {
    add(d.debt.dueDate, d.debt.direction === "lent" ? `${d.debt.counterparty} owes you ${formatMoney(d.outstanding, d.debt.currency)}` : `Repay ${d.debt.counterparty} ${formatMoney(d.outstanding, d.debt.currency)}`, "/finance/debts");
  }

  for (const r of s.routines) if (r.due && !r.routine.paused) add(r.due, `${r.routine.name} due`, "/care/routines");
  for (const c of s.subscriptions.upcoming) add(c.date, `${c.name} renews · ${formatMoney(c.amountMinor, c.currency)}`, "/finance/subscriptions");
  for (const r of s.appDeadlines) if (r.app.deadlineAt) add(instantToLocal(r.app.deadlineAt, tz).date, `${r.app.university} deadline · ${hm(r.app.deadlineAt)}`, `/education/applications/${r.app.id}`);

  const week = addDays(s.today, 6);
  const later: { label: string; when: string; href: string }[] = [
    ...s.appDeadlines.filter((r) => r.app.deadlineAt && instantToLocal(r.app.deadlineAt, tz).date > week).map((r) => ({ label: `${r.app.university}, ${r.app.program}`, when: `deadline ${fmtShort(instantToLocal(r.app.deadlineAt!, tz).date)}`, href: `/education/applications/${r.app.id}` })),
    ...s.expiring.filter((e) => e.expiresOn > week).map((e) => ({ label: e.label, when: `expires ${fmtShort(e.expiresOn)}`, href: "/admin/expiries" })),
  ].slice(0, 6);
  const nextRoutine = s.routines.filter((r) => r.due && !r.routine.paused).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))[0];
  const p = s.period;
  const periodStat = !p ? "" : p.open ? `Day ${p.openDay}` : p.estimate && p.settings.showEstimate ? `Next ${relDays(p.daysToEstimate)} (estimate)` : p.cycles[0] ? `Last started ${dmy(p.cycles[0].startDate)}` : "Nothing logged yet";
  const nApps = s.appDeadlines.length;
  const charity = s.charityMonth.length ? s.charityMonth.map((c) => formatMoney(Number(c.sum), c.cur)).join(" + ") : formatMoney(0, o.defaultCurrency);
  const nTasks = s.tasksDueSoon.length;
  const spaces: Space[] = [
    { key: "money", name: "Money", stat: `${charity} given this month`, href: "/finance", glyph: "finance", tint: TINT.amber },
    { key: "care", name: "Care", stat: nextRoutine ? `${nextRoutine.routine.name} ${nextRoutine.overdue ? "overdue" : `due ${relDays(nextRoutine.daysLeft)}`}` : "Routines & self-care", href: "/care", glyph: "care", tint: TINT.blush },
    ...(p ? [{ key: "period", name: "Period", stat: periodStat, href: "/care/period", glyph: "period" as const, tint: TINT.blush }] : []),
    { key: "fasts", name: "Fasts", stat: s.fasts.hasInitial || s.fasts.ledger.length ? `${s.fasts.balance} make-up fasts left` : "Set your opening balance", href: "/faith/fasts", glyph: "fasts", tint: TINT.sky },
    { key: "quran", name: "Quran", stat: s.nextClass ? `Class ${formatInstant(s.nextClass.startsAt, tz, { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}` : "No class scheduled", href: "/quran", glyph: "quran", tint: TINT.moss },
    { key: "admin", name: "Admin", stat: s.expiring.length ? `${s.expiring.length} expiring in 90 days` : "Expiries & documents", href: "/admin", glyph: "admin", tint: TINT.amber },
    { key: "education", name: "Education", stat: nApps ? `${nApps} deadline${nApps === 1 ? "" : "s"} in 30 days` : "Applications & achievements", href: "/education", glyph: "education", tint: TINT.sky },
    { key: "projects", name: "Projects", stat: nTasks ? `${nTasks} task${nTasks === 1 ? "" : "s"} due this week` : "Projects & tasks", href: "/projects", glyph: "projects", tint: TINT.moss },
    { key: "vault", name: "Vault", stat: "Locked away", href: "/vault", glyph: "vault", tint: TINT.sky },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:gap-8 items-start">
      <div className="grid gap-5 min-w-0">
        <h1 className="t-display">{greet}{o.displayName ? `, ${o.displayName}` : ""}</h1>

        {s.overdue.length > 0 && (
          <section aria-labelledby="overdue-h" className="panel p-4" style={{ boxShadow: "inset 0 0 0 1.5px var(--rust), var(--glass-shadow)" }}>
            <h2 id="overdue-h" className="t-h3 mb-1" style={{ color: "var(--rust)" }}>Overdue</h2>
            <ul className="list">
              {s.overdue.map((x, i) => (
                <li key={i} className="py-2 flex justify-between gap-3 t-small"><Link href={x.href} className="underline underline-offset-4">{x.label}</Link><span className="text-ink-2">{x.detail}</span></li>
              ))}
            </ul>
          </section>
        )}

        <NextSevenDays days={days} />
        <AiBar />

        <FrequentlyVisited />

        {(s.pendingAi > 0 || s.drafts.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {s.pendingAi > 0 && <span className="chip chip-mustard">{s.pendingAi} capture preview{s.pendingAi === 1 ? "" : "s"} waiting for you</span>}
            {s.drafts.length > 0 && <Link href="/inbox" className="chip chip-fill no-underline">{s.drafts.length} need{s.drafts.length === 1 ? "s" : ""} details →</Link>}
          </div>
        )}

        {!s.notif.pushEnabled && (
          <div className="panel p-4 flex flex-wrap items-center justify-between gap-3">
            <p className="t-small prose-w">Reminders currently appear only inside the app. Turn on notifications to get them on this device.</p>
            <Link href="/settings/notifications" className="btn btn-sm">Set up notifications</Link>
          </div>
        )}

        {later.length > 0 && (
          <section aria-labelledby="later-h" className="panel p-4">
            <h2 id="later-h" className="t-h3 mb-1">Later on</h2>
            <ul className="list">
              {later.map((x, i) => <li key={i} className="py-2 flex justify-between gap-3 t-small"><Link href={x.href} className="hover:underline underline-offset-4">{x.label}</Link><span className="t-meta whitespace-nowrap">{x.when}</span></li>)}
            </ul>
          </section>
        )}

        <section aria-labelledby="rc-h" className="panel p-4">
          <div className="flex justify-between items-baseline"><h2 id="rc-h" className="t-h3">Recent activity</h2><Link href="/history" className="t-small underline underline-offset-4">History</Link></div>
          {s.recent.length ? (
            <ul className="list mt-1">{s.recent.slice(0, 5).map((r) => (
              <li key={r.id} className="py-2 t-small flex justify-between gap-3"><span>{r.sensitive ? "Private entry" : r.summary}</span><span className="t-meta whitespace-nowrap">{r.source === "ai" ? "AI, " : ""}{fmtDateTime(r.occurredAt, tz)}</span></li>
            ))}</ul>
          ) : <p className="t-meta mt-1">Your log is empty. Try the quick actions or the AI bar.</p>}
        </section>
      </div>

      <section aria-labelledby="spaces-h" className="spaces-panel px-[18px] pt-6 pb-5 md:px-8 md:pt-8 -mx-[18px] md:mx-0">
        <div aria-hidden className="absolute inset-0 pointer-events-none">
          <div className="absolute rounded-full" style={{ left: "6%", top: "30%", width: 240, height: 240, background: "radial-gradient(circle, rgba(240,169,75,.55), rgba(240,169,75,0) 70%)" }} />
          <div className="absolute rounded-full" style={{ right: "4%", top: "8%", width: 260, height: 260, background: "radial-gradient(circle, rgba(110,140,80,.45), rgba(110,140,80,0) 70%)" }} />
          <div className="absolute rounded-full" style={{ left: "40%", bottom: -60, width: 280, height: 220, background: "radial-gradient(circle, rgba(214,140,110,.4), rgba(214,140,110,0) 70%)" }} />
        </div>
        <div className="relative flex justify-between items-baseline gap-3 pl-[88px] md:pl-[120px]">
          <h2 id="spaces-h" className="t-h2">Your spaces</h2>
          <span className="t-meta muted font-semibold">Swipe ↔</span>
        </div>
        <div className="relative mt-2">
          <SpacesWave spaces={spaces} />
        </div>
      </section>
    </div>
  );
}
