import Link from "next/link";
import { SpaceHeader } from "@/components/SpaceHeader";
import { pageOwner, charityState, pendingCharity } from "@/server/queries";
import { Section, Empty } from "@/components/ui";
import { PageAddProvider, PageAddButton, PageAddPanel } from "@/components/PageAdd";
import { OpForm } from "@/components/OpForm";
import { charityFields } from "@/components/fields";
import { formatMoney } from "@/lib/money";
import { todayLocal } from "@/lib/time";
import { DonationList, monthName } from "./DonationList";
import { CharityTabs, YearPicker } from "./CharityTabs";

/** Charity: this month and the year's total, then tabs: one line per month (tap one to see and search it) and pending payments. */
export default async function CharityPage({ searchParams }: { searchParams: Promise<{ year?: string; add?: string; tab?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const s = await charityState(o, { year: sp.year });
  const pending = await pendingCharity(o);
  const today = todayLocal(o.timezone);
  const yearTotals = new Map<string, number>();
  for (const [, m] of s.monthly) for (const [c, v] of m) yearTotals.set(c, (yearTotals.get(c) ?? 0) + v);
  const thisMonth = s.monthly.get(today.slice(0, 7));
  const sum = (m?: Map<string, number>) => (m && m.size ? [...m].map(([c, v]) => formatMoney(v, c)).join(" + ") : formatMoney(0, o.defaultCurrency));
  const suggest = { recipients: s.recipients, causes: s.causes };
  const thisYear = today.slice(0, 4);
  const years = [...new Set([String(s.year), ...Array.from({ length: 8 }, (_, i) => String(Number(thisYear) - i))])].sort().reverse();

  // One line per month that has any donation (paid or planned), newest first.
  const months = new Map<string, { count: number; planned: number }>();
  for (const r of s.rows) {
    const k = r.paidOn.slice(0, 7);
    const m = months.get(k) ?? { count: 0, planned: 0 };
    m.count++; if (r.status === "planned") m.planned++;
    months.set(k, m);
  }

  return (
    <>
      <PageAddProvider initialOpen={sp.add === "1"}>
      <SpaceHeader href="/finance/charity"><PageAddButton label="Log a donation" /></SpaceHeader>
      <div className="money-tiles">
        <div className="tile rust min-h-0"><p className="t-small">This month</p><p className="t-num text-[1.9rem] md:text-[2.4rem] mt-2">{sum(thisMonth)}</p></div>
        <div className="tile min-h-0"><p className="t-small text-ink-2">{s.year} total</p><p className="t-num text-[1.9rem] md:text-[2.4rem] mt-2">{sum(yearTotals)}</p></div>
      </div>
      <PageAddPanel title="Log a donation">
        <OpForm op="charity.create" fields={charityFields(o.defaultCurrency, { ...suggest, repeatUpTo: 12 - Number(today.slice(5, 7)) })}
          initial={{ paidOn: today, status: "completed", currency: o.defaultCurrency }} submitLabel="Save donation" />
      </PageAddPanel>
      </PageAddProvider>

      <div className="mb-6" />
      <CharityTabs pendingCount={pending.length} startOn={sp.tab === "pending" ? "pending" : "months"}
        months={
        <Section title={`By month, ${s.year}`} aside={<YearPicker year={String(s.year)} years={years} />}>
          {months.size === 0 ? <Empty>No donations in {s.year}. Tap + to log one, or say “I donated 100 SAR via Al Khidmat” in Capture.</Empty> : (
            <ul className="list panel px-2">
              {[...months].sort((a, b) => b[0].localeCompare(a[0])).map(([m, info]) => (
                <li key={m}>
                  <Link href={`/finance/charity/${m}`} className="month-row">
                    <span className="grid gap-0.5 min-w-0">
                      <span className="font-medium">{monthName(m)}</span>
                      <span className="t-meta">{info.count} donation{info.count === 1 ? "" : "s"}{info.planned ? `, ${info.planned} pending` : ""}</span>
                    </span>
                    <span className="t-num text-lg ml-auto">{sum(s.monthly.get(m))}</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-ink-3 shrink-0"><path d="M9 6l6 6-6 6" /></svg>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        }
        pending={pending.length === 0
          ? <Empty>Nothing pending. Log a donation as “Planned (not paid yet)” and it waits here until you mark it paid.</Empty>
          : <DonationList rows={pending} currency={o.defaultCurrency} today={today} suggest={suggest} />} />
    </>
  );
}
