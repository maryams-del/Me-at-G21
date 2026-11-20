"use client";
import { useEffect, useState } from "react";
import { SIZE_CONTROLS, SIZE_DEFAULTS, applySizes, loadSizes, saveSizes, type Sizes } from "@/lib/sizes";
import { toast } from "./api";

/** Phone-only debug button: sliders that resize text, headings, cards and the bottom bar live. Saved on this device. */
export function DebugSizer() {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<Sizes>(SIZE_DEFAULTS);

  useEffect(() => { const v = loadSizes(); setS(v); applySizes(v); }, []);

  const set = (next: Sizes) => { setS(next); saveSizes(next); };
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  async function copy() {
    const text = SIZE_CONTROLS.map((c) => `${c.label}: ${pct(s[c.key])}`).join("\n");
    try { await navigator.clipboard.writeText(text); toast("Sizes copied"); } catch { toast("Couldn't copy. Take a screenshot instead.", "error"); }
  }

  return (
    <div className="md:hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Debug sizes"
        className="fixed z-[45] left-[14px] glass rounded-full px-3 h-9 inline-flex items-center gap-1.5 text-[12px] font-bold"
        style={{ position: "fixed", bottom: "calc(26px + 66px * var(--sz-nav, 1) + env(safe-area-inset-bottom))" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" />
        </svg>
        Debug
      </button>

      {open && (
        <div role="dialog" aria-label="Debug sizes" className="fixed z-[55] left-[14px] right-[14px] glass p-4 rounded-[24px] preview-enter"
          style={{ position: "fixed", bottom: "calc(72px + 66px * var(--sz-nav, 1) + env(safe-area-inset-bottom))", background: "color-mix(in srgb, var(--paper) 92%, transparent)" }}>
          <div className="flex items-center justify-between mb-2">
            <p className="t-label">Sizes</p>
            <button type="button" className="t-small font-bold" onClick={() => setOpen(false)}>Close</button>
          </div>
          <div className="grid gap-3">
            {SIZE_CONTROLS.map((c) => (
              <label key={c.key} className="grid gap-1">
                <span className="flex justify-between t-small font-semibold"><span>{c.label}</span><span className="t-meta">{pct(s[c.key])}</span></span>
                <input type="range" min={c.min} max={c.max} step={0.05} value={s[c.key]}
                  onChange={(e) => set({ ...s, [c.key]: Number(e.target.value) })} className="w-full" style={{ accentColor: "var(--mustard)" }} />
              </label>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <button type="button" className="btn btn-sm" onClick={() => set(SIZE_DEFAULTS)}>Reset</button>
            <button type="button" className="btn btn-sm" onClick={copy}>Copy values</button>
          </div>
        </div>
      )}
    </div>
  );
}
