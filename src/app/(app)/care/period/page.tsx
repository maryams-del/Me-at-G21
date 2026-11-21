import { pageOwner, periodState } from "@/server/queries";
import { PageAddProvider, PageAddButton, PageAddPanel } from "@/components/PageAdd";
import { SpaceHeader } from "@/components/SpaceHeader";
import { PageHeader, Section, Empty } from "@/components/ui";
import { OpForm, OpButton, Reveal, type FieldDef, ItemRow } from "@/components/OpForm";
import { SYMPTOMS } from "@/server/ops/period";
import { addDays, addMonths, daysBetween, dmy, isoWeekday } from "@/lib/time";
import { fmtDate } from "@/lib/format";

const symptomField: FieldDef = { name: "symptoms", label: "Symptoms", type: "checks", options: SYMPTOMS.map((s) => ({ value: s, label: s })) };
const startFields: FieldDef[] = [
  { name: "startDate", label: "Started on", type: "date", required: true },
  { name: "startTime", label: "Time", type: "time", nullable: true },
  symptomField,
  { name: "notes", label: "Note", type: "textarea", nullable: true },
];
const endFields: FieldDef[] = [
  { name: "endDate", label: "Ended on", type: "date", required: true },
  { name: "endTime", label: "Time", type: "time", nullable: true },
];
const fullFields: FieldDef[] = [
  { name: "startDate", label: "Started on", type: "date", required: true },
  { name: "startTime", label: "Start time", type: "time", nullable: true },
  { name: "endDate", label: "Ended on", type: "date", nullable: true },
  { name: "endTime", label: "End time", type: "time", nullable: true },
  symptomField,
  { name: "notes", label: "Note", type: "textarea", nullable: true },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Month grid: logged days solid rust, estimated days outlined. Monday-first. */
function Month({ first, today, logged, estimated }: { first: string; today: string; logged: Set<string>; estimated: Set<string> }) {
  const [y, m] = first.split("-").map(Number);
  const days = daysBetween(first, addMonths(first, 1));
  const lead = isoWeekday(first) - 1;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, n) => addDays(first, n))];
  return (
    <div>
      <p className="t-small font-medium mb-2">{MONTHS[m - 1]} {y}</p>
      <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label={`${MONTHS[m - 1]} ${y}`}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, n) => <span key={n} className="t-meta">{d}</span>)}
        {cells.map((d, n) => {
          if (!d) return <span key={n} />;
          const on = logged.has(d), est = !on && estimated.has(d);
          return (
            <span key={d} role="gridcell" aria-label={`${dmy(d)}${on ? ", period" : est ? ", estimated" : ""}`}
              className="t-small aspect-square grid place-items-center"
              style={{
                background: on ? "var(--rust)" : undefined, color: on ? "var(--paper)" : d > today ? "var(--ink-3)" : undefined,
                outline: est ? "2px dashed var(--rust)" : d === today ? "2px solid var(--ink)" : undefined, outlineOffset: -2,
                borderRadius: on || est ? "50%" : undefined,
              }}>{Number(d.slice(8))}</span>
          );
        })}
      </div>
    </div>
  );
}

