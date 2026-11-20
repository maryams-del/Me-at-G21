"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Glyph, type GlyphKind } from "@/components/Glyph";
import { useSizes } from "@/lib/sizes";

export type Space = { key: string; name: string; stat: string; href: string; glyph: GlyphKind; tint: string };

/**
 * "Your spaces": glass cards riding a wave. The middle card sits on the crest; neighbours dip and tilt.
 * Move with a sideways swipe, a horizontal trackpad scroll, the arrows, the arrow keys, or by tapping a card.
 */
export function SpacesWave({ spaces }: { spaces: Space[] }) {
  const n = spaces.length;
  const k = useSizes().waveCards;
  const [pos, setPos] = useState(0);
  const [drag, setDrag] = useState(false);
  const [width, setWidth] = useState(360);
  const stage = useRef<HTMLDivElement>(null);
  const g = useRef<{ x: number | null; p: number; moved: boolean; t?: ReturnType<typeof setTimeout> }>({ x: null, p: 0, moved: false });

  useEffect(() => {
    const el = stage.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Circular: the position runs freely in both directions and every card is placed at its nearest wrapped offset.
  const clamp = (v: number) => v;
  const snap = (v: number) => { setDrag(false); setPos(Math.round(v)); };
  const wrap = (v: number) => ((v % n) + n) % n;
  const wide = width >= 600;
  const gap = k * (wide ? Math.min(210, Math.max(170, width * 0.22)) : Math.min(150, Math.max(118, width * 0.35)));
  const lift = k * (wide ? 100 : 72);
  const top = k * (wide ? 40 : 30);
  const cur = n ? wrap(Math.round(pos)) : 0;

  return (
    <div>
      <div
        ref={stage}
        className="spaces-stage"
        role="region"
        aria-roledescription="carousel"
        aria-label="Your spaces"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); snap(pos + 1); } if (e.key === "ArrowLeft") { e.preventDefault(); snap(pos - 1); } }}
        onWheel={(e) => {
          if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical scrolling stays with the page
          setDrag(true); setPos((p) => clamp(p + e.deltaX / 110));
          clearTimeout(g.current.t); g.current.t = setTimeout(() => setPos((p) => { setDrag(false); return clamp(Math.round(p)); }), 140);
        }}
        onPointerDown={(e) => { g.current = { x: e.clientX, p: pos, moved: false }; }}
        onPointerMove={(e) => {
          const s = g.current; if (s.x == null) return;
          const d = (e.clientX - s.x) / gap;
          if (Math.abs(d) > 0.06) s.moved = true;
          if (s.moved) { setDrag(true); setPos(clamp(s.p - d)); }
        }}
        onPointerUp={() => { const s = g.current; if (s.x == null) return; s.x = null; if (s.moved) snap(pos); }}
        onPointerCancel={() => { g.current.x = null; snap(pos); }}
      >
        <svg aria-hidden width="100%" height="100%" viewBox="0 0 800 360" preserveAspectRatio="none" className="absolute inset-0 pointer-events-none">
          <path className="flow-line" d="M-20 330 C 90 330 170 250 260 250 S 340 246 400 246 S 520 248 540 250 S 700 330 820 330" fill="none" stroke="#C77A2E" strokeOpacity=".7" strokeWidth="2" strokeDasharray="6 10" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {spaces.map((s, i) => {
          let o = wrap(i - pos); if (o > n / 2) o -= n;
          const a = Math.abs(o);
          const hidden = a > 2.6;
          const tf = `translate(${Math.round(o * gap)}px, ${Math.round(top + lift * (1 - Math.cos(Math.min(a, 2.8) * 0.85)))}px) rotate(${(o * 8).toFixed(2)}deg) scale(${(1 - Math.min(a, 3) * 0.11).toFixed(3)})`;
          return (
            <Link key={s.key} href={s.href} className="space-card glass-light"
              aria-current={i === cur ? "true" : undefined}
              tabIndex={hidden ? -1 : 0}
              onFocus={() => { if (i !== cur) snap(pos + o); }}
              onClick={(e) => { if (g.current.moved) { e.preventDefault(); g.current.moved = false; return; } if (i !== cur) { e.preventDefault(); snap(pos + o); } }}
              style={{ transform: tf, opacity: hidden ? 0 : 1 - Math.min(a, 2) * 0.22, zIndex: 100 - Math.round(a * 10), pointerEvents: hidden ? "none" : undefined,
                transition: drag || a > 2.4 ? "none" : "transform .5s cubic-bezier(.2,.9,.3,1), opacity .35s ease" }}>
              <span className="ico" style={{ background: s.tint, ["--paper" as string]: "#FFF8EC" }}><Glyph kind={s.glyph} size={wide ? 28 : 24} color="#26331F" accent="#8A4A12" /></span>
              <span className="relative mt-auto font-bold text-[19px] md:text-[23px]" style={{ fontFamily: "var(--font-display)" }}>{s.name}</span>
              <span className="relative mt-0.5 text-[13px] md:text-[14px] font-semibold muted">{s.stat}</span>
            </Link>
          );
        })}
      </div>
      <div className="flex items-center justify-between md:justify-center gap-5 mt-1">
        <button type="button" onClick={() => snap(pos - 1)} aria-label="Previous space" className="glass-light w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-40">
          <svg className="relative" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <div className="flex gap-1.5" aria-hidden>
          {spaces.map((s, i) => <span key={s.key} className="h-1.5 rounded-full transition-all" style={{ width: i === cur ? 18 : 6, background: i === cur ? "var(--spaces-ink)" : "rgba(30,36,24,.22)" }} />)}
        </div>
        <button type="button" onClick={() => snap(pos + 1)} aria-label="Next space" className="glass-light w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-40">
          <svg className="relative" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>
      <p className="sr-only" aria-live="polite">{spaces[cur]?.name}: {spaces[cur]?.stat}</p>
    </div>
  );
}
