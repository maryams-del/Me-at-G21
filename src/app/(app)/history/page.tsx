import { pageOwner, historyState } from "@/server/queries";
import { PageHeader, Empty } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { SearchBox } from "./SearchBox";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const s = await historyState(o, sp);
  return (
    <>
      <PageHeader glyph="history" title="History & search" intro="Everything you've logged, newest first. Personal-care entries show their details only here, on your device." />
      <SearchBox />
      <form className="panel p-4 grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] items-end mb-6" role="search" aria-label="Filter history">
        <label className="field"><span className="label">Keywords</span><input name="q" defaultValue={sp.q} className="input" /></label>
        <label className="field"><span className="label">Category</span>
          <select name="category" defaultValue={sp.category ?? ""} className="select"><option value="">All</option>{s.categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="field"><span className="label">From</span><input type="date" name="from" defaultValue={sp.from} className="input" /></label>
        <label className="field"><span className="label">To</span><input type="date" name="to" defaultValue={sp.to} className="input" /></label>
        <button className="btn">Filter</button>
      </form>
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
