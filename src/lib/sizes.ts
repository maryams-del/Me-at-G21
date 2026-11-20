"use client";
import { useEffect, useState } from "react";

/**
 * Debug sizing (phone only): lets the owner nudge the size of things live and keeps the values on this device.
 * Text-like sizes are applied as CSS variables on <html>; card sizes are read by the components via useSizes().
 */
export type Sizes = { text: number; headings: number; waveCards: number; stackCards: number; nav: number };
export const SIZE_DEFAULTS: Sizes = { text: 1, headings: 1, waveCards: 1, stackCards: 1, nav: 1 };
export const SIZE_CONTROLS: { key: keyof Sizes; label: string; min: number; max: number }[] = [
  { key: "text", label: "Text", min: 0.8, max: 1.3 },
  { key: "headings", label: "Headings", min: 0.7, max: 1.4 },
  { key: "waveCards", label: "Home space cards", min: 0.7, max: 1.4 },
  { key: "stackCards", label: "Spaces stack cards", min: 0.7, max: 1.5 },
  { key: "nav", label: "Bottom bar", min: 0.75, max: 1.3 },
];

const KEY = "ld-debug-sizes";
const EVENT = "ld-sizes";

export function loadSizes(): Sizes {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...SIZE_DEFAULTS, ...(JSON.parse(raw) as Partial<Sizes>) };
  } catch { /* storage unavailable */ }
  return SIZE_DEFAULTS;
}

export function applySizes(s: Sizes) {
  const r = document.documentElement.style;
  r.setProperty("--sz-text", String(s.text));
  r.setProperty("--sz-head", String(s.headings));
  r.setProperty("--sz-wave", String(s.waveCards));
  r.setProperty("--sz-nav", String(s.nav));
}

export function saveSizes(s: Sizes) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
  applySizes(s);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: s }));
}

/** Current sizes; re-renders when the debug panel changes them. */
export function useSizes(): Sizes {
  const [s, setS] = useState<Sizes>(SIZE_DEFAULTS);
  useEffect(() => {
    setS(loadSizes());
    const on = (e: Event) => setS((e as CustomEvent<Sizes>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return s;
}
