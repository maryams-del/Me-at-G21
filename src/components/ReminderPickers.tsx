"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { daysBetween, dayMonth, shiftDate } from "@/lib/countdown";
import { dmy } from "@/lib/time";
import { Icon } from "./icons";

/* ───────── Alarm-style time wheel ───────── */

const ROW = 32;
const HOURS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const pad = (n: number) => String(n).padStart(2, "0");

function Wheel({ items, index, onChange, label, align = "center" }: { items: string[]; index: number; onChange: (i: number) => void; label: string; align?: "start" | "center" | "end" }) {
  const ref = useRef<HTMLDivElement>(null);
  const idx = useRef(index);
  idx.current = index;
  useEffect(() => {
    const el = ref.current;
    if (el && Math.round(el.scrollTop / ROW) !== index) el.scrollTop = index * ROW;
  }, [index]);
  // A wheel inside a hidden tab can't scroll; line it up again once it becomes visible.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (el.clientHeight > 0 && Math.round(el.scrollTop / ROW) !== idx.current) el.scrollTop = idx.current * ROW; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="wheel" role="spinbutton" tabIndex={0} aria-label={label}
      aria-valuemin={0} aria-valuemax={items.length - 1} aria-valuenow={index} aria-valuetext={items[index]}
      onScroll={(e) => {
        const i = Math.max(0, Math.min(items.length - 1, Math.round(e.currentTarget.scrollTop / ROW)));
        if (i !== index) onChange(i);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp") { e.preventDefault(); onChange(Math.max(0, index - 1)); }
        if (e.key === "ArrowDown") { e.preventDefault(); onChange(Math.min(items.length - 1, index + 1)); }
      }}>
      <div style={{ height: ROW }} />
      {items.map((t, i) => (
        <div key={t + i} className={`wheel-item ${i === index ? "on" : ""}`} style={{ justifyContent: align === "start" ? "flex-start" : align === "end" ? "flex-end" : "center" }}>{t}</div>
      ))}
      <div style={{ height: ROW }} />
    </div>
  );
}

/** Scrollable hour / minute / AM-PM picker. Submits "HH:MM" (24-hour) under `name`, or "" when cleared. */
export function TimeWheel({ name, initial, nullable, label }: { name: string; initial?: unknown; nullable?: boolean; label: string }) {
  const m = /^(\d{1,2}):(\d{2})/.exec(typeof initial === "string" ? initial : "");
  const start = m ? { h: Math.min(23, Number(m[1])), mi: Math.min(59, Number(m[2])) } : null;
  const [on, setOn] = useState(start !== null || !nullable);
  const [h, setH] = useState(start?.h ?? 9);
  const [mi, setMi] = useState(start?.mi ?? 0);
  const pm = h >= 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return (
    <div className="time-wheel">
      <input type="hidden" name={name} value={on ? `${pad(h)}:${pad(mi)}` : ""} />
      {on ? (
        <div className="flex items-center gap-2">
          <div className="wheel-set">
            <div className="wheel-band" aria-hidden />
            <Wheel items={HOURS} index={h12 - 1} label={`${label}: hour`} align="end" onChange={(i) => setH(((i + 1) % 12) + (pm ? 12 : 0))} />
            <Wheel items={MINUTES} index={mi} label={`${label}: minute`} onChange={setMi} />
            <Wheel items={["AM", "PM"]} index={pm ? 1 : 0} label={`${label}: AM or PM`} align="start" onChange={(i) => setH((h % 12) + (i ? 12 : 0))} />
          </div>
          {nullable && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOn(false)}>Clear</button>}
        </div>
      ) : (
        <button type="button" className="btn btn-sm" onClick={() => setOn(true)}><Icon name="plus" size={15} />Add a time</button>
      )}
    </div>
  );
}

/* ───────── Countdown rail: tap the days you want a reminder ───────── */

const NICE: Record<number, string> = { 0: "On the day", 1: "1 day", 7: "1 week", 14: "2 weeks", 21: "3 weeks", 30: "1 month", 60: "2 months", 90: "3 months", 180: "6 months" };
const nice = (n: number) => NICE[n] ?? `${n} days`;
const GAP = 46;

