"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Glyph, type GlyphKind } from "./Glyph";
import { api, ApiError, toast } from "./api";
import { useSizes } from "@/lib/sizes";

export type StackCard = { key: string; href: string; label: string; glyph: GlyphKind; d: string; stat?: string };
export type StackGroup = { title: string; tint: string; custom: boolean; cards: StackCard[] };

const LONG_PRESS_MS = 600;
const OPEN_KEY = "g21-stacks-open";

function Grip() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M5 8h14M5 12h14M5 16h14" /></svg>;
}

/**
 * Spaces as wallet stacks: every section starts stacked; tap a stack to fan it out.
 * Search filters across every section. Press and hold any space to start reordering: drag the three-line
 * grips to move sections and spaces, then tap Done to save the order.
 */
export function SpacesStacks({ groups: initial, addSlot }: { groups: StackGroup[]; addSlot?: React.ReactNode }) {
  const router = useRouter();
  const k = useSizes().stackCards;
  const CARD_H = Math.round(112 * k), OPEN_STEP = Math.round(122 * k), CLOSED_STEP = Math.round(48 * k);
  const [groups, setGroups] = useState(initial);
  // Which stacks are fanned out survives going to a space and coming back (Back / swipe).
  const [open, setOpenState] = useState<Record<string, boolean>>({});
  useEffect(() => { try { setOpenState(JSON.parse(sessionStorage.getItem(OPEN_KEY) || "{}")); } catch { /* private mode */ } }, []);
  const setOpen = (f: (o: Record<string, boolean>) => Record<string, boolean>) => setOpenState((o) => {
    const n = f(o); try { sessionStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* private mode */ } return n;
  });
  const [q, setQ] = useState("");
  const [reorder, setReorder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cardDrag, setCardDrag] = useState<{ key: string; dy: number } | null>(null);
  const [sorting, setSorting] = useState(false);

  const press = useRef<{ t?: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean }>({ x: 0, y: 0, fired: false });
  const cd = useRef<{ gi: number; idx: number; startY: number } | null>(null);

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

  async function save(gs: StackGroup[] = groups) {
    setSaving(true);
    try {
      await api("/api/ops/spaces.order", { sections: gs.map((g) => g.title), cards: Object.fromEntries(gs.map((g) => [g.title, g.cards.map((c) => c.key)])) });
      toast("Order saved");
      setGroups(gs); setReorder(false); setSorting(false);
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
            <button type="button" className="btn btn-primary" onClick={() => save()} disabled={saving}>{saving ? "Saving…" : "Done"}</button>
          </>
        ) : (
          <label className="glass flex items-center gap-2 rounded-full pl-4 pr-2 py-1 flex-1 min-w-0 basis-[10rem]">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="opacity-70 shrink-0"><path d="M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM16 16l4 4" /></svg>
            <span className="sr-only">Search spaces</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search spaces"
              className="flex-1 min-w-0 bg-transparent border-0 outline-none py-2 text-[15px]" style={{ color: "inherit", font: "inherit" }} />
          </label>
        )}
        {!reorder && addSlot}
      </div>
      {query && <p className="t-meta mb-2" aria-live="polite">{total ? `${total} space${total === 1 ? "" : "s"} found` : "No spaces match. Try another word."}</p>}

      <div className="grid gap-x-6 md:grid-cols-2 items-start">
      {shown.map((g) => {
        const gi = groups.findIndex((x) => x.title === g.title);
        const fanned = reorder || !!query || !!open[g.title];
        const step = fanned ? OPEN_STEP : CLOSED_STEP;
        return (
          <section key={g.title} aria-labelledby={`st-${gi}`} className="mt-7 min-w-0 relative">
            <div className="flex items-center gap-2.5 mb-3">
              <button type="button" className="flex items-center gap-2.5 min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer" style={{ color: "inherit", font: "inherit" }}
                onClick={() => setSorting(true)} aria-label={`Rearrange sections (${g.title})`}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.tint, boxShadow: `0 0 12px ${g.tint}` }} aria-hidden />
                <h2 id={`st-${gi}`} className="t-label">{g.title}</h2>
                <span className="t-meta">{g.cards.length}</span>
                <span className="opacity-60" aria-hidden><Grip /></span>
              </button>
              {!reorder && !query && g.cards.length > 1 && (
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
      {sorting && <SectionSorter titles={groups.map((g) => g.title)} tints={Object.fromEntries(groups.map((g) => [g.title, g.tint]))} saving={saving}
        onCancel={() => setSorting(false)}
        onSave={(order) => save(order.map((t) => groups.find((g) => g.title === t)!))} />}
    </div>
  );
}

const ROW = 56;

/** Just the section headings, to drag into a new order. */
function SectionSorter({ titles, tints, saving, onCancel, onSave }: { titles: string[]; tints: Record<string, string>; saving: boolean; onCancel: () => void; onSave: (order: string[]) => void }) {
  const [order, setOrder] = useState(titles);
  const [drag, setDrag] = useState<{ title: string; dy: number } | null>(null);
  const d = useRef<{ idx: number; startY: number } | null>(null);
  const moveTo = (xs: string[], from: number, to: number) => { const c = xs.slice(); const [x] = c.splice(from, 1); c.splice(to, 0, x); return c; };

  const down = (e: React.PointerEvent, i: number, title: string) => {
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    d.current = { idx: i, startY: e.clientY }; setDrag({ title, dy: 0 });
  };
  const move = (e: React.PointerEvent) => {
    const s = d.current; if (!s) return;
    const target = Math.max(0, Math.min(order.length - 1, Math.round(s.idx + (e.clientY - s.startY) / ROW)));
    if (target !== s.idx) { const from = s.idx; setOrder((o) => moveTo(o, from, target)); s.startY += (target - from) * ROW; s.idx = target; navigator.vibrate?.(6); }
    setDrag((x) => (x ? { ...x, dy: e.clientY - s.startY } : x));
  };
  const up = () => { d.current = null; setDrag(null); };

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Rearrange sections">
      <div className="absolute inset-0" style={{ background: "rgba(20,24,16,.45)" }} onClick={onCancel} />
      <div className="relative glass w-full max-w-md p-4 rounded-[28px] preview-enter" style={{ background: "color-mix(in srgb, var(--paper) 94%, transparent)", marginBottom: "env(safe-area-inset-bottom)" }}>
        <p className="t-h3 mb-3">Rearrange sections</p>
        <div className="relative no-callout" style={{ height: order.length * ROW }}>
          {order.map((t, i) => {
            const dragging = drag?.title === t;
            return (
              <div key={t} className="absolute left-0 right-0 flex items-center gap-3 px-3 rounded-[16px] glass-light"
                style={{ position: "absolute", top: i * ROW + (dragging ? drag.dy : 0), height: ROW - 8, zIndex: dragging ? 10 : 1, touchAction: "none", cursor: "grab",
                  transition: dragging ? "none" : "top .3s cubic-bezier(.3,1.3,.5,1)", boxShadow: dragging ? "0 16px 30px -12px rgba(0,0,0,.45)" : undefined }}
                onPointerDown={(e) => down(e, i, t)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
                tabIndex={0} aria-label={`${t}, position ${i + 1} of ${order.length}. Use arrow keys to move.`}
                onKeyDown={(e) => {
                  const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : -1;
                  if (to >= 0 && to < order.length) { e.preventDefault(); setOrder((o) => moveTo(o, i, to)); }
                }}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: tints[t] }} aria-hidden />
                <span className="font-bold flex-1 truncate">{t}</span>
                <span className="opacity-70" aria-hidden><Grip /></span>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(order)} disabled={saving}>{saving ? "Saving…" : "Done"}</button>
        </div>
      </div>
    </div>
  );
}
