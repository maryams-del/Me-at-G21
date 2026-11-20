import { dmy } from "@/lib/time";
import { pageOwner, fastsState } from "@/server/queries";
import { PageHeader, Section, Empty } from "@/components/ui";
import { OpForm, OpButton, Reveal } from "@/components/OpForm";
import { todayLocal } from "./helpers";
import { fmtDate } from "@/lib/format";

const TYPE_LABEL: Record<string, string> = { initial: "Opening balance", annual_addition: "Annual addition", adjustment: "Adjustment", completed: "Fast completed" };

export default async function FastsPage() {
  const o = await pageOwner();
  const s = await fastsState(o);
  const today = todayLocal(o.timezone);
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
            { name: "notes", label: "Note", nullable: true, wide: true }]} />
        </Reveal>
        <Reveal label="Manual adjustment">
          <OpForm op="fasts.adjust" initial={{ onDate: today }} submitLabel="Save adjustment" fields={[
            { name: "delta", label: "Change (+ adds, − removes)", type: "int", required: true }, { name: "onDate", label: "Date", type: "date", required: true },
            { name: "reason", label: "Reason (required)", required: true, wide: true }]} />
        </Reveal>
      </div>

      <Section title="Ledger">
        {s.ledger.length ? (
          <ul className="list panel px-4">
            {s.ledger.map((e) => (
              <li key={e.id} className="py-2.5 grid grid-cols-[1fr_auto_auto] items-center gap-3 t-small" style={{ opacity: e.voidedAt ? 0.5 : 1 }}>
                <span style={{ textDecoration: e.voidedAt ? "line-through" : undefined }}>
                  <span className="font-medium">{TYPE_LABEL[e.type]}</span> {fmtDate(e.onDate)}
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
