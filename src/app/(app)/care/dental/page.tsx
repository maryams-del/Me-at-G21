import { pageOwner, dentalState, remindersFor } from "@/server/queries";
import { PageHeader, Section, Empty, ReminderList } from "@/components/ui";
import { OpForm, OpButton, Reveal } from "@/components/OpForm";
import { fmtDate, relDays } from "@/lib/format";

export default async function DentalPage() {
  const o = await pageOwner();
  const s = await dentalState(o);
  const rem = await remindersFor(o.id, "dental", [s.activity.id]);
  return (
    <>
      <PageHeader glyph="dental" title="Dental scaling" intro={`Your chosen cadence: every ${s.rule.intervalMonths} calendar months from the date of your last visit. This is your schedule, not general medical advice.`} />
      {s.last ? (
        <div className="grid gap-3 sm:grid-cols-2 mb-8">
          <div className={`tile ${s.daysLeft !== null && s.daysLeft < 0 ? "rust" : "slate"} min-h-0`}><p className="t-small">Next due</p><p className="t-num text-[2.6rem] mt-2">{fmtDate(s.due)}</p><p className="t-small mt-1">{relDays(s.daysLeft)}</p></div>
          <div className="tile min-h-0"><p className="t-small text-ink-2">Last visit</p><p className="t-h2 mt-2">{fmtDate(s.last.completedOn)}</p>{s.last.detail && <p className="t-small text-ink-2">{s.last.detail}</p>}</div>
        </div>
      ) : <div className="mb-8"><Empty>Log your most recent scaling to calculate the next due date.</Empty></div>}

      <div className="mb-8">
        <Reveal label="Log a visit" buttonClass="btn btn-primary">
          <OpForm op="dental.complete" initial={{ completedOn: s.today }} submitLabel="Save visit" fields={[
            { name: "completedOn", label: "Date", type: "date", required: true }, { name: "detail", label: "Clinic", nullable: true }, { name: "notes", label: "Note", nullable: true }]} />
        </Reveal>
      </div>
      <div className="grid gap-8 md:grid-cols-2">
        <Section title="Upcoming reminders"><ReminderList items={rem} tz={o.timezone} /></Section>
        <Section title="History">
          {s.events.length ? <ul className="list">{s.events.map((e) => (
            <li key={e.id} className="py-2 flex justify-between items-center gap-3 t-small" style={{ opacity: e.voidedAt ? 0.5 : 1 }}>
              <span style={{ textDecoration: e.voidedAt ? "line-through" : undefined }}>{fmtDate(e.completedOn)}{e.detail ? `, ${e.detail}` : ""}</span>
              {!e.voidedAt && <OpButton op="maintenance.void" input={{ eventId: e.id, reason: "Removed by owner" }} label="Remove" className="btn btn-sm btn-ghost" confirmText="Remove this visit? The due date will be recalculated." />}
            </li>))}</ul> : <p className="t-meta">Nothing logged.</p>}
        </Section>
      </div>
      <Section title="Reminder settings">
        <div className="panel p-4">
          <OpForm op="maintenance.settings" fixed={{ kind: "dental" }} submitLabel="Save settings"
            initial={{ reminderOffsetsDays: s.rule.reminderOffsetsDays, intervalMonths: s.rule.intervalMonths, reminderTime: s.activity.reminderTime, remindersEnabled: s.activity.remindersEnabled }}
            fields={[
              { name: "reminderOffsetsDays", label: "Remind this many days before (0 = on the day)", type: "intlist", negative: true, required: true, help: "Default 14, 1, 0" },
              { name: "intervalMonths", label: "Every N calendar months", type: "int", required: true },
              { name: "reminderTime", label: "Time", type: "time", required: true },
              { name: "remindersEnabled", label: "Reminders on", type: "checkbox" },
            ]} />
        </div>
      </Section>
    </>
  );
}
