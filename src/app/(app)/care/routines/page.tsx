import { pageOwner, routinesState } from "@/server/queries";
import { PageHeader, Empty, Section } from "@/components/ui";
import { OpForm, OpButton, Reveal, EditPanel, type FieldDef } from "@/components/OpForm";
import { ROUTINE_TEMPLATES, type TemplateKey } from "@/server/ops/care";
import { todayLocal, addDays, dmy } from "@/lib/time";
import { fmtDate, relDays } from "@/lib/format";

const routineFields: FieldDef[] = [
  { name: "name", label: "Name", required: true, placeholder: "Haircut" },
  { name: "anchor", label: "Count from", type: "select", required: true, options: [{ value: "completed", label: "The last time I did it" }, { value: "first_use", label: "The day I started using a new one (e.g. a toothbrush)" }] },
  { name: "intervalValue", label: "Every", type: "int", required: true },
  { name: "intervalUnit", label: "Unit", type: "select", required: true, options: [{ value: "day", label: "days" }, { value: "week", label: "weeks" }, { value: "month", label: "calendar months" }] },
  { name: "graceDays", label: "Must be done within this many days after it's due", type: "int", nullable: true, help: "Optional. Waxing: due day 30, latest day 40 → 10." },
  { name: "beforeDays", sendAs: "reminderOffsetsDays", label: "Remind me this many days before it's due", type: "intlist", negative: true, includeZero: true, help: "e.g. 3, 1. You're always reminded on the due day." },
  { name: "afterDays", sendAs: "reminderOffsetsDays", label: "Then nudge me this many days after the due day", type: "intlist", help: "Optional, e.g. 5, 8, 10" },
  { name: "reminderTime", label: "Reminder time", type: "time", required: true },
  { name: "remindersEnabled", label: "Reminders on", type: "checkbox" },
  { name: "sensitive", label: "Private: lock-screen notifications just say “Personal reminder”", type: "checkbox", wide: true },
  { name: "notes", label: "Note", nullable: true, wide: true },
];
const splitOffsets = (xs: number[]) => ({ beforeDays: xs.filter((x) => x < 0).map((x) => -x), afterDays: xs.filter((x) => x > 0) });
const schedule = (r: { intervalValue: number; intervalUnit: string; anchor: string; graceDays: number | null }) =>
  `Every ${r.intervalValue} ${r.intervalUnit === "month" ? "calendar month" : r.intervalUnit}${r.intervalValue > 1 ? "s" : ""}${r.anchor === "first_use" ? " after first use" : ""}${r.graceDays ? `, at the latest ${r.graceDays} days later` : ""}`;

