"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Glyph, type GlyphKind } from "./Glyph";
import { api, ApiError, toast } from "./api";
import { useSizes } from "@/lib/sizes";

export type StackCard = { key: string; href: string; label: string; glyph: GlyphKind; d: string; stat?: string };
export type StackGroup = { title: string; tint: string; custom: boolean; cards: StackCard[] };

const LONG_PRESS_MS = 600;

function Grip() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M5 8h14M5 12h14M5 16h14" /></svg>;
}

/**
 * Spaces as wallet stacks: every section starts stacked; tap a stack to fan it out.
 * Search filters across every section. Press and hold any space to start reordering: drag the three-line
 * grips to move sections and spaces, then tap Done to save the order.
 */
export function SpacesStacks({ groups: initial }: { groups: StackGroup[] }) {
  const router = useRouter();
  const k = useSizes().stackCards;
  const CARD_H = Math.round(112 * k), OPEN_STEP = Math.round(122 * k), CLOSED_STEP = Math.round(48 * k);
  const [groups, setGroups] = useState(initial);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [reorder, setReorder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cardDrag, setCardDrag] = useState<{ key: string; dy: number } | null>(null);
  const [secDrag, setSecDrag] = useState<string | null>(null);

  const press = useRef<{ t?: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean }>({ x: 0, y: 0, fired: false });
  const cd = useRef<{ gi: number; idx: number; startY: number } | null>(null);
  const sd = useRef<{ title: string; px: number; py: number; ox: number; oy: number; x: number; y: number } | null>(null);
  const secEls = useRef<Record<string, HTMLElement | null>>({});

  const query = q.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!query) return groups;
    return groups
      .map((g) => ({ ...g, cards: g.title.toLowerCase().includes(query) ? g.cards : g.cards.filter((c) => `${c.label} ${c.d} ${c.stat ?? ""}`.toLowerCase().includes(query)) }))
      .filter((g) => g.cards.length > 0);
  }, [groups, query]);
  const total = shown.reduce((a, g) => a + g.cards.length, 0);

  const moveTo = <T,>(xs: T[], from: number, to: number) => { const c = xs.slice(); const [x] = c.splice(from, 1); c.splice(to, 0, x); return c; };

  // ---- Long press on a space starts reorder mode ----
  const cancelPress = () => clearTimeout(press.current.t);
  const startPress = (e: React.PointerEvent) => {
    if (reorder) return;
    cancelPress();
    press.current = { x: e.clientX, y: e.clientY, fired: false };
    press.current.t = setTimeout(() => {
      press.current.fired = true;
      setQ(""); setReorder(true);
      navigator.vibrate?.(12);
    }, LONG_PRESS_MS);
  };
  const movePress = (e: React.PointerEvent) => {
    if (Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) cancelPress();
  };

  // ---- Drag a card by its grip (within its section) ----
  const cardDown = (e: React.PointerEvent, gi: number, ci: number, key: string) => {
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    cd.current = { gi, idx: ci, startY: e.clientY };
    setCardDrag({ key, dy: 0 });
  };
  const cardMove = (e: React.PointerEvent) => {
    const d = cd.current; if (!d) return;
    const n = groups[d.gi].cards.length;
    const target = Math.max(0, Math.min(n - 1, Math.round(d.idx + (e.clientY - d.startY) / OPEN_STEP)));
    if (target !== d.idx) {
      const from = d.idx;
      setGroups((gs) => gs.map((g, i) => (i === d.gi ? { ...g, cards: moveTo(g.cards, from, target) } : g)));
      d.startY += (target - from) * OPEN_STEP; d.idx = target;
      navigator.vibrate?.(6);
    }
    setCardDrag((c) => (c ? { ...c, dy: e.clientY - d.startY } : c));
  };
  const cardUp = () => { cd.current = null; setCardDrag(null); };

  // ---- Drag a whole section by the grip next to its title ----
  const placeSection = () => {
    const d = sd.current; if (!d) return;
    const el = secEls.current[d.title]; if (!el) return;
    el.style.transform = `translate(${d.x - d.px - (el.offsetLeft - d.ox)}px, ${d.y - d.py - (el.offsetTop - d.oy)}px)`;
  };
  useLayoutEffect(placeSection, [groups, secDrag, k]);
  const secDown = (e: React.PointerEvent, title: string) => {
    e.preventDefault(); e.stopPropagation();
    const el = secEls.current[title]; if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    sd.current = { title, px: e.clientX, py: e.clientY, ox: el.offsetLeft, oy: el.offsetTop, x: e.clientX, y: e.clientY };
    setSecDrag(title);
  };
  const secMove = (e: React.PointerEvent) => {
    const d = sd.current; if (!d) return;
    d.x = e.clientX; d.y = e.clientY;
    const cur = groups.findIndex((g) => g.title === d.title);
    for (let j = 0; j < groups.length; j++) {
      if (j === cur) continue;
      const el = secEls.current[groups[j].title]; if (!el) continue;
      const r = el.getBoundingClientRect();
      const inside = d.x >= r.left && d.x <= r.right && d.y >= r.top && d.y <= r.bottom;
      const past = j > cur ? d.y > r.top + r.height / 2 : d.y < r.top + r.height / 2;
      if (inside && past) { setGroups((gs) => moveTo(gs, cur, j)); navigator.vibrate?.(6); return; }
    }
    placeSection();
  };
  const secUp = () => {
    const d = sd.current; if (!d) return;
    const el = secEls.current[d.title]; if (el) el.style.transform = "";
    sd.current = null; setSecDrag(null);
  };

  async function save() {
    setSaving(true);
    try {
      await api("/api/ops/spaces.order", { sections: groups.map((g) => g.title), cards: Object.fromEntries(groups.map((g) => [g.title, g.cards.map((c) => c.key)])) });
      toast("Order saved");
      setReorder(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't save the order. Try again.", "error");
    } finally { setSaving(false); }
  }

  return (
    <div className={reorder ? "reordering" : undefined}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {reorder ? (
          <>
            <span className="t-small font-bold flex-1">Reordering</span>
            <button type="button" className="btn" onClick={() => { setGroups(initial); setReorder(false); }} disabled={saving}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Done"}</button>
          </>
        ) : (
          <label className="glass flex items-center gap-2 rounded-full pl-4 pr-2 py-1 flex-1 min-w-[200px]">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="opacity-70 shrink-0"><path d="M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM16 16l4 4" /></svg>
            <span className="sr-only">Search spaces</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search spaces"
              className="flex-1 min-w-0 bg-transparent border-0 outline-none py-2 text-[15px]" style={{ color: "inherit", font: "inherit" }} />
          </label>
        )}
      </div>
      {query && <p className="t-meta mb-2" aria-live="polite">{total ? `${total} space${total === 1 ? "" : "s"} found` : "No spaces match. Try another word."}</p>}

      <div className="grid gap-x-6 md:grid-cols-2 items-start">
      {shown.map((g) => {
        const gi = groups.findIndex((x) => x.title === g.title);
        const lifted = secDrag === g.title;
        const fanned = (reorder && !secDrag) || !!query || (!reorder && !!open[g.title]);
        const step = fanned ? OPEN_STEP : CLOSED_STEP;
        return (
          <section key={g.title} ref={(el) => { secEls.current[g.title] = el; }} aria-labelledby={`st-${gi}`}
            className={`mt-7 min-w-0 relative ${lifted ? "dragging" : ""}`} style={{ zIndex: lifted ? 30 : undefined }}>
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.tint, boxShadow: `0 0 12px ${g.tint}` }} aria-hidden />
              <h2 id={`st-${gi}`} className="t-label">{g.title}</h2>
              <span className="t-meta">{g.cards.length}</span>
              {reorder ? (
                <button type="button" className="grip ml-auto" aria-label={`Drag to move ${g.title}`}
                  onPointerDown={(e) => secDown(e, g.title)} onPointerMove={secMove} onPointerUp={secUp} onPointerCancel={secUp}
                  onKeyDown={(e) => { if (e.key === "ArrowUp" && gi > 0) setGroups((gs) => moveTo(gs, gi, gi - 1)); if (e.key === "ArrowDown" && gi < groups.length - 1) setGroups((gs) => moveTo(gs, gi, gi + 1)); }}>
                  <Grip />
                </button>
              ) : !query && g.cards.length > 1 && (
                <button type="button" className="ml-auto t-small font-bold underline-offset-4 hover:underline" aria-expanded={fanned}
                  onClick={() => setOpen((o) => ({ ...o, [g.title]: !o[g.title] }))}>{fanned ? "Stack" : "Fan out"}</button>
              )}
            </div>
            <div className="relative" style={{ height: (g.cards.length - 1) * step + CARD_H, transition: "height .45s cubic-bezier(.3,1.3,.5,1)" }}>
              {g.cards.map((c, ci) => {
                const dragging = cardDrag?.key === c.key;
                return (
                <div key={c.key} className={`absolute left-0 right-0 ${dragging ? "dragging" : ""}`}
                  style={{ top: ci * step + (dragging ? cardDrag.dy : 0), height: CARD_H, zIndex: dragging ? 50 : ci + 1, transition: dragging ? "none" : "top .45s cubic-bezier(.3,1.3,.5,1)" }}>
                  <Link href={c.href} className="tile no-callout flex flex-col h-full" style={{ ["--card-tint" as string]: g.tint, minHeight: 0, padding: "14px 16px" }}
                    draggable={false}
                    onPointerDown={startPress} onPointerMove={movePress} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}
                    onContextMenu={(e) => e.preventDefault()}
                    onClick={(e) => {
                      if (press.current.fired) { e.preventDefault(); press.current.fired = false; return; }
                      if (reorder) { e.preventDefault(); return; }
                      if (!fanned) { e.preventDefault(); setOpen((o) => ({ ...o, [g.title]: true })); }
                    }}
                    onFocus={() => { if (!fanned && !reorder) setOpen((o) => ({ ...o, [g.title]: true })); }}
                    tabIndex={reorder ? -1 : undefined}>
                    <span className="flex items-center gap-2.5">
                      <span className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-[10px] shrink-0"
                        style={{ background: `radial-gradient(circle at 35% 28%, #FFF8EC, ${g.tint})`, ["--paper" as string]: "#FFF8EC", boxShadow: "inset 0 1px 1px rgba(255,255,255,.7)" }}>
                        <Glyph kind={c.glyph} size={18} color="#26331F" accent="#8A4A12" />
                      </span>
                      <span className="font-bold text-[15px] truncate">{c.label}</span>
                      {!reorder && <span className="ml-auto t-meta shrink-0">Open →</span>}
                    </span>
                    {c.stat && <span className="mt-auto pt-2 text-[14px] font-semibold leading-snug text-ink-2 line-clamp-2 break-words">{c.stat}</span>}
                  </Link>
                  {reorder && (
                    <button type="button" className="grip absolute right-2.5 top-2 z-10" aria-label={`Drag to move ${c.label}`}
                      onPointerDown={(e) => cardDown(e, gi, ci, c.key)} onPointerMove={cardMove} onPointerUp={cardUp} onPointerCancel={cardUp}
                      onKeyDown={(e) => {
                        const to = e.key === "ArrowUp" ? ci - 1 : e.key === "ArrowDown" ? ci + 1 : -1;
                        if (to >= 0 && to < g.cards.length) { e.preventDefault(); setGroups((gs) => gs.map((x, i) => (i === gi ? { ...x, cards: moveTo(x.cards, ci, to) } : x))); }
                      }}>
                      <Grip />
                    </button>
                  )}
                </div>
                );
              })}
            </div>
          </section>
        );
      })}
      </div>
    </div>
  );
}
