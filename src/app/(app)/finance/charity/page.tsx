import { dmy } from "@/lib/time";
import { pageOwner, charityState } from "@/server/queries";
import { PageHeader, Section, Empty } from "@/components/ui";
import { OpForm, OpButton, Reveal } from "@/components/OpForm";
import { charityFields } from "@/components/fields";
import { formatMoney, fromMinor } from "@/lib/money";
import { todayLocal } from "@/lib/time";
import { fmtDate } from "@/lib/format";

export default async function CharityPage({ searchParams }: { searchParams: Promise<{ q?: string; year?: string; add?: string; edit?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const s = await charityState(o, sp);
  const today = todayLocal(o.timezone);
  const yearTotals = new Map<string, number>();
  for (const [, m] of s.monthly) for (const [c, v] of m) yearTotals.set(c, (yearTotals.get(c) ?? 0) + v);
  const thisMonth = s.monthly.get(today.slice(0, 7));
  const editing = sp.edit ? s.rows.find((r) => r.id === sp.edit) : undefined;

  return (
    <>
      <PageHeader glyph="charity" title="Charity" intro="Payments you've made. Planned donations are kept separate and never count as paid." />
      <div className="grid gap-3 sm:grid-cols-2 mb-8">
        <div className="tile rust min-h-0"><p className="t-small">This month</p><p className="t-num text-[2.4rem] mt-2">{thisMonth ? [...thisMonth].map(([c, v]) => formatMoney(v, c)).join(" + ") : formatMoney(0, o.defaultCurrency)}</p></div>
        <div className="tile min-h-0"><p className="t-small text-ink-2">{s.year} total</p><p className="t-num text-[2.4rem] mt-2">{yearTotals.size ? [...yearTotals].map(([c, v]) => formatMoney(v, c)).join(" + ") : formatMoney(0, o.defaultCurrency)}</p></div>
      </div>

      <div className="mb-8">
        {editing ? (
          <div className="panel p-4">
            <h2 className="t-h3 mb-3">Edit donation</h2>
            <OpForm op="charity.update" fields={charityFields(o.defaultCurrency)} fixed={{ id: editing.id }} submitLabel="Save changes"
              initial={{ ...editing, amount: fromMinor(editing.amountMinor, editing.currency) }} />
          </div>
        ) : (
          <Reveal label="Log a donation" buttonClass="btn btn-primary" open={sp.add === "1"}>
            <OpForm op="charity.create" fields={charityFields(o.defaultCurrency)} initial={{ paidOn: today, status: "completed", currency: o.defaultCurrency }} submitLabel="Save donation" />
          </Reveal>
        )}
      </div>

      <Section title="History" aside={
        <form className="flex gap-2" role="search">
          <label className="sr-only" htmlFor="q">Search recipient or cause</label>
          <input id="q" name="q" defaultValue={sp.q} className="input" style={{ minHeight: 36, width: "11rem" }} placeholder="Search" />
          <label className="sr-only" htmlFor="year">Year</label>
          <input id="year" name="year" defaultValue={s.year} className="input" style={{ minHeight: 36, width: "5.5rem" }} inputMode="numeric" />
          <button className="btn btn-sm">Filter</button>
        </form>
      }>
        {s.rows.length === 0 ? <Empty>No donations in {s.year}{sp.q ? ` matching “${sp.q}”` : ""}. Log one above, or say “I donated 100 SAR via Ehsan” in Capture.</Empty> : (
          <ul className="list panel px-4">
            {s.rows.map((r) => (
              <li key={r.id} className="py-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <p className="font-medium">{r.recipient}{r.cause && <span className="text-ink-2 font-normal">, {r.cause}</span>}</p>
                  <p className="t-meta">{fmtDate(r.paidOn)}{r.recurring ? ", recurring" : ""}{r.source === "ai" ? ", captured with AI" : ""}</p>
                  {r.notes && <p className="t-small text-ink-2">{r.notes}</p>}
                </div>
                <div className="text-right">
                  <p className="t-num text-xl">{formatMoney(r.amountMinor, r.currency)}</p>
                  {r.status === "planned" && <span className="chip chip-mustard">planned</span>}
                </div>
                <div className="col-span-2 flex gap-2">
                  {r.status === "planned" && <OpButton op="charity.update" className="btn btn-sm" label="Mark paid" input={{ ...r, id: r.id, amount: fromMinor(r.amountMinor, r.currency), status: "completed", paidOn: today, cause: r.cause, notes: r.notes }} confirmText={`Mark as paid today (${dmy(today)})?`} />}
                  <a href={`?edit=${r.id}`} className="btn btn-sm btn-ghost">Edit</a>
                  <OpButton op="charity.delete" input={{ id: r.id }} label="Delete" className="btn btn-sm btn-ghost" confirmText="Delete this donation? It will be removed from totals." />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {s.monthly.size > 0 && (
        <Section title={`By month, ${s.year}`}>
          <ul className="list panel px-4">
            {[...s.monthly].sort((a, b) => b[0].localeCompare(a[0])).map(([m, cur]) => (
              <li key={m} className="py-2 flex justify-between t-small"><span>{new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(m + "-01"))}</span><span>{[...cur].map(([c, v]) => formatMoney(v, c)).join(" + ")}</span></li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
