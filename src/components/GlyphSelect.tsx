"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Glyph, type GlyphKind } from "./Glyph";

export type DropdownOption = { value: string; label: string; glyph?: GlyphKind };

/**
 * The site's one dropdown: a select-looking button that opens a soft list (optionally with an icon beside each
 * option). Sends its value through a hidden input, so it works inside any <form>, including GET filter forms.
 */
export function Dropdown({ id, name, options, initial, value: controlled, labelledBy, ariaLabel, onChange, size = "md", className = "" }: {
  id?: string; name?: string; options: DropdownOption[]; initial?: string; /** controlled value (with onChange) */ value?: string;
  labelledBy?: string; ariaLabel?: string; onChange?: (value: string) => void; size?: "md" | "sm"; className?: string;
}) {
  const [inner, setValue] = useState(initial !== undefined && options.some((o) => o.value === initial) ? initial : options[0]?.value ?? "");
  const value = controlled ?? inner;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const autoId = useId();
  const btnId = id ?? `${autoId}-b`;
  const listId = `${autoId}-l`;
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];
  const hasGlyphs = options.some((o) => o.glyph);
  // The list floats above the page (so a panel never clips it), under the button — or above it near the bottom of the screen.
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const width = Math.max(r.width, 208);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
      const maxHeight = Math.min(288, Math.max(below, above));
      setPos(below >= Math.min(220, maxHeight) || below >= above
        ? { position: "fixed", top: r.bottom + 6, left, width, maxHeight }
        : { position: "fixed", bottom: window.innerHeight - r.top + 6, left, width, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", off);
    requestAnimationFrame(() => {
      list.current?.focus({ preventScroll: true });
      const sel = list.current?.querySelector<HTMLElement>("[aria-selected='true']");
      if (sel && list.current) list.current.scrollTop = sel.offsetTop - 6;
    });
    return () => document.removeEventListener("pointerdown", off);
  }, [open]);

  const choose = (v: string) => { setValue(v); setOpen(false); btn.current?.focus(); if (v !== value) onChange?.(v); };
  const openList = () => { setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); };
  const ic = (o?: DropdownOption) => o?.glyph && <span className="gs-ic" aria-hidden><Glyph kind={o.glyph} size={16} color="currentColor" accent="currentColor" /></span>;

  return (
    <div ref={wrap} className={`dd ${size === "sm" ? "dd-sm" : ""} ${className}`}>
      {name && <input type="hidden" name={name} value={value} />}
      <button ref={btn} id={btnId} type="button" className="select dd-btn" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
        aria-label={ariaLabel} aria-labelledby={!ariaLabel && labelledBy ? `${labelledBy} ${btnId}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openList(); } }}>
        {ic(current)}
        <span className="flex-1 truncate text-left">{current?.label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden className="dd-chev"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && pos && createPortal(
        <ul ref={list} style={pos} id={listId} role="listbox" tabIndex={-1} className="dd-list preview-enter" aria-activedescendant={`${listId}-${active}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.current?.focus(); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(options[active].value); }
            else if (e.key === "Tab") setOpen(false);
          }}>
          {options.map((o, i) => (
            <li key={o.value} id={`${listId}-${i}`} role="option" aria-selected={o.value === value}
              className={`dd-opt ${i === active ? "active" : ""} ${hasGlyphs ? "" : "plain"}`} onPointerEnter={() => setActive(i)} onClick={() => choose(o.value)}>
              {ic(o)}
              <span className="truncate flex-1">{o.label}</span>
              {o.value === value && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="dd-tick"><path d="M20 6L9 17l-5-5" /></svg>}
            </li>
          ))}
        </ul>, document.body)}
    </div>
  );
}

/** Icon picker: the same dropdown, with each icon shown beside its name. */
export function GlyphSelect(props: { id?: string; name: string; options: { value: string; label: string }[]; initial?: string; labelledBy?: string }) {
  return <Dropdown {...props} options={props.options.map((o) => ({ ...o, glyph: o.value as GlyphKind }))} />;
}