export default async function PeriodPage() {
  const o = await pageOwner();
  const s = await periodState(o, { withDetails: true });
  const { today, open, estimate, settings } = s;

  const logged = new Set<string>();
  for (const c of s.cycles) { const end = c.endDate ?? today; for (let d = c.startDate; d <= end; d = addDays(d, 1)) logged.add(d); }
  const estimated = new Set<string>();
  if (estimate && settings.showEstimate && !open) for (let n = 0; n < (estimate.avgLength ?? 5); n++) estimated.add(addDays(estimate.nextStart, n));
  const thisMonth = today.slice(0, 8) + "01";
  const months = [addMonths(thisMonth, -2), addMonths(thisMonth, -1), thisMonth, ...(estimate && settings.showEstimate && estimate.nextStart >= addMonths(thisMonth, 1) ? [addMonths(thisMonth, 1)] : [])];

  return (
    <>
      <PageAddProvider>
      <SpaceHeader href="/care/period"><PageAddButton label="Add a past period" /></SpaceHeader>
      <PageAddPanel title="Add a past period">
        <OpForm op="period.add" fields={fullFields.map((f) => f.name === "endDate" ? { ...f, required: true, nullable: false } : f)} submitLabel="Add period" compact />
      </PageAddPanel>
      </PageAddProvider>

      <div className="grid gap-4 md:grid-cols-[1.1fr_1fr] mb-9">
        <div className="panel p-5 grid gap-4 content-start" style={{ boxShadow: open ? "inset 8px 0 0 var(--rust)" : undefined }}>
          {open ? (
            <>
              <div>
                <p className="t-small text-ink-2">Current period</p>
                <p className="t-num text-[2rem] md:text-[2.6rem] leading-tight">Day {s.openDay}</p>
                <p className="t-small text-ink-2">Started {fmtDate(open.startDate)}{open.startTime ? ` at ${open.startTime}` : ""}</p>
              </div>
              <OpButton op="period.end" input={{ endDate: today }} label="Period ended today" className="btn btn-primary justify-self-start" />
              <Reveal label="Ended on another day">
                <OpForm op="period.end" fields={endFields} initial={{ endDate: today }} submitLabel="Save end date" compact />
              </Reveal>
            </>
          ) : (
            <>
              <div>
                <p className="t-small text-ink-2">No period in progress</p>
                {s.cycles[0] && <p className="t-small mt-1">Last started {fmtDate(s.cycles[0].startDate)} ({daysBetween(s.cycles[0].startDate, today)} days ago)</p>}
              </div>
              <OpButton op="period.start" input={{ startDate: today }} label="Period started today" className="btn btn-primary justify-self-start" />
              <Reveal label="Started on another day, or add time and symptoms">
                <OpForm op="period.start" fields={startFields} initial={{ startDate: today }} submitLabel="Save start" compact />
              </Reveal>
            </>
          )}
        </div>

        <div className="panel p-5 grid gap-2 content-start">
          <p className="t-small text-ink-2">Estimate</p>
          {!settings.showEstimate ? <p className="t-small">Estimates are turned off.</p>
            : estimate ? (
              <>
                <p className="t-h2">{open ? "After this one" : fmtDate(estimate.nextStart)}</p>
                <p className="t-small">Average cycle {estimate.avgCycle} days{estimate.avgLength ? `, average length ${estimate.avgLength} days` : ""}, from your last {estimate.basedOn + 1} logged starts.{!open && s.daysToEstimate !== null ? (s.daysToEstimate >= 0 ? ` About ${s.daysToEstimate} days from now.` : ` ${-s.daysToEstimate} days past the estimate.`) : ""}</p>
                <p className="t-meta">An estimate from your own log, not a medical prediction. Cycles vary.</p>
              </>
            ) : <p className="t-small">Log at least three period starts to see an estimate.</p>}
        </div>
      </div>

      <Section title="Calendar">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {months.map((m) => <Month key={m} first={m} today={today} logged={logged} estimated={estimated} />)}
        </div>
        <p className="t-meta mt-3"><span className="inline-block w-3 h-3 rounded-full align-middle mr-1" style={{ background: "var(--rust)" }} /> logged
          {settings.showEstimate && <> <span className="inline-block w-3 h-3 rounded-full align-middle ml-3 mr-1" style={{ outline: "2px dashed var(--rust)", outlineOffset: -2 }} /> estimated</>}</p>
      </Section>

      <Section title="History">
        {s.cycles.length === 0 ? <Empty>Nothing logged yet. Use “Period started” above, or tap + to add past periods.</Empty> : (
          <ul className="list">
            {s.cycles.map((c) => (
              <li key={c.id} className="py-3 grid gap-2">
                <ItemRow name="this entry"
                  head={<span className="t-small font-medium">{fmtDate(c.startDate)} → {c.endDate ? fmtDate(c.endDate) : "ongoing"}</span>}
                  aside={<span className="t-small text-ink-2">{c.length ? `${c.length} days` : ""}{c.cycleLength ? `${c.length ? ", " : ""}cycle ${c.cycleLength} days` : ""}</span>}
                  edit={<OpForm op="period.update" fields={fullFields} fixed={{ id: c.id }} initial={{ ...c }} submitLabel="Save correction" compact
                      deleteAction={{ op: "period.delete", input: { id: c.id }, confirm: "Delete this period entry?", label: "Delete entry" }} />}>
                  {(c.symptoms.length > 0 || c.notes) && <p className="t-small text-ink-2">{[c.symptoms.join(", "), c.notes].filter(Boolean).join(". ")}</p>}
                </ItemRow>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Privacy">
        <OpForm op="period.settings" initial={settings} submitLabel="Save privacy settings" compact fields={[
          { name: "showOnDashboard", label: "Show period status on the Today page", type: "checkbox", wide: true },
          { name: "showEstimate", label: "Show estimates on this page", type: "checkbox", wide: true },
        ]} />
      </Section>
    </>
  );
}
