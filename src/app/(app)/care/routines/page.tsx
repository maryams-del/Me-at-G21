import { pageOwner, routinesState } from "@/server/queries";
import { PageHeader, Empty } from "@/components/ui";
import { OpForm, OpButton, Reveal, type FieldDef } from "@/components/OpForm";
import { EntryCard } from "@/components/EntryCard";
import { countdown, relativeReminderLine } from "@/lib/countdown";
import { ROUTINE_TEMPLATES, type TemplateKey } from "@/server/ops/care";
import { todayLocal } from "@/lib/time";
import { fmtDate } from "@/lib/format";

const routineFields: FieldDef[] = [
  { name: "name", label: "Name", required: true, placeholder: "Haircut" },
  { name: "anchor", label: "Count from", type: "select", required: true, options: [{ value: "completed", label: "The last time I did it" }, { value: "first_use", label: "The day I started using a new one (e.g. a toothbrush)" }] },
  { name: "intervalValue", label: "Every", type: "int", required: true },
  { name: "intervalUnit", label: "Unit", type: "select", required: true, options: [{ value: "day", label: "days" }, { value: "week", label: "weeks" }, { value: "month", label: "calendar months" }] },
  { name: "beforeDays", sendAs: "reminderOffsetsDays", label: "Remind me this many days before it's due", type: "intlist", negative: true, includeZero: true, presets: [14, 7, 3, 1], maxDays: 120, maxCount: 10 },
  { name: "reminderTime", label: "Reminder time", type: "time", required: true },
  { name: "remindersEnabled", label: "Reminders on", type: "checkbox" },
  { name: "sensitive", label: "Private: lock-screen notifications just say “Personal reminder”", type: "checkbox", wide: true },
  { name: "notes", label: "Note", nullable: true, wide: true },
];
const splitOffsets = (xs: number[]) => ({ beforeDays: xs.filter((x) => x < 0).map((x) => -x) });
const schedule = (r: { intervalValue: number; intervalUnit: string; anchor: string }) =>
  `Every ${r.intervalValue} ${r.intervalUnit === "month" ? "calendar month" : r.intervalUnit}${r.intervalValue > 1 ? "s" : ""}${r.anchor === "first_use" ? " after starting a new one" : ""}`;

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

      <ul className="entry-grid">
        {rows.map(({ routine: r, anchor, due, daysSince, daysLeft, overdue, skipped, events }) => {
          const isFirstUse = r.anchor === "first_use";
          const count = due ? countdown(daysLeft ?? null, "due")
            : skipped && daysSince !== null ? { n: String(daysSince), unit: `day${daysSince === 1 ? "" : "s"} since the last one`, tone: "calm" as const } : null;
          const last = !isFirstUse && anchor ? `Last done ${fmtDate(anchor)}${daysSince !== null ? ` (${daysSince} day${daysSince === 1 ? "" : "s"} ago)` : ""}`
            : isFirstUse ? `Started ${anchor ? `${fmtDate(anchor)}${daysSince !== null ? ` (${daysSince} day${daysSince === 1 ? "" : "s"} ago)` : ""}` : "not recorded"}` : null;
          return (
            <EntryCard key={r.id} icon="repeat" countLabel="Due" title={r.name} badge={r.sensitive ? <span className="chip chip-fill">private</span> : undefined}
              subtitle={schedule(r)} count={count}
              countSub={due ? fmtDate(due) : skipped ? "Skipped, still counting" : undefined}
              reminder={relativeReminderLine({ enabled: r.remindersEnabled, offsets: r.reminderOffsetsDays, time: r.reminderTime })}
              action={isFirstUse
                ? <OpButton op="routine.log" input={{ routineId: r.id, type: "first_use", onDate: today }} label="New one today" icon="renew" className="pill-action" />
                : <OpButton op="routine.log" input={{ routineId: r.id, type: "completed", onDate: today }} label="Done" icon="check" className="pill-action" />}
              edit={
                <div className="grid gap-4">
                  <div className="flex flex-wrap gap-2">
                    <Reveal label="Another date" icon="calendar" buttonClass="pill-action">
                      <OpForm op="routine.log" fixed={{ routineId: r.id, type: isFirstUse ? "first_use" : "completed" }} initial={{ onDate: today }} submitLabel="Save entry" compact fields={[
                        { name: "onDate", label: isFirstUse ? "Started a new one on" : "Done on", type: "date", required: true }, { name: "notes", label: "Note", nullable: true }]} />
                    </Reveal>
                    {r.kind !== "waxing" && (isFirstUse ? overdue : !!due) && <OpButton op="routine.log" input={{ routineId: r.id, type: "skipped", onDate: today }} label="Skip this time" icon="skip" className="pill-action"
                      confirmText={isFirstUse ? "Skip this time? It keeps counting days since the last new one and stops reminding you. Log a new one when you change it." : "Skip this cycle? The next due date will count from today."} />}
                  </div>
                  {events.length > 0 && (
                    <div className="grid gap-1">
                      <h3 className="t-label">History</h3>
                      <ul className="list">{events.map((e) => (
                        <li key={e.id} className="py-1.5 flex justify-between items-center t-small" style={{ opacity: e.voidedAt ? 0.5 : 1 }}>
                          <span style={{ textDecoration: e.voidedAt ? "line-through" : undefined }}>{fmtDate(e.onDate)}: {e.type === "first_use" ? "started a new one" : e.type}{e.notes ? `, ${e.notes}` : ""}</span>
                          {!e.voidedAt && <OpButton op="routine.void" input={{ eventId: e.id }} label="Remove" className="btn btn-sm btn-ghost" confirmText="Remove this entry? The schedule will be recalculated." />}
                        </li>))}</ul>
                    </div>
                  )}
                  <OpForm op="routine.update" fields={routineFields} fixed={{ id: r.id, kind: r.kind }} initial={{ ...r, ...splitOffsets(r.reminderOffsetsDays) }} submitLabel="Save changes" compact
                    deleteAction={{ op: "routine.delete", input: { id: r.id }, confirm: `Delete “${r.name}” and its history?` }} />
                </div>
              }>
              {last && <p className="t-small text-ink-2">{last}</p>}
            </EntryCard>
          );
        })}
      </ul>
    </>
  );
}
