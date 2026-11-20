"use client";
import Link from "next/link";
import { useState } from "react";

export type DayItem = { text: string; href?: string; when?: string };
export type Day = { date: string; weekday: string; dayNum: string; title: string; items: DayItem[] };

/** This week as seven rings. Busy days have an outline and dots; tap a day to see what's on it underneath. */
export function WeekRings({ days }: { days: Day[] }) {
  const [sel, setSel] = useState(() => Math.max(0, days.findIndex((d) => d.items.length > 0)));
  const cur = days[sel];
  return (
    <section aria-labelledby="week-h" className="home-week">
      <h2 id="week-h" className="t-label mb-3.5" style={{ color: "var(--ink-3)" }}>This week</h2>
      <div className="rings">
        {days.map((d, i) => (
          <button key={d.date} type="button" onClick={() => setSel(i)} aria-pressed={i === sel}
            aria-label={`${d.title}, ${d.items.length ? `${d.items.length} thing${d.items.length === 1 ? "" : "s"}` : "nothing planned"}`}
            className={`ring${i === 0 ? " today" : ""}${d.items.length ? " busy" : ""}`}>
            <span className="rl">{i === 0 ? "Today" : d.weekday}</span>
            <span className="rn">{Number(d.dayNum)}</span>
            <span className="rd" aria-hidden>{d.items.slice(0, 3).map((_, k) => <i key={k} />)}</span>
          </button>
        ))}
      </div>
      <div aria-live="polite" className="mt-4">
        <p className="text-[13px] font-bold" style={{ color: "var(--wk-acc)" }}>{cur.title}</p>
        {cur.items.length ? (
          <ul key={cur.date} className="mt-1">
            {cur.items.map((it, k) => (
              <li key={k} className="rise flex justify-between items-baseline gap-3 py-2.5 text-[14px] md:text-[15px]" style={{ borderTop: "1px solid var(--hair)" }}>
                {it.href ? <Link href={it.href} className="hover:underline underline-offset-4 min-w-0">{it.text}</Link> : <span className="min-w-0">{it.text}</span>}
                {it.when && <span className="text-[12px] shrink-0" style={{ color: "var(--ink-3)" }}>{it.when}</span>}
              </li>
            ))}
          </ul>
        ) : <p key={cur.date} className="rise mt-1 py-2.5 text-[14px]" style={{ borderTop: "1px solid var(--hair)", color: "var(--ink-3)" }}>Nothing planned. A free day.</p>}
      </div>
    </section>
  );
}
