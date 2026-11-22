"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Glyph, type GlyphKind } from "./Glyph";
import { Icon } from "./icons";
import { api, ApiError, toast } from "./api";
import { OpForm, PanelClose, PlusIcon, RevealCtx, type FieldDef } from "./OpForm";
import { frequent } from "@/lib/visits";
import { MAX_PINS } from "@/lib/spaces";

const PIN_DEFAULTS = ["/admin/documents", "/finance/charity", "/quran"];

/** How to edit or delete a space from the press-and-hold view (the same op and form as on the space's own page). */
export type CardEdit = { op: string; fixed: Record<string, unknown>; fields: FieldDef[]; initial: Record<string, unknown>; del: { op: string; input: Record<string, unknown>; confirm: string } };
export type StackCard = { key: string; href: string; label: string; glyph: GlyphKind; d: string; stat?: string; needs?: boolean; edit?: CardEdit };
export type StackGroup = { title: string; tint: string; custom: boolean; cards: StackCard[] };

const LONG_PRESS_MS = 600;

function Grip() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M5 8h14M5 12h14M5 16h14" /></svg>;
}

/** Newest pin goes on the left; with three already pinned, the right-most one drops off. */
const withPin = (pins: string[], href: string) => [href, ...pins.filter((h) => h !== href)].slice(0, MAX_PINS);

/**
 * Spaces as quiet icon tiles, grouped by section. Search filters across every section.
 * Right-click a space to pin it (up to three); tap the pin on a pinned card to unpin it.
 * Press and hold any space to rearrange: spaces turn into rows you can drag (and edit or delete with the icons),
 * and each section heading gets its own grip so sections move in the same view. Tap Done to save.
 * Swiping back (or the back button) while rearranging just leaves rearranging, staying on Spaces.
 */
