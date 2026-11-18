import { pageOwner, waxingState, remindersFor } from "@/server/queries";
import { PageHeader, Section, Empty, ReminderList } from "@/components/ui";
import { OpForm, OpButton, Reveal } from "@/components/OpForm";
import { fmtDate } from "@/lib/format";

export default async function WaxingPage() {
  const o = await pageOwner();
  const s = await waxingState(o);
  const rem = await remindersFor(o.id, "waxing", [s.activity.id]);
  const W = s.rule.windowDays;
  return (
    <>
      <PageHeader glyph="waxing" title="Waxing" intro={`Your personal goal: next session around day ${s.rule.recommendedDay}, and within ${W} days of the last one. Each new session restarts the count from the date it actually happened.`}>
        <OpButton op="waxing.complete" input={{ completedOn: s.today }} label="Done today" className="btn btn-primary" confirmText={`Log waxing completed today (${s.today})?`} />
      </PageHeader>

      {s.last ? (
        <div className="grid gap-3 sm:grid-cols-4 mb-8">
          <div className={`tile ${s.overdue ? "rust" : "mustard"} sm:col-span-2 min-h-0`}>
            <p className="t-small">{s.overdue ? "Overdue" : "Current cycle"}</p>
            <p className="t-num text-[3.2rem] mt-2">Day {s.day} <span className="text-[1.4rem]">of {W}</span></p>
            <div className="mt-3 grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${W}, 1fr)` }} aria-hidden>
              {Array.from({ length: W }, (_, i) => (
                <span key={i} style={{ height: 14, background: i < (s.day ?? 0) ? "var(--ink)" : "transparent", border: "1px solid var(--ink)", opacity: s.rule.reminderDays.includes(i + 1) ? 1 : 0.55 }} />
              ))}
            </div>
          </div>
          <div className="tile min-h-0"><p className="t-small text-ink-2">Last session</p><p className="t-h2 mt-2">{fmtDate(s.last.completedOn)}</p></div>
          <div className="tile min-h-0"><p className="t-small text-ink-2">Recommended (day {s.rule.recommendedDay})</p><p className="t-h2 mt-2">{fmtDate(s.recommended)}</p><p className="t-small text-ink-2 mt-1">Latest: {fmtDate(s.latest)}</p></div>
        </div>
      ) : <div className="mb-8"><Empty>No session logged yet. Log your most recent one to start the {W}-day count.</Empty></div>}

      <div className="mb-8">
        <Reveal label="Log a past date">
          <OpForm op="waxing.complete" initial={{ completedOn: s.today }} submitLabel="Save session" fields={[
            { name: "completedOn", label: "Date it was done", type: "date", required: true },
            { name: "detail", label: "Area", nullable: true }, { name: "notes", label: "Note", nullable: true }]} />
        </Reveal>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <Section title="Upcoming reminders"><ReminderList items={rem} tz={o.timezone} /></Section>
        <Section title="History">
          {s.events.length ? (
            <ul className="list">{s.events.map((e) => (
              <li key={e.id} className="py-2 flex justify-between items-center gap-3 t-small" style={{ opacity: e.voidedAt ? 0.5 : 1 }}>
                <span style={{ textDecoration: e.voidedAt ? "line-through" : undefined }}>{fmtDate(e.completedOn)}{e.detail ? `, ${e.detail}` : ""}{e.voidReason ? ` (removed: ${e.voidReason})` : ""}</span>
                {!e.voidedAt && <OpButton op="maintenance.void" input={{ eventId: e.id, reason: "Removed by owner" }} label="Remove" className="btn btn-sm btn-ghost" confirmText="Remove this entry? Reminders will be recalculated from the previous session." />}
              </li>))}</ul>
          ) : <p className="t-meta">Nothing logged.</p>}
        </Section>
      </div>

      <Section title="Reminder settings">
        <div className="panel p-4">
          <OpForm op="maintenance.settings" fixed={{ kind: "waxing" }} submitLabel="Save settings"
            initial={{ reminderDays: s.rule.reminderDays, reminderTime: s.activity.reminderTime, remindersEnabled: s.activity.remindersEnabled }}
            fields={[
              { name: "reminderDays", label: "Remind on these days after a session", type: "intlist", required: true, help: "Default 27, 30, 35, 38, 40" },
              { name: "reminderTime", label: "Time", type: "time", required: true },
              { name: "remindersEnabled", label: "Reminders on", type: "checkbox" },
            ]} />
          <p className="t-meta mt-3">Lock-screen notifications for waxing say only “Personal reminder” unless you allow detailed previews in notification settings.</p>
        </div>
      </Section>
    </>
  );
}