function toDays(v: unknown): number[] {
  const xs = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,]+/) : typeof v === "number" ? [v] : [];
  return [...new Set(xs.map((x) => Math.abs(Number(x))).filter((x) => Number.isFinite(x)))];
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function CountdownRail({ name, initial, anchor, endLabel, presets, includeZero, maxDays = 365, maxCount = 8, onSummary }: {
  name: string; initial?: unknown; anchor?: string | null; endLabel: string; presets: number[];
  includeZero?: boolean; maxDays?: number; maxCount?: number; onSummary?: (text: string) => void;
}) {
  const today = useMemo(localToday, []);
  const [days, setDays] = useState<number[]>(() => toDays(initial).filter((n) => !(includeZero && n === 0)));
  const [adding, setAdding] = useState(false);
  const [cval, setCval] = useState(10);
  const [note, setNote] = useState("");

  const left = anchor && /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? daysBetween(today, anchor) : null;
  const dated = left !== null && left > 0;
  const limit = Math.max(1, Math.min(maxDays, dated ? left - 1 : maxDays));
  const cap = maxCount - (includeZero ? 1 : 0);
  const usable = presets.filter((n) => n <= maxDays && (!dated || n < left));
  const passed = dated ? presets.filter((n) => n >= left && n <= maxDays) : [];
  const nodes = [...new Set([...usable, ...days])].sort((a, b) => b - a);
  const isPast = (n: number) => dated && n >= left;

  // Evenly spaced, one row each: no big empty stretch between "Today" and the first reminder.
  const T0 = 64;
  const ys = nodes.map((_, i) => T0 + i * GAP);
  const endY = (ys.at(-1) ?? T0 - GAP / 2) + GAP;
  const firstOn = nodes.findIndex((n) => days.includes(n) && !isPast(n));

  const chosen = days.filter((n) => !isPast(n)).sort((a, b) => b - a);
  const summary = chosen.length
    ? `${chosen.length + (includeZero ? 1 : 0)} reminder${chosen.length + (includeZero ? 1 : 0) === 1 ? "" : "s"}${dated ? ` before ${dmy(anchor as string)}` : ""}`
    : includeZero ? "Only on the day" : "None picked yet";
  useEffect(() => { onSummary?.(summary); }, [summary, onSummary]);

  function toggle(n: number) {
    setNote("");
    if (days.includes(n)) { setDays(days.filter((x) => x !== n)); return; }
    if (days.length >= cap) { setNote(`You can have up to ${cap} here. Untick one first.`); return; }
    setDays([...days, n]);
  }

  return (
    <div className="grid gap-2.5">
      <input type="hidden" name={name} value={days.join(",")} />
      <div className="rail" style={{ height: endY + 34 }}>
        <div className="rail-line" style={{ top: 30, height: endY - 30 }} aria-hidden />
        {firstOn >= 0 && <div className="rail-fill" style={{ top: ys[firstOn], height: endY - ys[firstOn] }} aria-hidden />}
        <div className="rail-end" style={{ top: 22 }}><span className="rail-start-dot" aria-hidden />{dated ? `Today · ${dmy(today)}` : "Earlier"}</div>
        {nodes.map((n, i) => {
          const on = days.includes(n);
          const past = isPast(n);
          return (
            <button key={n} type="button" className="rail-node" aria-pressed={on} style={{ top: ys[i] - 20 }} onClick={() => toggle(n)}
              aria-label={`${nice(n)} before${dated ? `, ${dmy(shiftDate(anchor as string, -n))}` : ""}${past ? " (already passed)" : ""}`}>
              <span className="rail-dot" aria-hidden />
              <span className="lbl">{n === 0 ? nice(0) : `${nice(n)} before`}</span>
              <span className="dt">{past ? "passed" : dated ? dayMonth(shiftDate(anchor as string, -n)) : ""}</span>
            </button>
          );
        })}
        <div className="rail-end exp" style={{ top: endY - 8 }}><span className="rail-diamond" aria-hidden />{dated ? `${endLabel} · ${dmy(anchor as string)}` : endLabel}</div>
      </div>
      {passed.length > 0 && <p className="t-meta">{passed.map(nice).join(" and ")} before {passed.length === 1 ? "has" : "have"} already passed.</p>}
      {includeZero && <p className="t-meta">You’ll also get one on the day.</p>}
      {note && <p className="error" role="status">{note}</p>}
      <button type="button" className="rail-add" aria-expanded={adding} onClick={() => setAdding(!adding)}>
        <span className="rail-add-ico" aria-hidden><Icon name="plus" size={15} strokeWidth={2.4} /></span>Another day
      </button>
      {adding && (
        <div className="stepper preview-enter">
          <button type="button" aria-label="One day fewer" onClick={() => setCval(Math.max(1, cval - 1))}>−</button>
          <span className="stepper-val">{cval} day{cval === 1 ? "" : "s"}{dated ? <span className="text-ink-3"> · {dayMonth(shiftDate(anchor as string, -cval))}</span> : null}</span>
          <button type="button" aria-label="One day more" onClick={() => setCval(Math.min(limit, cval + 1))}>+</button>
          <button type="button" className="btn btn-sm btn-accent" onClick={() => { if (!days.includes(cval)) toggle(cval); setAdding(false); }}>Add</button>
        </div>
      )}
    </div>
  );
}
