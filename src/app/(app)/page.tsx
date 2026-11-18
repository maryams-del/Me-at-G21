import Link from "next/link";
import { pageOwner, dashboardState } from "@/server/queries";
import { Glyph } from "@/components/Glyph";
import { OpButton } from "@/components/OpForm";
import { OpenCaptureButton } from "@/components/AppShell";
import { ReminderList } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { formatHijri, formatLocalDate } from "@/lib/time";
import { fmtDateTime, fmtShort, relDays } from "@/lib/format";

function until(at: Date) {
  const mins = Math.round((at.getTime() - Date.now()) / 60000);
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `in ${h} h ${mins % 60} min`;
  const d = Math.floor(h / 24);
  return `in ${d} day${d === 1 ? "" : "s"} ${h % 24} h`;
}

export default async function Dashboard() {
  const o = await pageOwner();
  const s = await dashboardState(o);
  const tz = o.timezone;
  const charity = s.charityMonth.length ? s.charityMonth.map((c) => formatMoney(Number(c.sum), c.cur)).join(" + ") : formatMoney(0, o.defaultCurrency);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz }).format(new Date()));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="t-small text-ink-2">{formatLocalDate(s.today, { weekday: "long", day: "numeric", month: "long" })}, {formatHijri(s.today)}</p>
          <h1 className="t-display mt-1">{greet}{o.displayName ? `, ${o.displayName}` : ""}</h1>
        </div>
        <OpenCaptureButton label="Add entry by AI" />
      </header>

      <nav aria-label="Quick actions" className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <Link href="/finance/charity?add=1" className="btn btn-sm">Log charity</Link>
        <OpButton op="waxing.complete" input={{ completedOn: s.today }} label="Waxing completed" className="btn btn-sm" confirmText={`Log waxing completed today (${s.today})? This restarts the 40-day cycle.`} />
        <OpButton op="fasts.complete" input={{ onDate: s.today }} label="Fast completed" className="btn btn-sm" confirmText={`Record one make-up fast completed today (${s.today})?`} />
        <Link href="/finance/savings?add=1" className="btn btn-sm">Add savings</Link>
        <Link href="/projects?add=1" className="btn btn-sm">Add task</Link>
      </nav>

      {!s.notif.pushEnabled && (
        <div className="panel p-4 flex flex-wrap items-center justify-between gap-3" style={{ background: "var(--tint-slate)" }}>
          <p className="t-small prose-w">Reminders currently appear only inside the app. Turn on notifications to get them on this device.</p>
          <Link href="/settings/notifications" className="btn btn-sm">Set up notifications</Link>
        </div>
      )}

      {s.overdue.length > 0 && (
        <section aria-labelledby="overdue-h" className="panel p-4" style={{ borderColor: "var(--rust)", boxShadow: "inset 6px 0 0 var(--rust)" }}>
          <h2 id="overdue-h" className="t-h3 mb-2">Overdue</h2>
          <ul className="list">
            {s.overdue.map((x, i) => (
              <li key={i} className="py-2 flex justify-between gap-3 t-small"><Link href={x.href} className="underline underline-offset-4">{x.label}</Link><span className="text-ink-2">{x.detail}</span></li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Link href="/quran" className="tile slate col-span-2 min-h-[11rem]">
          <p className="t-small" style={{ opacity: 0.85 }}>Quran class</p>
          {s.nextClass ? (
            <>
              <p className="t-num text-[2.6rem] mt-2">{until(s.nextClass.startsAt)}</p>
              <p className="t-small mt-2">{fmtDateTime(s.nextClass.startsAt, tz)}. {s.openHomework.length ? `${s.openHomework.length} homework item${s.openHomework.length === 1 ? "" : "s"} open.` : "No open homework."}</p>
              <p className="t-small mt-1" style={{ opacity: 0.85 }}>{s.study ? (s.study.paused ? "Translation study reminder not active yet." : `Translation study: ${["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][s.study.weekday]} ${s.study.localTime}.`) : ""}</p>
            </>
          ) : <p className="t-small mt-2">No upcoming class scheduled.</p>}
          <Glyph kind="quran" size={110} color="var(--paper)" className="glyph-corner" />
        </Link>

        <Link href="/faith/fasts" className="tile mustard">
          <p className="t-small">Make-up fasts</p>
          {s.fasts.hasInitial || s.fasts.ledger.length ? (
            <><p className="t-num text-[3.4rem] mt-2">{s.fasts.balance}</p><p className="t-small">remaining</p></>
          ) : <p className="t-small mt-3">Set your opening balance</p>}
          <Glyph kind="fasts" size={84} color="var(--ink)" accent="var(--ink)" className="glyph-corner" />
        </Link>

        <Link href="/finance/charity" className="tile rust">
          <p className="t-small">Charity this month</p>
          <p className="t-num text-[2rem] mt-3 break-words">{charity}</p>
          <Glyph kind="charity" size={80} color="var(--paper)" className="glyph-corner" />
        </Link>

        <Link href="/care/waxing" className="tile">
          <p className="t-small text-ink-2">Waxing</p>
          {s.wax.last ? (
            <>
              <p className="t-num text-[2.6rem] mt-2">Day {s.wax.day}</p>
              <p className="t-small text-ink-2">of {s.wax.rule.windowDays}. Recommended {fmtShort(s.wax.recommended)}</p>
              <div className="bar mt-3" aria-hidden><i style={{ width: `${Math.min(100, ((s.wax.day ?? 0) / s.wax.rule.windowDays) * 100)}%`, background: s.wax.overdue ? "var(--rust)" : "var(--ink)" }} /></div>
            </>
          ) : <p className="t-small mt-3 text-ink-2">No session logged yet</p>}
        </Link>

        <Link href="/care/dental" className="tile">
          <p className="t-small text-ink-2">Dental scaling</p>
          {s.dental.due ? (<><p className="t-num text-[2.2rem] mt-2">{fmtShort(s.dental.due)}</p><p className="t-small text-ink-2">due {relDays(s.dental.daysLeft)}</p></>) : <p className="t-small mt-3 text-ink-2">No visit logged yet</p>}
        </Link>

        <Link href="/finance/savings" className="tile col-span-2">
          <p className="t-small text-ink-2">Savings</p>
          {s.savings.length ? (
            <ul className="mt-3 grid gap-3">
              {s.savings.filter((g) => g.goal.status === "active").slice(0, 3).map((g) => (
                <li key={g.goal.id}>
                  <div className="flex justify-between t-small"><span className="font-medium">{g.goal.name}</span><span>{formatMoney(g.balance, g.goal.currency)} of {formatMoney(g.goal.targetMinor, g.goal.currency)}</span></div>
                  <div className="bar mt-1" role="img" aria-label={`${g.pct}%`}><i style={{ width: `${g.pct}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : <p className="t-small mt-3 text-ink-2">Create a goal to track progress</p>}
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="panel p-5" aria-labelledby="up-h">
          <h2 id="up-h" className="t-h2 mb-3">Next 7 days</h2>
          <ReminderList items={s.upcoming} tz={tz} />
          {s.tasksDueSoon.length > 0 && (
            <>
              <h3 className="t-h3 mt-5 mb-2">Tasks due</h3>
              <ul className="list">{s.tasksDueSoon.map((tk) => <li key={tk.id} className="py-2 flex justify-between t-small"><Link href="/projects" className="underline underline-offset-4">{tk.title}</Link><span className="t-meta">{fmtShort(tk.dueOn)}</span></li>)}</ul>
            </>
          )}
          {s.expiring.length > 0 && (
            <>
              <h3 className="t-h3 mt-5 mb-2">Expiring within 90 days</h3>
              <ul className="list">{s.expiring.map((e) => <li key={e.id} className="py-2 flex justify-between t-small"><Link href="/admin/expiries" className="underline underline-offset-4">{e.label}</Link><span className="t-meta">{fmtShort(e.expiresOn)}</span></li>)}</ul>
            </>
          )}
          {s.debts.some((d) => d.debt.status === "open") && (
            <>
              <h3 className="t-h3 mt-5 mb-2">Lent & borrowed</h3>
              <ul className="list">{s.debts.filter((d) => d.debt.status === "open").slice(0, 5).map((d) => (
                <li key={d.debt.id} className="py-2 flex justify-between t-small gap-3">
                  <span>{d.debt.direction === "lent" ? `${d.debt.counterparty} owes you` : `You owe ${d.debt.counterparty}`}</span>
                  <span className="whitespace-nowrap">{formatMoney(d.outstanding, d.debt.currency)}{d.debt.dueDate ? `, due ${fmtShort(d.debt.dueDate)}` : ""}</span>
                </li>))}</ul>
            </>
          )}
        </section>

        <div className="grid gap-6 content-start">
          <section className="panel p-5" aria-labelledby="nd-h">
            <div className="flex justify-between items-baseline"><h2 id="nd-h" className="t-h2">Needs details</h2><Link href="/inbox" className="t-small underline underline-offset-4">Open</Link></div>
            {s.drafts.length ? (
              <ul className="list mt-2">{s.drafts.slice(0, 4).map((d) => <li key={d.id} className="py-2 t-small">{d.sourceText.slice(0, 80)}<span className="t-meta block">Missing: {d.missingFields.join(", ")}</span></li>)}</ul>
            ) : <p className="t-meta mt-2">Nothing waiting. Incomplete captures land here.</p>}
            {s.pendingAi > 0 && <p className="t-small mt-3"><span className="chip chip-mustard">{s.pendingAi}</span> capture preview{s.pendingAi === 1 ? "" : "s"} waiting for your confirmation</p>}
          </section>

          <section className="panel p-5" aria-labelledby="rc-h">
            <div className="flex justify-between items-baseline"><h2 id="rc-h" className="t-h2">Recent activity</h2><Link href="/history" className="t-small underline underline-offset-4">History</Link></div>
            {s.recent.length ? (
              <ul className="list mt-2">{s.recent.slice(0, 6).map((r) => (
                <li key={r.id} className="py-2 t-small flex justify-between gap-3"><span>{r.sensitive ? "Personal care entry" : r.summary}</span><span className="t-meta whitespace-nowrap">{r.source === "ai" ? "AI, " : ""}{fmtDateTime(r.occurredAt, tz)}</span></li>
              ))}</ul>
            ) : <p className="t-meta mt-2">Your log is empty. Try the quick actions above.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
