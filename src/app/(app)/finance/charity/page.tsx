import { dmy } from "@/lib/time";
import { pageOwner, charityState } from "@/server/queries";
import { PageHeader, Section, Empty, SearchPill } from "@/components/ui";
import { OpForm, OpButton, Reveal, EditPanel } from "@/components/OpForm";
import { charityFields } from "@/components/fields";
import { formatMoney, fromMinor } from "@/lib/money";
import { todayLocal } from "@/lib/time";
import { fmtDate } from "@/lib/format";
import { FilterPanel } from "@/components/FilterPanel";

const monthName = (m: string, withYear = false) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(m + "-01"));

export default async function CharityPage({ searchParams }: { searchParams: Promise<{ q?: string; year?: string; add?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const s = await charityState(o, sp);
  const today = todayLocal(o.timezone);
  const yearTotals = new Map<string, number>();
  for (const [, m] of s.monthly) for (const [c, v] of m) yearTotals.set(c, (yearTotals.get(c) ?? 0) + v);
  const thisMonth = s.monthly.get(today.slice(0, 7));
  const sum = (m?: Map<string, number>) => (m && m.size ? [...m].map(([c, v]) => formatMoney(v, c)).join(" + ") : formatMoney(0, o.defaultCurrency));
  const suggest = { recipients: s.recipients, causes: s.causes };

  // History, grouped by month (newest first).
  const byMonth = new Map<string, typeof s.rows>();
  for (const r of s.rows) { const k = r.paidOn.slice(0, 7); byMonth.set(k, [...(byMonth.get(k) ?? []), r]); }

  return (
    <>
      <PageHeader glyph="charity" title="Charity" />
      <div className="money-tiles mb-8">
        <div className="tile rust min-h-0"><p className="t-small">This month</p><p className="t-num text-[1.9rem] md:text-[2.4rem] mt-2">{sum(thisMonth)}</p></div>
        <div className="tile min-h-0"><p className="t-small text-ink-2">{s.year} total</p><p className="t-num text-[1.9rem] md:text-[2.4rem] mt-2">{sum(yearTotals)}</p></div>
      </div>

      <div className="toolbar mb-8">
        <SearchPill q={sp.q} placeholder="Search donations" keep={{ year: sp.year }} />
        <FilterPanel active={s.year !== today.slice(0, 4)}>
          <form className="panel p-3 flex flex-wrap gap-2 items-end">
            {sp.q && <input type="hidden" name="q" value={sp.q} />}
            <label className="field w-[7rem]"><span className="label">Year</span><input name="year" defaultValue={s.year} className="input" inputMode="numeric" /></label>
            <button className="btn">Apply</button>
            {(sp.q || s.year !== today.slice(0, 4)) && <a href="/finance/charity" className="btn btn-ghost">Clear</a>}
          </form>
        </FilterPanel>
        <Reveal label="Log a donation" iconOnly open={sp.add === "1"}>
          <OpForm op="charity.create" fields={charityFields(o.defaultCurrency, { ...suggest, repeatUpTo: 12 - Number(today.slice(5, 7)) })}
            initial={{ paidOn: today, status: "completed", currency: o.defaultCurrency }} submitLabel="Save donation" />
        </Reveal>
      </div>

      {s.monthly.size > 0 && (
        <Section title={`By month, ${s.year}`}>
          <ul className="list panel px-4">
            {[...s.monthly].sort((a, b) => b[0].localeCompare(a[0])).map(([m, cur]) => (
              <li key={m} className="py-2 flex justify-between t-small"><span>{monthName(m)}</span><span>{sum(cur)}</span></li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="History">
        {s.rows.length === 0 ? <Empty>No donations in {s.year}{sp.q ? ` matching “${sp.q}”` : ""}. Log one above, or say “I donated 100 SAR via Ehsan” in Capture.</Empty> : (
          <div className="grid gap-5">
            {[...byMonth].map(([m, rows]) => (
              <div key={m}>
                <p className="t-label mb-2">{monthName(m, true)}</p>
                <ul className="list panel px-4">
                  {rows.map((r) => (
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
                      <div className="col-span-2 flex flex-wrap gap-2 items-start">
                        {r.status === "planned" && <OpButton op="charity.update" className="btn btn-sm" label="Mark paid" input={{ ...r, id: r.id, amount: fromMinor(r.amountMinor, r.currency), status: "completed", paidOn: today, cause: r.cause, notes: r.notes }} confirmText={`Mark as paid today (${dmy(today)})?`} />}
                        <EditPanel>
                          <OpForm op="charity.update" fields={charityFields(o.defaultCurrency, suggest)} fixed={{ id: r.id, recurring: r.recurring }} submitLabel="Save changes" compact
                            initial={{ ...r, amount: fromMinor(r.amountMinor, r.currency) }} 
                      deleteAction={{ op: "charity.delete", input: { id: r.id }, confirm: "Delete this donation? It will be removed from totals.", label: "Delete" }} />
                        </EditPanel>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
