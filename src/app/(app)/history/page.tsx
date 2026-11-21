import { pageOwner, historyState } from "@/server/queries";
import { FilterSelect } from "@/components/FilterPanel";
import { PageHeader, Empty, SearchPill } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { SearchBox } from "./SearchBox";
import { FilterPanel } from "@/components/FilterPanel";
import { OpButton } from "@/components/OpForm";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const s = await historyState(o, sp);
  return (
    <>
      <PageHeader glyph="history" title="History & search">
        {s.rows.length > 0 && (
          <OpButton op="history.clear" input={{}} label="Clear history" icon="trash" className="btn btn-sm"
            confirmText="Clear all of your history? Every activity line on this page will be removed. Your entries themselves (donations, expiries, documents…) stay as they are. This can’t be undone." />
        )}
      </PageHeader>
      <SearchBox />
      <div className="toolbar mb-6 mt-3">
        <SearchPill q={sp.q} placeholder="Search history" keep={{ category: sp.category, from: sp.from, to: sp.to }} />
        <FilterPanel active={!!(sp.category || sp.from || sp.to)}>
          <form className="panel p-4 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] items-end" aria-label="Filter history">
            {sp.q && <input type="hidden" name="q" value={sp.q} />}
            <FilterSelect label="Category" name="category" value={sp.category} options={[{ value: "", label: "All" }, ...s.categories.map((c) => ({ value: c, label: c }))]} />
            <label className="field"><span className="label">From</span><input type="date" name="from" defaultValue={sp.from} className="input" /></label>
            <label className="field"><span className="label">To</span><input type="date" name="to" defaultValue={sp.to} className="input" /></label>
            <button className="btn">Apply</button>
          </form>
        </FilterPanel>
      </div>
      {s.rows.length === 0 ? <Empty>No matching activity.</Empty> : (
        <ul className="list panel px-4">
          {s.rows.map((r) => (
            <li key={r.id} className="py-2.5 grid sm:grid-cols-[10rem_7rem_1fr] gap-x-4 t-small">
              <span className="t-meta">{fmtDateTime(r.occurredAt, o.timezone)}</span>
              <span className="text-ink-2">{r.category}, {r.action}</span>
              <span>{r.summary}{r.source === "ai" && <span className="chip chip-fill ml-2">AI-confirmed</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
