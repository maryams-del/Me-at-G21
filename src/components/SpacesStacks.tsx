"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Glyph, type GlyphKind } from "./Glyph";
import { api, ApiError, toast } from "./api";

export type StackCard = { key: string; href: string; label: string; glyph: GlyphKind; d: string; stat?: string };
export type StackGroup = { title: string; tint: string; custom: boolean; cards: StackCard[] };

const CARD_H = 112, OPEN_STEP = 122, CLOSED_STEP = 48;

/**
 * Spaces as wallet stacks: each section is a stack of tinted glass cards. Tap a stack to fan it out.
 * Search filters across every section; "Reorder" moves sections and cards up or down and saves the order.
 */
export function SpacesStacks({ groups: initial }: { groups: StackGroup[] }) {
  const router = useRouter();
  const [groups, setGroups] = useState(initial);
  const [open, setOpen] = useState<Record<string, boolean>>(() => (initial[0] ? { [initial[0].title]: true } : {}));
  const [q, setQ] = useState("");
  const [reorder, setReorder] = useState(false);
  const [saving, setSaving] = useState(false);

  const query = q.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!query) return groups;
    return groups
      .map((g) => ({ ...g, cards: g.title.toLowerCase().includes(query) ? g.cards : g.cards.filter((c) => `${c.label} ${c.d} ${c.stat ?? ""}`.toLowerCase().includes(query)) }))
      .filter((g) => g.cards.length > 0);
  }, [groups, query]);
  const total = shown.reduce((a, g) => a + g.cards.length, 0);

  const move = <T,>(xs: T[], i: number, d: number) => { const j = i + d; if (j < 0 || j >= xs.length) return xs; const c = xs.slice(); [c[i], c[j]] = [c[j], c[i]]; return c; };
  const moveSection = (i: number, d: number) => setGroups((gs) => move(gs, i, d));
  const moveCard = (gi: number, ci: number, d: number) => setGroups((gs) => gs.map((g, k) => (k === gi ? { ...g, cards: move(g.cards, ci, d) } : g)));

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
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <label className="glass flex items-center gap-2 rounded-full pl-4 pr-2 py-1 flex-1 min-w-[200px]">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="opacity-70 shrink-0"><path d="M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM16 16l4 4" /></svg>
          <span className="sr-only">Search spaces</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search spaces" disabled={reorder}
            className="flex-1 min-w-0 bg-transparent border-0 outline-none py-2 text-[15px]" style={{ color: "inherit", font: "inherit" }} />
        </label>
        {reorder ? (
          <>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save order"}</button>
            <button type="button" className="btn" onClick={() => { setGroups(initial); setReorder(false); }} disabled={saving}>Cancel</button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => { setQ(""); setReorder(true); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4" /></svg>Reorder
          </button>
        )}
      </div>
      {reorder && <p className="t-meta mb-2">Move sections and spaces up or down, then save. The top section opens first.</p>}
      {query && <p className="t-meta mb-2" aria-live="polite">{total ? `${total} space${total === 1 ? "" : "s"} found` : "No spaces match. Try another word."}</p>}

      <div className="grid gap-x-6 md:grid-cols-2 items-start">
      {shown.map((g) => {
        const gi = groups.findIndex((x) => x.title === g.title);
        const fanned = reorder || !!query || !!open[g.title];
        const step = fanned ? OPEN_STEP : CLOSED_STEP;
        return (
          <section key={g.title} aria-labelledby={`st-${gi}`} className="mt-7 min-w-0">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.tint, boxShadow: `0 0 12px ${g.tint}` }} aria-hidden />
              <h2 id={`st-${gi}`} className="t-label">{g.title}</h2>
              <span className="t-meta">{g.cards.length}</span>
              {reorder ? (
                <span className="ml-auto flex gap-1">
                  <button type="button" className="btn btn-sm" onClick={() => moveSection(gi, -1)} disabled={gi === 0} aria-label={`Move ${g.title} up`}>↑</button>
                  <button type="button" className="btn btn-sm" onClick={() => moveSection(gi, 1)} disabled={gi === groups.length - 1} aria-label={`Move ${g.title} down`}>↓</button>
                </span>
              ) : !query && g.cards.length > 1 && (
                <button type="button" className="ml-auto t-small font-bold underline-offset-4 hover:underline" aria-expanded={fanned}
                  onClick={() => setOpen((o) => ({ ...o, [g.title]: !o[g.title] }))}>{fanned ? "Stack" : "Fan out"}</button>
              )}
            </div>
            <div className="relative" style={{ height: (g.cards.length - 1) * step + CARD_H, transition: "height .45s cubic-bezier(.3,1.3,.5,1)" }}>
              {g.cards.map((c, ci) => (
                <div key={c.key} className="absolute left-0 right-0" style={{ top: ci * step, height: CARD_H, zIndex: ci + 1, transition: "top .45s cubic-bezier(.3,1.3,.5,1)" }}>
                  <Link href={c.href} className="tile flex flex-col h-full" style={{ ["--card-tint" as string]: g.tint, minHeight: 0, padding: "14px 16px" }}
                    onClick={(e) => { if (reorder) { e.preventDefault(); return; } if (!fanned) { e.preventDefault(); setOpen((o) => ({ ...o, [g.title]: true })); } }}
                    onFocus={() => { if (!fanned) setOpen((o) => ({ ...o, [g.title]: true })); }}
                    tabIndex={reorder ? -1 : undefined}>
                    <span className="flex items-center gap-2.5">
                      <span className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-[10px] shrink-0"
                        style={{ background: `radial-gradient(circle at 35% 28%, #FFF8EC, ${g.tint})`, ["--paper" as string]: "#FFF8EC", boxShadow: "inset 0 1px 1px rgba(255,255,255,.7)" }}>
                        <Glyph kind={c.glyph} size={18} color="#26331F" accent="#8A4A12" />
                      </span>
                      <span className="font-bold text-[15px] truncate">{c.label}</span>
                      {!reorder && <span className="ml-auto t-meta shrink-0">Open →</span>}
                    </span>
                    {c.stat
                      ? <span className="mt-auto text-[21px] leading-tight truncate" style={{ fontFamily: "var(--font-display)", fontWeight: "var(--display-weight)" as unknown as number }}>{c.stat}</span>
                      : <span className="mt-auto t-small text-ink-2 line-clamp-2">{c.d}</span>}
                  </Link>
                  {reorder && (
                    <span className="absolute right-3 top-3 z-10 flex gap-1">
                      <button type="button" className="btn btn-sm" onClick={() => moveCard(gi, ci, -1)} disabled={ci === 0} aria-label={`Move ${c.label} up`}>↑</button>
                      <button type="button" className="btn btn-sm" onClick={() => moveCard(gi, ci, 1)} disabled={ci === g.cards.length - 1} aria-label={`Move ${c.label} down`}>↓</button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      </div>
    </div>
  );
}
