import { dmy } from "@/lib/time";
import { pageOwner, fastsState } from "@/server/queries";
import { PageHeader, Section, Empty } from "@/components/ui";
import { OpForm, OpButton, Reveal } from "@/components/OpForm";
import { todayLocal, toHijri, HIJRI_MONTHS, formatHijri, ruleDateSafe } from "./helpers";
import { fmtDate } from "@/lib/format";

const TYPE_LABEL: Record<string, string> = { initial: "Opening balance", annual_addition: "Annual addition", adjustment: "Adjustment", completed: "Fast completed" };

export default async function FastsPage() {
  const o = await pageOwner();
  const s = await fastsState(o);
  const today = todayLocal(o.timezone);
  const hy = toHijri(today).year;
  return (
    <>
      <PageHeader glyph="fasts" title="Make-up fasts">
        <OpButton op="fasts.complete" input={{ onDate: today }} label="Fast completed today" className="btn btn-primary" confirmText={`Record one fast completed today (${dmy(today)})?`} />
      </PageHeader>

      <div className="money-tiles mb-8">
        <div className="tile mustard min-h-0"><p className="t-small">Remaining</p><p className="t-num text-[3rem] mt-1">{s.balance}</p></div>
        <div className="tile min-h-0">
          <p className="t-small text-ink-2">Completed by year</p>
          {s.byYear.length ? <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{s.byYear.map(([y, n]) => <li key={y}><span className="t-num text-2xl">{n}</span> <span className="t-small text-ink-2">in {y}</span></li>)}</ul> : <p className="t-small mt-2 text-ink-2">None yet.</p>}
        </div>
      </div>

      {!s.hasInitial && (
        <div className="mb-8 panel p-4" style={{ background: "var(--tint-mustard)" }}>
          <h2 className="t-h3 mb-1">Set your opening balance</h2>
          <OpForm op="fasts.initial" initial={{ asOf: today }} submitLabel="Save opening balance" fields={[
            { name: "count", label: "Fasts owed", type: "int", required: true }, { name: "asOf", label: "As of", type: "date", required: true }, { name: "notes", label: "Note", nullable: true, wide: true }]} />
        </div>
      )}

      <div className="mb-8 flex flex-wrap gap-3 items-start">
        <Reveal label="Log a past fast">
          <OpForm op="fasts.complete" initial={{ onDate: today }} submitLabel="Save fast" fields={[
            { name: "onDate", label: "Date fasted", type: "date", required: true },
            { name: "historicalCorrection", label: "Historical correction (allow duplicate date or zero balance)", type: "checkbox", wide: true },
            { name: "notes", label: "Note", nullable: true, wide: true }]} />
        </Reveal>
        <Reveal label="Manual adjustment">
          <OpForm op="fasts.adjust" initial={{ onDate: today }} submitLabel="Save adjustment" fields={[
            { name: "delta", label: "Change (+ adds, − removes)", type: "int", required: true }, { name: "onDate", label: "Date", type: "date", required: true },
            { name: "reason", label: "Reason (required)", required: true, wide: true },
            { name: "overrideNegative", label: "I understand this may make the balance negative", type: "checkbox", wide: true }]} />
        </Reveal>
      </div>

      <Section title="Annual addition rule">
        <div className="panel p-4 grid gap-4">
          <p className="t-small text-ink-2 prose-w">Optional. If you add a fixed number every year (for example after Ramadan), set it here and it&apos;s added once per year, never twice. Hijri dates use the Umm al-Qura calendar; the actual start of a month can differ by a day with moon sighting.</p>
          {s.rules.map((r) => (
            <div key={r.id} className="grid gap-2">
              <p className="t-small"><strong>+{r.amount}</strong> each year on {r.calendar === "hijri" ? `${r.day} ${HIJRI_MONTHS[r.month - 1]} (Hijri)` : `${r.day}/${r.month} (Gregorian)`} from {r.startYear}. {r.active ? "" : "Paused."} Next: {ruleDateSafe(r, r.calendar === "hijri" ? hy : Number(today.slice(0, 4)), today)}</p>
              <Reveal label="Edit rule" buttonClass="btn btn-sm">
                <RuleForm initial={r} />
              </Reveal>
            </div>
          ))}
          {!s.rules.length && <Reveal label="Add a rule" buttonClass="btn btn-sm"><RuleForm initial={{ calendar: "hijri", month: 10, day: 1, startYear: hy, active: true }} /></Reveal>}
        </div>
      </Section>

      <Section title="Ledger">
        {s.ledger.length ? (
          <ul className="list panel px-4">
            {s.ledger.map((e) => (
              <li key={e.id} className="py-2.5 grid grid-cols-[1fr_auto_auto] items-center gap-3 t-small" style={{ opacity: e.voidedAt ? 0.5 : 1 }}>
                <span style={{ textDecoration: e.voidedAt ? "line-through" : undefined }}>
                  <span className="font-medium">{TYPE_LABEL[e.type]}</span> {fmtDate(e.onDate)} <span className="text-ink-3">({formatHijri(e.onDate)})</span>
                  {e.reason && <span className="block text-ink-2">{e.reason}</span>}
                </span>
                <span className="t-num text-lg">{e.delta > 0 ? `+${e.delta}` : e.delta}</span>
                {!e.voidedAt && e.type !== "annual_addition" ? <OpButton op="fasts.void" input={{ eventId: e.id }} label="Remove" className="btn btn-sm btn-ghost" confirmText="Remove this ledger entry? The balance will be recalculated." /> : <span />}
              </li>
            ))}
          </ul>
        ) : <Empty>No entries yet.</Empty>}
      </Section>
    </>
  );
}

function RuleForm({ initial }: { initial: Record<string, unknown> }) {
  return (
    <OpForm op="fasts.rule.save" initial={initial} fixed={initial.id ? { id: initial.id } : {}} submitLabel="Save rule" fields={[
      { name: "amount", label: "Fasts to add each year", type: "int", required: true },
      { name: "calendar", label: "Calendar", type: "select", required: true, options: [{ value: "hijri", label: "Hijri (Umm al-Qura)" }, { value: "gregorian", label: "Gregorian" }] },
      { name: "month", label: "Month (1–12)", type: "int", required: true, help: "Hijri 10 = Shawwal" },
      { name: "day", label: "Day", type: "int", required: true },
      { name: "startYear", label: "First year (in that calendar)", type: "int", required: true },
      { name: "active", label: "Active", type: "checkbox" },
    ]} />
  );
}
