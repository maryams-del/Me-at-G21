import { pageOwner, routinesState } from "@/server/queries";
import { PageHeader, Empty } from "@/components/ui";
import { OpForm, OpButton, Reveal, type FieldDef } from "@/components/OpForm";
import { todayLocal, addDays } from "@/lib/time";
import { fmtDate, relDays } from "@/lib/format";

const routineFields: FieldDef[] = [
  { name: "name", label: "Name", required: true },
  { name: "anchor", label: "Count from", type: "select", required: true, options: [{ value: "completed", label: "Last time I did it" }, { value: "first_use", label: "First-use date (e.g. a new toothbrush)" }] },
  { name: "intervalValue", label: "Every", type: "int", required: true },
  { name: "intervalUnit", label: "Unit", type: "select", required: true, options: [{ value: "day", label: "days" }, { value: "week", label: "weeks" }, { value: "month", label: "calendar months" }] },
  { name: "reminderOffsetsDays", label: "Remind this many days before (0 = on the day)", type: "intlist", negative: true, help: "e.g. 1, 0" },
  { name: "reminderTime", label: "Reminder time", type: "time", required: true },
  { name: "remindersEnabled", label: "Reminders on", type: "checkbox" },
  { name: "notes", label: "Note", nullable: true, wide: true },
];

export default async function RoutinesPage() {
  const o = await pageOwner();
  const rows = await routinesState(o);
  const today = todayLocal(o.timezone);
  return (
    <>
      <PageHeader glyph="routines" title="Routines" intro="Marking something done records it in history and moves the next due date. Nothing is ever marked done for you." />
      <div className="mb-8"><Reveal label="New routine"><OpForm op="routine.create" fields={routineFields} initial={{ anchor: "completed", intervalValue: 7, intervalUnit: "day", reminderOffsetsDays: "0", reminderTime: "09:00", remindersEnabled: true, kind: "custom" }} submitLabel="Create routine" /></Reveal></div>
      {rows.length === 0 && <Empty>No routines yet.</Empty>}
      <ul className="grid gap-4 md:grid-cols-2">
        {rows.map(({ routine: r, anchor, due, daysLeft, events, lastPurchase }) => {
          const isFirstUse = r.anchor === "first_use";
          const over = daysLeft !== null && daysLeft < 0 && !r.paused;
          return (
            <li key={r.id} className="panel p-4 grid gap-3 content-start" style={over ? { boxShadow: "inset 6px 0 0 var(--rust)" } : undefined}>
              <div className="flex justify-between gap-3">
                <div>
                  <h2 className="t-h3">{r.name} {r.paused && <span className="chip chip-fill">paused</span>}</h2>
                  <p className="t-meta">Every {r.intervalValue} {r.intervalUnit === "month" ? "calendar month" : r.intervalUnit}{r.intervalValue > 1 ? "s" : ""}{isFirstUse ? " after first use" : ""}</p>
                </div>
                <div className="text-right">
                  <p className="t-h2">{due ? fmtDate(due) : "—"}</p>
                  <p className="t-small" style={{ color: over ? "var(--danger)" : "var(--ink-2)" }}>{due ? (over ? `${-daysLeft!} days overdue` : `due ${relDays(daysLeft)}`) : isFirstUse ? "Log first use to start" : "Mark done to start"}</p>
                </div>
              </div>
              {isFirstUse && <p className="t-small text-ink-2">Bought: {lastPurchase ? fmtDate(lastPurchase) : "not recorded"}. First used: {anchor ? fmtDate(anchor) : "not recorded"}.</p>}
              <div className="flex flex-wrap gap-2">
                {isFirstUse ? (
                  <>
                    <OpButton op="routine.log" input={{ routineId: r.id, type: "first_use", onDate: today }} label="Started a new one today" className="btn btn-sm btn-primary" />
                    <OpButton op="routine.log" input={{ routineId: r.id, type: "purchased", onDate: today }} label="Bought one today" className="btn btn-sm" />
                  </>
                ) : <OpButton op="routine.log" input={{ routineId: r.id, type: "completed", onDate: today }} label="Done today" className="btn btn-sm btn-primary" />}
                {due && <OpButton op="routine.snooze" input={{ routineId: r.id, until: addDays(due < today ? today : due, 1) }} label="Snooze 1 day" className="btn btn-sm" />}
                {due && <OpButton op="routine.log" input={{ routineId: r.id, type: "skipped", onDate: today }} label="Skip this time" className="btn btn-sm btn-ghost" confirmText="Skip this cycle? The next due date will count from today." />}
              </div>
              <details>
                <summary className="t-small cursor-pointer">Backdate, history and settings</summary>
                <div className="mt-3 grid gap-4">
                  <OpForm op="routine.log" fixed={{ routineId: r.id }} initial={{ onDate: today, type: isFirstUse ? "first_use" : "completed" }} submitLabel="Save entry" compact fields={[
                    { name: "type", label: "What happened", type: "select", required: true, options: isFirstUse ? [{ value: "first_use", label: "First use" }, { value: "purchased", label: "Purchased" }] : [{ value: "completed", label: "Done" }, { value: "skipped", label: "Skipped" }] },
                    { name: "onDate", label: "Date", type: "date", required: true }]} />
                  {events.length > 0 && <ul className="list">{events.map((e) => (
                    <li key={e.id} className="py-1.5 flex justify-between items-center t-small" style={{ opacity: e.voidedAt ? 0.5 : 1 }}>
                      <span style={{ textDecoration: e.voidedAt ? "line-through" : undefined }}>{fmtDate(e.onDate)}: {e.type.replace("_", " ")}</span>
                      {!e.voidedAt && <OpButton op="routine.void" input={{ eventId: e.id }} label="Remove" className="btn btn-sm btn-ghost" confirmText="Remove this entry?" />}
                    </li>))}</ul>}
                  <OpForm op="routine.update" fields={[...routineFields, { name: "paused", label: "Paused", type: "checkbox" }]} fixed={{ id: r.id, kind: r.kind }} submitLabel="Save settings"
                    initial={r} compact />
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </>
  );
}
