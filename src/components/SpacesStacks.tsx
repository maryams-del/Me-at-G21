"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Glyph, type GlyphKind } from "./Glyph";
import { api, ApiError, toast } from "./api";
import { frequent } from "@/lib/visits";

const PIN_DEFAULTS = ["/admin/documents", "/finance/charity", "/quran"];

export type StackCard = { key: string; href: string; label: string; glyph: GlyphKind; d: string; stat?: string; needs?: boolean };
export type StackGroup = { title: string; tint: string; custom: boolean; cards: StackCard[] };

const LONG_PRESS_MS = 600;

function Grip() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M5 8h14M5 12h14M5 16h14" /></svg>;
}

/**
 * Spaces as quiet icon tiles, grouped by section. Search filters across every section.
 * Press and hold any space to reorder: the sections turn into lists with three-line grips to drag,
 * then tap Done to save. Tap a section heading to rearrange the sections themselves.
 */
export function SpacesStacks({ groups: initial, addSlot }: { groups: StackGroup[]; addSlot?: React.ReactNode }) {
  const router = useRouter();
  const STEP = 60, ROW_H = 52;
  const [groups, setGroups] = useState(initial);
  const [q, setQ] = useState("");
  const [reorder, setReorder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cardDrag, setCardDrag] = useState<{ key: string; dy: number } | null>(null);
  const [sorting, setSorting] = useState(false);
  // Pinned: the three spaces opened most on this device, topped up with sensible defaults.
  const [pinHrefs, setPinHrefs] = useState(PIN_DEFAULTS);
  useEffect(() => setPinHrefs([...new Set([...frequent().map((f) => f.href), ...PIN_DEFAULTS])]), []);
  const allCards = groups.flatMap((g) => g.cards);
  const pinned = pinHrefs.map((h) => allCards.find((c) => c.href === h)).filter((c): c is StackCard => !!c).slice(0, 3);

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
    press.current.t = setTimeout(() => { press.current.fired = true; setQ(""); setReorder(true); navigator.vibrate?.(12); }, LONG_PRESS_MS);
  };
  const movePress = (e: React.PointerEvent) => { if (Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) cancelPress(); };

  // ---- Drag a space by its grip (within its section) ----
  const cardDown = (e: React.PointerEvent, gi: number, ci: number, key: string) => {
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    cd.current = { gi, idx: ci, startY: e.clientY };
    setCardDrag({ key, dy: 0 });
  };
  const cardMove = (e: React.PointerEvent) => {
    const d = cd.current; if (!d) return;
    const n = groups[d.gi].cards.length;
    const target = Math.max(0, Math.min(n - 1, Math.round(d.idx + (e.clientY - d.startY) / STEP)));
    if (target !== d.idx) {
      const from = d.idx;
      setGroups((gs) => gs.map((g, i) => (i === d.gi ? { ...g, cards: moveTo(g.cards, from, target) } : g)));
      d.startY += (target - from) * STEP; d.idx = target;
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
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {reorder ? (
          <>
            <span className="t-small font-semibold flex-1">Drag the grips to reorder</span>
            <button type="button" className="btn" onClick={() => { setGroups(initial); setReorder(false); }} disabled={saving}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => save()} disabled={saving}>{saving ? "Saving…" : "Done"}</button>
          </>
        ) : (
          <label className="flex items-center gap-2 rounded-full pl-4 pr-2 py-0.5 flex-1 min-w-0 basis-[10rem]" style={{ boxShadow: "inset 0 0 0 1px var(--hair)", background: "var(--field-bg)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="opacity-60 shrink-0"><path d="M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM16 16l4 4" /></svg>
            <span className="sr-only">Search spaces</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search spaces"
              className="flex-1 min-w-0 bg-transparent border-0 outline-none py-2 text-[15px]" style={{ color: "inherit", font: "inherit" }} />
          </label>
        )}
        {!reorder && addSlot}
      </div>
      {!reorder && !query && <p className="t-meta mt-2">A dot means something there needs you. Press and hold a space to reorder.</p>}
      {!reorder && !query && pinned.length > 0 && (
        <section aria-labelledby="pin-h" className="mt-7">
          <h2 id="pin-h" className="t-label mb-3">Pinned</h2>
          <ul className="pins">
            {pinned.map((c) => (
              <li key={c.key}>
                <Link href={c.href} className="pin-card">
                  <span className="ic"><Glyph kind={c.glyph} size={18} color="currentColor" accent="currentColor" /></span>
                  <span className="mt-auto font-semibold text-[14px] leading-snug">{c.label}</span>
                  {c.stat && <span className="pin-stat">{c.stat}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {query && <p className="t-meta mt-2" aria-live="polite">{total ? `${total} space${total === 1 ? "" : "s"} found` : "No spaces match. Try another word."}</p>}

      <div className={reorder ? "grid gap-x-8 md:grid-cols-2 items-start" : ""}>
      {shown.map((g) => {
        const gi = groups.findIndex((x) => x.title === g.title);
        return (
          <section key={g.title} aria-labelledby={`st-${gi}`} className="mt-7 min-w-0">
            <button type="button" className="flex items-center gap-2 mb-4 bg-transparent border-0 p-0 cursor-pointer" style={{ color: "inherit", font: "inherit" }}
              onClick={() => setSorting(true)} aria-label={`${g.title}. Rearrange sections`}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: g.tint }} aria-hidden />
              <h2 id={`st-${gi}`} className="t-label">{g.title}</h2>
            </button>
            {reorder ? (
              <div className="relative no-callout" style={{ height: g.cards.length * STEP - (STEP - ROW_H) }}>
                {g.cards.map((c, ci) => {
                  const dragging = cardDrag?.key === c.key;
                  return (
                    <div key={c.key} className="space-row absolute left-0 right-0"
                      style={{ top: ci * STEP + (dragging ? cardDrag.dy : 0), height: ROW_H, zIndex: dragging ? 20 : 1,
                        transition: dragging ? "none" : "top .3s cubic-bezier(.3,1.3,.5,1)", boxShadow: dragging ? "0 16px 30px -12px rgba(0,0,0,.4)" : undefined }}>
                      <span className="ic"><Glyph kind={c.glyph} size={17} color="currentColor" accent="currentColor" /></span>
                      <span className="flex-1 truncate text-[14px] font-semibold">{c.label}</span>
                      <button type="button" className="grip" aria-label={`Drag to move ${c.label}`}
                        onPointerDown={(e) => cardDown(e, gi, ci, c.key)} onPointerMove={cardMove} onPointerUp={cardUp} onPointerCancel={cardUp}
                        onKeyDown={(e) => {
                          const to = e.key === "ArrowUp" ? ci - 1 : e.key === "ArrowDown" ? ci + 1 : -1;
                          if (to >= 0 && to < g.cards.length) { e.preventDefault(); setGroups((gs) => gs.map((x, i) => (i === gi ? { ...x, cards: moveTo(x.cards, ci, to) } : x))); }
                        }}>
                        <Grip />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <ul className="space-grid">
                {g.cards.map((c) => (
                  <li key={c.key} className="min-w-0">
                    <Link href={c.href} className="sp-tile no-callout" draggable={false} title={c.stat ? `${c.label} · ${c.stat}` : c.label}
                      onPointerDown={startPress} onPointerMove={movePress} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}
                      onContextMenu={(e) => e.preventDefault()}
                      onClick={(e) => { if (press.current.fired) { e.preventDefault(); press.current.fired = false; } }}>
                      <span className="ic"><Glyph kind={c.glyph} size={22} color="currentColor" accent="currentColor" />{c.needs && <span className="need-dot" />}</span>
                      <span>{c.label}{c.needs && <span className="sr-only"> (needs you)</span>}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
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
      <div className="absolute inset-0" style={{ background: "rgba(20,26,21,.45)" }} onClick={onCancel} />
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
