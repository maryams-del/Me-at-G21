import { dmy } from "@/lib/time";
import { SpaceHeader } from "@/components/SpaceHeader";
import { pageOwner, charityState } from "@/server/queries";
import { PageHeader, Section, Empty, SearchPill, FilterTags, withoutParam } from "@/components/ui";
import { PageAddProvider, PageAddButton, PageAddPanel } from "@/components/PageAdd";
import { OpForm, OpButton, ItemRow } from "@/components/OpForm";
import { charityFields } from "@/components/fields";
import { formatMoney, fromMinor } from "@/lib/money";
import { todayLocal } from "@/lib/time";
import { fmtDate } from "@/lib/format";
import { FilterPanel, FilterSelect } from "@/components/FilterPanel";

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
  const thisYear = today.slice(0, 4);
  const years = [...new Set([String(s.year), ...Array.from({ length: 8 }, (_, i) => String(Number(thisYear) - i))])].sort().reverse();

  // History, grouped by month (newest first).
  const byMonth = new Map<string, typeof s.rows>();
  for (const r of s.rows) { const k = r.paidOn.slice(0, 7); byMonth.set(k, [...(byMonth.get(k) ?? []), r]); }

  return (
    <>
      <PageAddProvider initialOpen={sp.add === "1"}>
      <SpaceHeader href="/finance/charity"><PageAddButton label="Log a donation" /></SpaceHeader>
      <div className="money-tiles mb-8">
        <div className="tile rust min-h-0"><p className="t-small">This month</p><p className="t-num text-[1.9rem] md:text-[2.4rem] mt-2">{sum(thisMonth)}</p></div>
        <div className="tile min-h-0"><p className="t-small text-ink-2">{s.year} total</p><p className="t-num text-[1.9rem] md:text-[2.4rem] mt-2">{sum(yearTotals)}</p></div>
      </div>

      <div className="toolbar">
        <SearchPill q={sp.q} placeholder="Search donations" keep={{ year: sp.year }} />
        <FilterPanel active={s.year !== thisYear}>
          <form className="panel p-3 flex flex-wrap gap-2 items-end">
            {sp.q && <input type="hidden" name="q" value={sp.q} />}
            <FilterSelect label="Year" name="year" value={s.year} options={years.map((y) => ({ value: y, label: y }))} />
            <button className="btn">Apply</button>
          </form>
        </FilterPanel>
      </div>
      <FilterTags clearHref="/finance/charity" tags={[
        ...(sp.q ? [{ label: `“${sp.q}”`, href: withoutParam("/finance/charity", { q: sp.q, year: sp.year }, "q") }] : []),
        ...(s.year !== thisYear ? [{ label: s.year, href: withoutParam("/finance/charity", { q: sp.q, year: sp.year }, "year") }] : []),
      ]} />
      <PageAddPanel title="Log a donation">
        <OpForm op="charity.create" fields={charityFields(o.defaultCurrency, { ...suggest, repeatUpTo: 12 - Number(today.slice(5, 7)) })}
          initial={{ paidOn: today, status: "completed", currency: o.defaultCurrency }} submitLabel="Save donation" />
      </PageAddPanel>
      </PageAddProvider>
      <div className="mb-8" />

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
                    <li key={r.id} className="py-3 grid gap-1">
                      <ItemRow del={{ op: "charity.delete", input: { id: r.id }, confirm: "Delete this donation?", note: "It will be removed from your totals.", label: "Delete" }} name={`donation to ${r.recipient}`}
                        head={<><p className="font-medium">{r.recipient}{r.cause && <span className="text-ink-2 font-normal">, {r.cause}</span>}</p>
                          <p className="t-meta">{fmtDate(r.paidOn)}{r.recurring ? ", recurring" : ""}{r.source === "ai" ? ", captured with AI" : ""}</p></>}
                        aside={<div className="text-right"><p className="t-num text-xl">{formatMoney(r.amountMinor, r.currency)}</p>{r.status === "planned" && <span className="chip chip-mustard">planned</span>}</div>}
                        edit={<OpForm op="charity.update" fields={charityFields(o.defaultCurrency, suggest)} fixed={{ id: r.id, recurring: r.recurring }} submitLabel="Save changes" compact
                            initial={{ ...r, amount: fromMinor(r.amountMinor, r.currency) }}
                            deleteAction={{ op: "charity.delete", input: { id: r.id }, confirm: "Delete this donation?", note: "It will be removed from your totals.", label: "Delete" }} />}>
                        {r.notes && <p className="t-small text-ink-2">{r.notes}</p>}
                        {r.status === "planned" && <div><OpButton op="charity.update" className="btn btn-sm" label="Mark paid" input={{ ...r, id: r.id, amount: fromMinor(r.amountMinor, r.currency), status: "completed", paidOn: today, cause: r.cause, notes: r.notes }} confirmText={`Mark as paid today (${dmy(today)})?`} /></div>}
                      </ItemRow>
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
