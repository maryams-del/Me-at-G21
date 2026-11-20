import { pageOwner, zakatState } from "@/server/queries";
import { PageHeader, Section, Empty } from "@/components/ui";
import { OpForm, OpButton, Reveal, type FieldDef, EditPanel } from "@/components/OpForm";
import { CURRENCIES, formatMoney, fromMinor } from "@/lib/money";
import { todayLocal } from "@/lib/time";
import { fmtDate } from "@/lib/format";
import { nextHawl } from "@/server/ops/zakat";
import { ZakatCalculator } from "./ZakatCalculator";

export default async function ZakatPage() {
  const o = await pageOwner();
  const s = await zakatState(o);
  const today = todayLocal(o.timezone);
  const payFields: FieldDef[] = [
    { name: "paidOn", label: "Paid on", type: "date", required: true },
    { name: "recipient", label: "Paid to", required: true },
    { name: "amount", label: "Amount", type: "amount", required: true },
    { name: "currency", label: "Currency", type: "select", required: true, options: [o.defaultCurrency, ...CURRENCIES.filter((c) => c !== o.defaultCurrency)].map((c) => ({ value: c, label: c })) },
    { name: "calculationId", label: "For estimate", type: "select", nullable: true, options: s.calcs.map(({ calc: c }) => ({ value: c.id, label: `${fmtDate(c.evaluationDate)}: ${formatMoney(c.zakatMinor, c.currency)}` })) },
    { name: "notes", label: "Notes", type: "textarea", nullable: true },
  ];
  const yearTotals = new Map<string, number>();
  for (const p of s.payments) if (p.paidOn.startsWith(today.slice(0, 4))) yearTotals.set(p.currency, (yearTotals.get(p.currency) ?? 0) + p.amountMinor);

  return (
    <>
      <PageHeader glyph="zakat" title="Zakat" />

      <Section title="Calculator">
        <ZakatCalculator today={today} currency={o.defaultCurrency} />
      </Section>

      <Section title="Payments" aside={<Reveal label="Log a payment"><OpForm op="zakat.payment" fields={payFields} initial={{ paidOn: today, currency: o.defaultCurrency, calculationId: s.calcs[0]?.calc.id }} submitLabel="Save payment" compact /></Reveal>}>
        <p className="t-small mb-3">Paid in {today.slice(0, 4)}: <strong>{yearTotals.size ? [...yearTotals].map(([c, v]) => formatMoney(v, c)).join(" + ") : formatMoney(0, o.defaultCurrency)}</strong></p>
        {s.payments.length === 0 ? <Empty>No zakat payments logged yet.</Empty> : (
          <ul className="list">
            {s.payments.map((p) => (
              <li key={p.id} className="py-2.5 grid gap-1">
                <div className="flex flex-wrap justify-between gap-3 t-small">
                  <span><span className="font-medium">{formatMoney(p.amountMinor, p.currency)}</span> to {p.recipient}{p.calc ? <span className="text-ink-2">, for the {fmtDate(p.calc.evaluationDate)} estimate</span> : null}</span>
                  <span className="text-ink-2">{fmtDate(p.paidOn)}</span>
                </div>
                {p.notes && <p className="t-small text-ink-2">{p.notes}</p>}
                <EditPanel>
                    <OpForm op="zakat.payment.update" fields={payFields} fixed={{ id: p.id }} initial={{ ...p, amount: fromMinor(p.amountMinor, p.currency) }} submitLabel="Save" compact />
                    <OpButton op="zakat.payment.delete" input={{ id: p.id }} label="Delete" className="btn btn-sm btn-ghost justify-self-start" confirmText="Delete this payment record?" />
                  </EditPanel>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Saved estimates">
        {s.calcs.length === 0 ? <Empty>No saved estimates yet. Fill in the calculator and save it to keep a snapshot.</Empty> : (
          <ul className="grid gap-4 md:grid-cols-2">
            {s.calcs.map(({ calc: c, paidMinor, payments }) => (
              <li key={c.id} className="panel p-4 grid gap-2 content-start">
                <div className="flex justify-between gap-3">
                  <div>
                    <h3 className="t-h3">As of {fmtDate(c.evaluationDate)}</h3>
                    <p className="t-meta">{c.nisabBasis === "manual" ? "Nisab entered manually" : `${c.nisabBasis} nisab at ${c.pricePerGram} ${c.currency}/g${c.priceSource ? ` (${c.priceSource})` : ""}`}, rate {(c.rateBp / 100).toString()}%</p>
                  </div>
                  <p className="t-h3 shrink-0">{formatMoney(c.zakatMinor, c.currency)}</p>
                </div>
                <p className="t-small">Payments linked: {payments ? `${formatMoney(paidMinor, c.currency)} in ${payments} payment${payments === 1 ? "" : "s"}` : "none yet"}{c.zakatMinor > 0 && paidMinor < c.zakatMinor ? `, ${formatMoney(c.zakatMinor - paidMinor, c.currency)} not yet logged as paid` : ""}</p>
                {c.remindNextYear && <p className="t-meta">Reminder around {fmtDate(nextHawl(c.evaluationDate))} (one lunar year later)</p>}
                <details>
                  <summary className="t-small cursor-pointer">Show working</summary>
                  <div className="mt-2 grid gap-2 t-small">
                    <ul>{c.assets.map((l, n) => <li key={n}>+ {l.label}: {l.amount} {c.currency}</li>)}{c.liabilities.map((l, n) => <li key={`l${n}`}>− {l.label}: {l.amount} {c.currency}</li>)}</ul>
                    <ol className="list-decimal pl-5">{c.steps.map((x) => <li key={x}>{x}</li>)}</ol>
                    {c.notes && <p className="text-ink-2">{c.notes}</p>}
                    <OpButton op="zakat.calculation.delete" input={{ id: c.id }} label="Delete estimate" className="btn btn-sm btn-ghost justify-self-start" confirmText="Delete this saved estimate? Logged payments are kept." />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
