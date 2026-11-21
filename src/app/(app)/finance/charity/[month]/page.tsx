import { notFound } from "next/navigation";
import { pageOwner, charityState } from "@/server/queries";
import { PageHeader, Empty, SearchPill, FilterTags, withoutParam } from "@/components/ui";
import { FilterPanel, FilterSelect } from "@/components/FilterPanel";
import { formatMoney } from "@/lib/money";
import { todayLocal } from "@/lib/time";
import { DonationList, monthName } from "../DonationList";

const STATUS = [{ value: "", label: "All" }, { value: "completed", label: "Paid" }, { value: "planned", label: "Planned" }];

/** One month of donations, with search and filters. */
export default async function CharityMonth({ params, searchParams }: { params: Promise<{ month: string }>; searchParams: Promise<{ q?: string; cause?: string; status?: string; recurring?: string }> }) {
  const { month } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) notFound();
  const sp = await searchParams;
  const o = await pageOwner();
  const today = todayLocal(o.timezone);
  const all = await charityState(o, { month });
  const s = sp.q ? await charityState(o, { month, q: sp.q }) : all;
  const causes = [...new Set(all.rows.map((r) => r.cause).filter((c): c is string => !!c))].sort();
  const status = STATUS.some((x) => x.value === sp.status) ? sp.status : undefined;
  const cause = sp.cause && causes.includes(sp.cause) ? sp.cause : undefined;
  const recurring = sp.recurring === "yes" || sp.recurring === "no" ? sp.recurring : undefined;
  const rows = s.rows.filter((r) => (!status || r.status === status) && (!cause || r.cause === cause) && (!recurring || r.recurring === (recurring === "yes")));
  const path = `/finance/charity/${month}`;
  const p = { q: sp.q, cause, status, recurring };
  const totals = new Map<string, number>();
  for (const r of rows) if (r.status === "completed") totals.set(r.currency, (totals.get(r.currency) ?? 0) + r.amountMinor);
  const total = totals.size ? [...totals].map(([c, v]) => formatMoney(v, c)).join(" + ") : formatMoney(0, o.defaultCurrency);
  const filtering = !!(sp.q || cause || status || recurring);

  return (
    <>
      <PageHeader glyph="charity" title={monthName(month, true)} intro={`${rows.length} donation${rows.length === 1 ? "" : "s"} · ${total} paid${filtering ? " (filtered)" : ""}`} />
      <div className="toolbar">
        <SearchPill q={sp.q} placeholder={`Search ${monthName(month)}`} keep={{ cause, status, recurring }} />
        <FilterPanel active={!!(cause || status || recurring)}>
          <form className="panel p-3 flex flex-wrap gap-3 items-end">
            {sp.q && <input type="hidden" name="q" value={sp.q} />}
            <FilterSelect label="Status" name="status" value={status} options={STATUS} />
            {causes.length > 0 && <FilterSelect label="Cause" name="cause" value={cause} options={[{ value: "", label: "All causes" }, ...causes.map((c) => ({ value: c, label: c }))]} />}
            <FilterSelect label="Recurring" name="recurring" value={recurring} options={[{ value: "", label: "All" }, { value: "yes", label: "Recurring" }, { value: "no", label: "One-off" }]} />
            <button className="btn">Apply</button>
          </form>
        </FilterPanel>
      </div>
      <FilterTags clearHref={path} tags={[
        ...(sp.q ? [{ label: `“${sp.q}”`, href: withoutParam(path, p, "q") }] : []),
        ...(status ? [{ label: STATUS.find((x) => x.value === status)!.label, href: withoutParam(path, p, "status") }] : []),
        ...(cause ? [{ label: cause, href: withoutParam(path, p, "cause") }] : []),
        ...(recurring ? [{ label: recurring === "yes" ? "Recurring" : "One-off", href: withoutParam(path, p, "recurring") }] : []),
      ]} />
      <div className="mb-8" />
      {rows.length === 0
        ? <Empty>{filtering ? "No donations match these filters." : `No donations in ${monthName(month, true)}.`}</Empty>
        : <DonationList rows={rows} currency={o.defaultCurrency} today={today} suggest={{ recipients: all.recipients, causes: all.causes }} />}
    </>
  );
}