export function SpacesStacks({ groups: initial, pins: savedPins, addFields, addInitial, focus }: {
  groups: StackGroup[]; pins: string[] | null; addFields?: FieldDef[]; addInitial?: Record<string, unknown>;
  /** a section title or a space's href to scroll to (e.g. when a space is tapped on Home) */ focus?: string;
}) {
  const router = useRouter();
  const STEP = 60, ROW_H = 52;
  const [groups, setGroups] = useState(initial);
  const [q, setQ] = useState("");
  const [reorder, setReorder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cardDrag, setCardDrag] = useState<{ key: string; dy: number } | null>(null);
  const [secDrag, setSecDrag] = useState<{ title: string; dy: number } | null>(null);
  const [editing, setEditing] = useState<StackCard | null>(null);
  const [deleting, setDeleting] = useState<StackCard | null>(null);
  const [adding, setAdding] = useState(false);
  const [focusHref, setFocusHref] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Keep up with the server: a space added (or renamed, or deleted) shows up straight away, without a reload.
  // While rearranging, keep the order the owner has dragged so far and just take in the edits.
  useEffect(() => {
    if (cd.current || sd.current) return;
    setGroups((cur) => (reorder ? mergeKeepingOrder(cur, initial) : initial));
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rearranging gets its own history entry, so swiping back (or the back button) only leaves rearranging.
  const pushed = useRef(false);
  const startReorder = () => {
    setQ(""); setAdding(false); setReorder(true);
    if (!pushed.current) { window.history.pushState(null, "", window.location.pathname); pushed.current = true; }
  };
  const endReorder = (keep: boolean) => {
    if (!keep) setGroups(initial);
    setReorder(false); setEditing(null); setDeleting(null);
    if (pushed.current) { pushed.current = false; window.history.back(); }
  };
  useEffect(() => {
    const onPop = () => {
      if (!pushed.current) return;
      pushed.current = false;
      setGroups(initial); setReorder(false); setEditing(null); setDeleting(null); setSecDrag(null);
      if (window.location.pathname !== "/more") router.replace("/more");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [initial, router]);

  // After adding a space, scroll to it once it's on the page and give it a brief glow.
  useEffect(() => {
    if (!focusHref) return;
    const el = document.querySelector(`[data-space="${CSS.escape(focusHref)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(focusHref); setFocusHref(null);
  }, [focusHref, groups]);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 2400); return () => clearTimeout(t); }, [flash]);

  // Opened from a Home tile: scroll to that section or space, give it a short glow, then tidy the address.
  useEffect(() => {
    if (!focus) return;
    const el = document.querySelector<HTMLElement>(`[data-space="${CSS.escape(focus)}"], [data-section="${CSS.escape(focus)}"]`);
    window.history.replaceState(null, "", "/more");
    if (!el) return;
    requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: el.dataset.section ? "start" : "center" }));
    if (el.dataset.space) setFlash(focus);
    else { el.classList.add("section-flash"); setTimeout(() => el.classList.remove("section-flash"), 2400); }
  }, [focus]);

  // Pinned: the owner's own picks once they've pinned anything; until then, the three spaces opened most on this device.
  const [autoPins, setAutoPins] = useState(PIN_DEFAULTS);
  useEffect(() => setAutoPins([...new Set([...frequent().map((f) => f.href), ...PIN_DEFAULTS])]), []);
  const [pins, setPins] = useState<string[] | null>(savedPins);
  const savedKey = JSON.stringify(savedPins);
  useEffect(() => setPins(savedPins), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const allCards = groups.flatMap((g) => g.cards);
  const pinned = (pins ?? autoPins).map((h) => allCards.find((c) => c.href === h)).filter((c): c is StackCard => !!c).slice(0, MAX_PINS);
  const pinnedHrefs = pinned.map((c) => c.href);
  const isPinned = (href: string) => pinnedHrefs.includes(href);

  const [menu, setMenu] = useState<{ href: string; x: number; y: number } | null>(null);
  const [unpinFor, setUnpinFor] = useState<string | null>(null);
  useEffect(() => {
    if (!menu && !unpinFor) return;
    const close = () => { setMenu(null); setUnpinFor(null); };
    const off = (e: PointerEvent) => { if (!(e.target as Element).closest?.("[data-pin-pop]")) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", off);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", close); window.removeEventListener("resize", close); };
  }, [menu, unpinFor]);

  async function savePins(next: string[], message: string) {
    const prev = pins;
    setPins(next); setMenu(null); setUnpinFor(null);
    try {
      await api("/api/ops/spaces.pins", { hrefs: next });
      toast(message);
    } catch (e) {
      setPins(prev);
      toast(e instanceof ApiError ? e.message : "Couldn't change your pins. Try again.", "error");
    }
  }
  const labelOf = (href: string) => allCards.find((c) => c.href === href)?.label ?? "Space";
  const pin = (href: string) => savePins(withPin(pinnedHrefs, href), `Pinned ${labelOf(href)}`);
  const unpin = (href: string) => savePins(pinnedHrefs.filter((h) => h !== href), `Unpinned ${labelOf(href)}`);

  const press = useRef<{ t?: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean }>({ x: 0, y: 0, fired: false });
  const pointerKind = useRef<string>("mouse");
  const cd = useRef<{ gi: number; idx: number; startY: number } | null>(null);
  const sd = useRef<{ idx: number; startY: number } | null>(null);
  const secBox = useRef<HTMLDivElement | null>(null);
  const sectionCount = useRef(initial.length);
  sectionCount.current = groups.length;

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
    pointerKind.current = e.pointerType;
    if (reorder || e.button !== 0) return;
    cancelPress();
    press.current = { x: e.clientX, y: e.clientY, fired: false };
    press.current.t = setTimeout(() => { press.current.fired = true; startReorder(); navigator.vibrate?.(12); }, LONG_PRESS_MS);
  };
  const movePress = (e: React.PointerEvent) => { if (Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) cancelPress(); };
  // ---- Right-click (or the keyboard menu key) on a space opens the pin menu. A finger's long press stays "reorder". ----
  const openMenu = (e: React.MouseEvent, href: string) => {
    e.preventDefault();
    if (pointerKind.current === "touch") return;
    cancelPress();
    let { clientX: x, clientY: y } = e;
    if (!x && !y) { const r = e.currentTarget.getBoundingClientRect(); x = r.left + r.width / 2; y = r.bottom; }
    setUnpinFor(null);
    setMenu({ href, x, y });
  };

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

  // ---- Drag a whole section by the grip on its heading: the sections fold down to their headings while you drag ----
  const SEC = 52;
  const secDown = (e: React.PointerEvent, gi: number, title: string) => {
    e.preventDefault(); e.stopPropagation();
    const y = e.clientY;
    sd.current = { idx: gi, startY: y };
    setSecDrag({ title, dy: 0 });
    navigator.vibrate?.(10);
    // Once folded, bring the heading being dragged under the finger.
    requestAnimationFrame(() => {
      const box = secBox.current; if (!box) return;
      window.scrollBy({ top: box.getBoundingClientRect().top + gi * SEC + SEC / 2 - y });
    });
    const move = (ev: PointerEvent) => {
      const d = sd.current; if (!d) return;
      ev.preventDefault();
      const target = Math.max(0, Math.min(sectionCount.current - 1, Math.round(d.idx + (ev.clientY - d.startY) / SEC)));
      if (target !== d.idx) {
        const from = d.idx; d.startY += (target - from) * SEC; d.idx = target; navigator.vibrate?.(6);
        setGroups((gs) => moveTo(gs, from, target));
      }
      const dy = ev.clientY - d.startY;
      setSecDrag((x) => (x ? { ...x, dy } : x));
    };
    const up = () => {
      sd.current = null; setSecDrag(null);
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move, { passive: false }); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };
  const moveSection = (gi: number, to: number) => { if (to >= 0 && to < groups.length) setGroups((gs) => moveTo(gs, gi, to)); };

  async function removeSpace(c: StackCard) {
    if (!c.edit) return;
    setSaving(true);
    try {
      await api(`/api/ops/${c.edit.del.op}`, c.edit.del.input);
      setGroups((gs) => gs.map((g) => ({ ...g, cards: g.cards.filter((x) => x.key !== c.key) })).filter((g) => g.cards.length > 0));
      setDeleting(null);
      toast(`${c.label} removed`);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't remove it. Try again.", "error");
    } finally { setSaving(false); }
  }

  async function save(gs: StackGroup[] = groups) {
    setSaving(true);
    try {
      await api("/api/ops/spaces.order", { sections: gs.map((g) => g.title), cards: Object.fromEntries(gs.map((g) => [g.title, g.cards.map((c) => c.key)])) });
      toast("Order saved");
      setGroups(gs); endReorder(true);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't save the order. Try again.", "error");
    } finally { setSaving(false); }
  }

  const menuCard = menu ? allCards.find((c) => c.href === menu.href) : undefined;
  const bumped = menu && !isPinned(menu.href) && pinnedHrefs.length >= MAX_PINS ? labelOf(pinnedHrefs[pinnedHrefs.length - 1]) : null;

  return (
    <div>
      <div className="flex items-center gap-2">
        {reorder ? (
          <>
            <span className="t-small font-semibold flex-1">Drag the grips to rearrange</span>
            <button type="button" className="btn" onClick={() => endReorder(false)} disabled={saving}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => save()} disabled={saving}>{saving ? "Saving…" : "Done"}</button>
          </>
        ) : (
          <label className="flex items-center gap-2 rounded-full pl-4 pr-2 py-0.5 flex-1 min-w-0" style={{ boxShadow: "inset 0 0 0 1px var(--hair)", background: "var(--field-bg)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="opacity-60 shrink-0"><path d="M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM16 16l4 4" /></svg>
            <span className="sr-only">Search spaces</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search spaces"
              className="flex-1 min-w-0 bg-transparent border-0 outline-none py-2 text-[15px]" style={{ color: "inherit", font: "inherit" }} />
          </label>
        )}
        {!reorder && addFields && (
          <button type="button" className="plus-btn" aria-label={adding ? "Close" : "Add a space"} title="Add a space" aria-expanded={adding} aria-controls="add-space" onClick={() => setAdding(!adding)}>
            <PlusIcon size={22} />
          </button>
        )}
      </div>
      {adding && !reorder && addFields && (
        <div className="center-panel-wrap mt-3">
          <div id="add-space" className="panel center-panel panel-closable p-4 md:p-5 preview-enter">
            <PanelClose onClick={() => setAdding(false)} label="Close add a space" />
            <p className="t-h3 mb-3 pr-10">Add a space</p>
            <RevealCtx.Provider value={{ close: () => setAdding(false) }}>
              <OpForm op="space.create" fields={addFields} initial={addInitial} submitLabel="Add space" compact
                onDone={(r) => { if (r.id) { setQ(""); setFocusHref(`/spaces/${r.id}`); } }} />
            </RevealCtx.Provider>
          </div>
        </div>
      )}
      {!reorder && !query && <p className="t-meta mt-2">Press and hold a space to rearrange, edit or delete.</p>}
      {!reorder && !query && pinned.length > 0 && (
        <section aria-labelledby="pin-h" className="mt-7">
          <h2 id="pin-h" className="t-label mb-3">Pinned</h2>
          <ul className="pins">
            {pinned.map((c) => (
              <li key={c.key} className="relative min-w-0">
                <Link href={c.href} className="pin-card" onContextMenu={(e) => openMenu(e, c.href)} onPointerDown={(e) => { pointerKind.current = e.pointerType; }}>
                  <span className="ic"><Glyph kind={c.glyph} size={18} color="currentColor" accent="currentColor" /></span>
                  <span className="mt-auto font-semibold text-[14px] leading-snug pr-6">{c.label}</span>
                  {c.stat && <span className="pin-stat">{c.stat}</span>}
                </Link>
                <button type="button" className="pin-mark" data-pin-pop aria-label={`${c.label} is pinned. Pin options`} aria-expanded={unpinFor === c.href}
                  onClick={() => { setMenu(null); setUnpinFor(unpinFor === c.href ? null : c.href); }}>
                  <Icon name="pin" size={15} strokeWidth={2.2} />
                </button>
                {unpinFor === c.href && (
                  <div className="pin-pop pin-pop-anchored preview-enter" data-pin-pop role="menu" aria-label={`${c.label} pin options`}>
                    <button type="button" role="menuitem" className="pin-pop-item" autoFocus onClick={() => unpin(c.href)}>
                      <Icon name="pin" size={15} />Unpin
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {query && <p className="t-meta mt-2" aria-live="polite">{total ? `${total} space${total === 1 ? "" : "s"} found` : "No spaces match. Try another word."}</p>}

      {reorder && secDrag ? (
        // Dragging a section: just the headings, to move as a whole.
        <div ref={secBox} className="relative no-callout mt-7" style={{ height: groups.length * SEC, touchAction: "none" }}>
          {groups.map((g, i) => {
            const dragging = secDrag.title === g.title;
            return (
              <div key={g.title} className="absolute left-0 right-0 flex items-center gap-3 px-3 rounded-[16px] sorter-row"
                style={{ top: i * SEC + (dragging ? secDrag.dy : 0), height: SEC - 8, zIndex: dragging ? 10 : 1,
                  transition: dragging ? "none" : "top .3s cubic-bezier(.3,1.3,.5,1)", boxShadow: dragging ? "0 16px 30px -12px rgba(0,0,0,.45)" : undefined }}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.tint }} aria-hidden />
                <span className="font-bold flex-1 truncate">{g.title}</span>
                <span className="t-meta">{g.cards.length}</span>
                <span className="opacity-70" aria-hidden><Grip /></span>
              </div>
            );
          })}
        </div>
      ) : (
      <div className={reorder ? "grid gap-x-8 md:grid-cols-2 items-start" : ""}>
      {shown.map((g) => {
        const gi = groups.findIndex((x) => x.title === g.title);
        return (
          <section key={g.title} aria-labelledby={`st-${gi}`} data-section={g.title} className="mt-7 min-w-0 scroll-mt-24">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: g.tint }} aria-hidden />
              <h2 id={`st-${gi}`} className="t-label flex-1">{g.title}</h2>
              {reorder && groups.length > 1 && (
                <button type="button" className="grip" style={{ touchAction: "none" }} aria-label={`Drag to move the ${g.title} section. Arrow keys move it too.`}
                  onPointerDown={(e) => secDown(e, gi, g.title)}
                  onKeyDown={(e) => {
                    const to = e.key === "ArrowUp" ? gi - 1 : e.key === "ArrowDown" ? gi + 1 : -1;
                    if (to >= 0) { e.preventDefault(); moveSection(gi, to); }
                  }}>
                  <Grip />
                </button>
              )}
            </div>
            {reorder ? (
              <div className="relative no-callout" style={{ height: g.cards.length * STEP - (STEP - ROW_H) }}>
                {g.cards.map((c, ci) => {
                  const dragging = cardDrag?.key === c.key;
                  const on = isPinned(c.href);
                  return (
                    <div key={c.key} className="space-row absolute left-0 right-0"
                      style={{ top: ci * STEP + (dragging ? cardDrag.dy : 0), height: ROW_H, zIndex: dragging ? 20 : 1,
                        transition: dragging ? "none" : "top .3s cubic-bezier(.3,1.3,.5,1)", boxShadow: dragging ? "0 16px 30px -12px rgba(0,0,0,.4)" : undefined }}>
                      <span className="ic"><Glyph kind={c.glyph} size={17} color="currentColor" accent="currentColor" /></span>
                      <span className="flex-1 truncate text-[14px] font-semibold">{c.label}</span>
                      <button type="button" className={`row-pin ${on ? "on" : ""}`} aria-pressed={on} aria-label={on ? `Unpin ${c.label}` : `Pin ${c.label}`} title={on ? "Unpin" : "Pin"}
                        onClick={() => (on ? unpin(c.href) : pin(c.href))}>
                        <Icon name="pin" size={16} />
                      </button>
                      {c.edit && (
                        <>
                          <button type="button" className="row-pin" aria-label={`Edit ${c.label}`} title="Edit" onClick={() => { setDeleting(null); setEditing(c); }}>
                            <Icon name="edit" size={16} />
                          </button>
                          <button type="button" className="row-pin row-del" aria-label={`Delete ${c.label}`} title="Delete" onClick={() => { setEditing(null); setDeleting(c); }}>
                            <Icon name="trash" size={16} />
                          </button>
                        </>
                      )}
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
                    <Link href={c.href} data-space={c.href} className={`sp-tile no-callout ${flash === c.href ? "just-added" : ""}`} draggable={false} title={c.stat ? `${c.label} · ${c.stat}` : c.label}
                      onPointerDown={startPress} onPointerMove={movePress} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}
                      onContextMenu={(e) => openMenu(e, c.href)}
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
      )}
      {editing?.edit && (
        <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center p-3" role="dialog" aria-modal="true" aria-labelledby="edit-space-h">
          <div className="absolute inset-0" style={{ background: "rgba(20,26,21,.45)" }} onClick={() => setEditing(null)} />
          <div className="relative panel panel-closable w-full max-w-lg p-4 md:p-5 preview-enter max-h-[88dvh] overflow-y-auto" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
            <PanelClose onClick={() => setEditing(null)} label="Close editing" />
            <p id="edit-space-h" className="t-h3 mb-3 pr-10">Edit {editing.label}</p>
            <RevealCtx.Provider value={{ close: () => setEditing(null) }}>
              <OpForm op={editing.edit.op} fields={editing.edit.fields} fixed={editing.edit.fixed} initial={editing.edit.initial} compact submitLabel="Save"
                onDone={() => { setEditing(null); router.refresh(); }} />
            </RevealCtx.Provider>
          </div>
        </div>
      )}
      {deleting?.edit && (
        <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center p-3" role="alertdialog" aria-modal="true" aria-labelledby="del-space-h">
          <div className="absolute inset-0" style={{ background: "rgba(20,26,21,.45)" }} onClick={() => !saving && setDeleting(null)} />
          <div className="relative panel w-full max-w-md p-4 md:p-5 preview-enter" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
            <p id="del-space-h" className="t-h3 mb-2 flex items-center gap-2"><Icon name="trash" size={18} />Delete {deleting.label}?</p>
            <p className="t-small text-ink-2 mb-4">{deleting.edit.del.confirm}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setDeleting(null)} disabled={saving} autoFocus>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={() => removeSpace(deleting)} disabled={saving}>{saving ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        </div>
      )}
      {menu && menuCard && (
        <div className="pin-pop preview-enter" data-pin-pop role="menu" aria-label={`${menuCard.label} options`}
          style={{ position: "fixed", left: Math.max(8, Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 400) - 208)), top: Math.max(8, Math.min(menu.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 96)) }}>
          {isPinned(menu.href) ? (
            <button type="button" role="menuitem" className="pin-pop-item" autoFocus onClick={() => unpin(menu.href)}><Icon name="pin" size={15} />Unpin</button>
          ) : (
            <>
              <button type="button" role="menuitem" className="pin-pop-item" autoFocus onClick={() => pin(menu.href)}><Icon name="pin" size={15} />Pin</button>
              {bumped && <p className="t-meta px-3 pb-1.5">Replaces {bumped}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** While rearranging: keep the dragged order, take in renamed/re-iconed/moved spaces, drop deleted ones, add new ones at the end. */
function mergeKeepingOrder(cur: StackGroup[], next: StackGroup[]): StackGroup[] {
  const nextCards = new Map(next.flatMap((g) => g.cards.map((c) => [c.key, { c, title: g.title }] as const)));
  const titles = [...cur.map((g) => g.title).filter((t) => next.some((g) => g.title === t)), ...next.map((g) => g.title).filter((t) => !cur.some((g) => g.title === t))];
  return titles.map((t) => {
    const fresh = next.find((g) => g.title === t)!;
    const kept = (cur.find((g) => g.title === t)?.cards ?? []).filter((c) => nextCards.get(c.key)?.title === t).map((c) => nextCards.get(c.key)!.c);
    const added = fresh.cards.filter((c) => !kept.some((k) => k.key === c.key));
    return { ...fresh, cards: [...kept, ...added] };
  }).filter((g) => g.cards.length > 0);
}