export default async function RoutinesPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const rows = await routinesState(o);
  const today = todayLocal(o.timezone);
  const have = new Set(rows.map((r) => r.routine.kind));
  // Waxing isn't offered as a quick-add; it's still available via a custom routine or Capture ("I waxed today").
  const templates = (Object.keys(ROUTINE_TEMPLATES) as TemplateKey[]).filter((k) => k !== "waxing" && !have.has(k));

  return (
    <>
      <PageHeader glyph="routines" title="Routines" />

      <div className="mb-8 grid gap-4">
        {templates.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="t-small text-ink-2 mr-1">Quick add:</span>
            {templates.map((k) => <OpButton key={k} op="routine.template" input={{ template: k }} label={`+ ${ROUTINE_TEMPLATES[k].name}`} className="btn btn-sm" />)}
          </div>
        )}
        <Reveal label="New custom routine" open={sp.add === "1"}>
          <OpForm op="routine.create" fields={routineFields} fixed={{ kind: "custom" }} initial={{ anchor: "completed", intervalValue: 7, intervalUnit: "day", reminderTime: "09:00", remindersEnabled: true, beforeDays: [1] }} submitLabel="Create routine" />
        </Reveal>
      </div>

      {rows.length === 0 && <Empty>No routines yet. Use quick add above, or create your own.</Empty>}

      <ul className="grid gap-4 md:grid-cols-2">
        {rows.map(({ routine: r, anchor, due, latest, daysSince, cycleDays, daysLeft, overdue, events }) => {
          const isFirstUse = r.anchor === "first_use";
          const pct = r.graceDays && cycleDays && daysSince !== null ? Math.min(100, (daysSince / cycleDays) * 100) : null;
          const dueMark = r.graceDays && cycleDays ? ((cycleDays - r.graceDays) / cycleDays) * 100 : null;
          return (
            <li key={r.id} className="panel p-4 grid gap-3 content-start" style={overdue ? { boxShadow: "inset 6px 0 0 var(--rust)" } : undefined}>
              <div className="flex justify-between gap-3">
                <div>
                  <h2 className="t-h3">{r.name} {r.paused && <span className="chip chip-fill">paused</span>} {r.sensitive && <span className="chip chip-fill">private</span>}</h2>
                  <p className="t-meta">{schedule(r)}</p>
                </div>
                <div className="text-right">
                  {r.graceDays && daysSince !== null ? (
                    <><p className="t-h2">Day {daysSince}</p><p className="t-small" style={{ color: overdue ? "var(--danger)" : "var(--ink-2)" }}>of {cycleDays}{overdue ? ", past the limit" : ""}</p></>
                  ) : (
                    <><p className="t-h2">{due ? fmtDate(due) : "—"}</p>
                      <p className="t-small" style={{ color: overdue ? "var(--danger)" : "var(--ink-2)" }}>{due ? (overdue ? `${-(daysLeft ?? 0)} days overdue` : `due ${relDays(daysLeft)}`) : isFirstUse ? "Log first use to start" : "Mark done to start"}</p></>
                  )}
                </div>
              </div>
              {pct !== null && (
                <div className="grid gap-1">
                  <div className="bar relative" aria-hidden><i style={{ width: `${pct}%`, background: overdue ? "var(--rust)" : "var(--ink)" }} />
                    {dueMark !== null && <span className="absolute top-0 bottom-0" style={{ left: `${dueMark}%`, width: 2, background: "var(--mustard)" }} />}
                  </div>
                  <p className="t-meta">Last {fmtDate(anchor)}. Recommended {fmtDate(due)}, latest {fmtDate(latest)}.</p>
                </div>
              )}
              {isFirstUse && <p className="t-small text-ink-2">Started: {anchor ? fmtDate(anchor) : "not recorded"}</p>}
              <div className="flex flex-wrap gap-2">
                {isFirstUse ? (
                  <>
                    <OpButton op="routine.log" input={{ routineId: r.id, type: "first_use", onDate: today }} label="Started a new one today" className="btn btn-sm btn-primary" />
                  </>
                ) : <OpButton op="routine.log" input={{ routineId: r.id, type: "completed", onDate: today }} label="Done today" className="btn btn-sm btn-primary" confirmText={r.graceDays ? `Log ${r.name.toLowerCase()} done today (${dmy(today)})? The next one is counted from today.` : undefined} />}
                {due && <OpButton op="routine.snooze" input={{ routineId: r.id, until: addDays(due < today ? today : due, 1) }} label="Snooze 1 day" className="btn btn-sm" />}
                {due && <OpButton op="routine.log" input={{ routineId: r.id, type: "skipped", onDate: today }} label="Skip this time" className="btn btn-sm btn-ghost" confirmText="Skip this cycle? The next due date will count from today." />}
              </div>
              <EditPanel label="Log a past date, history and settings">
                <div className="grid gap-4">
                  <OpForm op="routine.log" fixed={{ routineId: r.id }} initial={{ onDate: today, type: isFirstUse ? "first_use" : "completed" }} submitLabel="Save entry" compact fields={[
                    { name: "type", label: "What happened", type: "select", required: true, options: isFirstUse ? [{ value: "first_use", label: "Started a new one" }] : [{ value: "completed", label: "Done" }, { value: "skipped", label: "Skipped" }] },
                    { name: "onDate", label: "Date", type: "date", required: true }, { name: "notes", label: "Note", nullable: true, wide: true }]} />
                  {events.length > 0 && <ul className="list">{events.map((e) => (
                    <li key={e.id} className="py-1.5 flex justify-between items-center t-small" style={{ opacity: e.voidedAt ? 0.5 : 1 }}>
                      <span style={{ textDecoration: e.voidedAt ? "line-through" : undefined }}>{fmtDate(e.onDate)}: {e.type.replace("_", " ")}{e.notes ? `, ${e.notes}` : ""}</span>
                      {!e.voidedAt && <OpButton op="routine.void" input={{ eventId: e.id }} label="Remove" className="btn btn-sm btn-ghost" confirmText="Remove this entry? The schedule will be recalculated." />}
                    </li>))}</ul>}
                  <Section title="Settings">
                    <OpForm op="routine.update" fields={[...routineFields, { name: "paused", label: "Paused", type: "checkbox" }]} fixed={{ id: r.id, kind: r.kind }} initial={{ ...r, ...splitOffsets(r.reminderOffsetsDays) }} submitLabel="Save settings" compact />
                  </Section>
                  <OpButton op="routine.delete" input={{ id: r.id }} label="Delete routine" className="btn btn-sm btn-ghost justify-self-start" confirmText={`Delete “${r.name}” and its history?`} />
                </div>
              </EditPanel>
            </li>
          );
        })}
      </ul>
    </>
  );
}
