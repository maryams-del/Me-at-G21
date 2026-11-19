/**
 * Shown instantly while the next page renders on the server, so a tap never
 * leaves the old page frozen on screen. Shapes roughly match PageHeader + tiles.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="page-loading">
      <span className="sr-only">Loading…</span>
      <div className="mb-7 pb-5 rule-b flex items-center gap-3">
        <div className="skeleton rounded-full" style={{ width: 34, height: 34 }} />
        <div className="grid gap-2">
          <div className="skeleton" style={{ width: 200, height: 28 }} />
          <div className="skeleton" style={{ width: 260, height: 12 }} />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="panel skeleton-panel" style={{ height: 112 }} />
        ))}
      </div>
    </div>
  );
}
