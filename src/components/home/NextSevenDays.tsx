"use client";
import Link from "next/link";
import { useState } from "react";

export type DayItem = { text: string; href?: string };
export type Day = { date: string; weekday: string; dayNum: string; title: string; items: DayItem[] };

/** Seven day bars; the chosen bar grows and its items show underneath. Dots = how many things that day. */
export function NextSevenDays({ days }: { days: Day[] }) {
  const [sel, setSel] = useState(() => Math.max(0, days.findIndex((d) => d.items.length > 0)));
  const cur = days[sel];
  return (
    <section aria-labelledby="up-h">
      <h2 id="up-h" className="t-label mb-2.5">Next 7 days</h2>
      <div className="grid grid-cols-7 gap-1.5 md:gap-2 items-end h-[108px] md:h-[150px]">
        {days.map((d, i) => {
          const on = i === sel;
          return (
            <button key={d.date} type="button" onClick={() => setSel(i)} aria-pressed={on}
              aria-label={`${d.title}, ${d.items.length} item${d.items.length === 1 ? "" : "s"}`}
              className={`day-bar ${on ? "" : "glass"}`} style={{ height: on ? "100%" : "74%", borderRadius: 999 }}>
              <span className="flex gap-[3px] mb-auto pt-3 relative">
                {d.items.slice(0, 4).map((_, k) => <span key={k} className="w-[5px] h-[5px] rounded-full" style={{ background: on ? "#8A4A12" : "var(--mustard)" }} />)}
              </span>
              <span className="relative text-[15px] md:text-[19px] font-bold">{d.dayNum}</span>
              <span className="relative text-[10px] md:text-[12px] font-semibold opacity-90">{i === 0 ? "Today" : d.weekday}</span>
            </button>
          );
        })}
      </div>
      <div className="glass mt-3 px-[18px] py-3.5" aria-live="polite">
        <p className="t-small font-bold" style={{ color: "var(--accent-ink)" }}>{cur.title}{cur.items.length ? ` · ${cur.items.length} item${cur.items.length === 1 ? "" : "s"}` : ""}</p>
        {cur.items.length ? (
          <ul key={cur.date} className="mt-1.5">
            {cur.items.map((it, k) => (
              <li key={k} className="rise py-2 t-small" style={{ borderTop: "1px solid var(--hair)" }}>
                {it.href ? <Link href={it.href} className="hover:underline underline-offset-4">{it.text}</Link> : it.text}
              </li>
            ))}
          </ul>
        ) : <p key={cur.date} className="rise mt-1.5 t-small text-ink-3">Nothing planned. A free day.</p>}
      </div>
    </section>
  );
}
