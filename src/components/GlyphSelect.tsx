"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Glyph, type GlyphKind } from "./Glyph";

/**
 * An icon picker that looks like a select, but shows each icon beside its name.
 * Sends its value through a hidden input, so it works inside any <form>.
 */
export function GlyphSelect({ id, name, options, initial, labelledBy }: {
  id?: string; name: string; options: { value: string; label: string }[]; initial?: string; labelledBy?: string;
}) {
  const [value, setValue] = useState(initial && options.some((o) => o.value === initial) ? initial : options[0]?.value ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", off);
    list.current?.focus();
    return () => document.removeEventListener("pointerdown", off);
  }, [open]);

  const choose = (v: string) => { setValue(v); setOpen(false); btn.current?.focus(); };
  const openList = () => { setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); };

  return (
    <div ref={wrap} className="glyph-select">
      <input type="hidden" name={name} value={value} />
      <button ref={btn} id={id} type="button" className="select glyph-select-btn" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
        aria-labelledby={labelledBy ? `${labelledBy} ${id}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openList(); } }}>
        {current && <span className="gs-ic" aria-hidden><Glyph kind={current.value as GlyphKind} size={16} color="currentColor" accent="currentColor" /></span>}
        <span className="flex-1 truncate text-left">{current?.label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden className="opacity-60 shrink-0"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <ul ref={list} id={listId} role="listbox" tabIndex={-1} className="glyph-select-list preview-enter" aria-activedescendant={`${listId}-${active}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.current?.focus(); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(options[active].value); }
            else if (e.key === "Tab") setOpen(false);
          }}>
          {options.map((o, i) => (
            <li key={o.value} id={`${listId}-${i}`} role="option" aria-selected={o.value === value}
              className={`glyph-opt ${i === active ? "active" : ""}`} onPointerEnter={() => setActive(i)} onClick={() => choose(o.value)}>
              <span className="gs-ic" aria-hidden><Glyph kind={o.value as GlyphKind} size={16} color="currentColor" accent="currentColor" /></span>
              <span className="truncate">{o.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
