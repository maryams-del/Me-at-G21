import Link from "next/link";
import { Glyph, type GlyphKind } from "./Glyph";

export function PageHeader({ glyph, title, intro, children }: { glyph?: GlyphKind; title: string; intro?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4 pb-5 rule-b">
      <div className="flex items-start gap-3 min-w-0">
        {glyph && <Glyph kind={glyph} size={34} accent="var(--rust)" className="mt-0.5 shrink-0" />}
        <div className="min-w-0">
          <h1 className="t-h1">{title}</h1>
          {intro && <p className="t-small text-ink-2 mt-1 prose-w">{intro}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </header>
  );
}

export function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="mb-9">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="t-h2">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="panel p-5 grid gap-3 justify-items-start" style={{ borderStyle: "dashed" }}>
      <p className="t-small text-ink-2 prose-w">{children}</p>
      {action}
    </div>
  );
}

export function Stat({ value, label, sub }: { value: React.ReactNode; label: string; sub?: React.ReactNode }) {
  return (
    <div>
      <p className="t-meta" style={{ color: "inherit", opacity: 0.8 }}>{label}</p>
      <p className="t-num text-[2.6rem] mt-1">{value}</p>
      {sub && <p className="t-small mt-1" style={{ opacity: 0.85 }}>{sub}</p>}
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="t-small text-ink-2 underline underline-offset-4 inline-block mb-3">{label}</Link>;
}

export function ReminderList({ items, tz }: { items: { id: string; title: string; publicBody: string; fireAt: Date }[]; tz: string }) {
  if (!items.length) return <p className="t-meta">No upcoming reminders.</p>;
  const f = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
  return (
    <ul className="list">
      {items.map((r) => (
        <li key={r.id} className="py-2 flex justify-between gap-4 t-small">
          <span>{r.title} <span className="text-ink-3">{r.publicBody}</span></span>
          <span className="t-meta whitespace-nowrap">{f.format(r.fireAt)}</span>
        </li>
      ))}
    </ul>
  );
}
