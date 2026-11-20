import type { GlyphKind } from "@/components/Glyph";

/** The built-in groups on the Spaces page. A custom space goes under one of these or a new section. */
export const BUILTIN_SECTIONS = ["Money", "Care", "Faith", "Education & career", "Life admin", "You"] as const;
export const NEW_SECTION = "__new";

/** Icons the owner can pick for a custom space. */
export const SPACE_GLYPHS: { value: GlyphKind; label: string }[] = [
  { value: "projects", label: "Checklist" }, { value: "documents", label: "Document" }, { value: "savings", label: "Bars" },
  { value: "routines", label: "Square" }, { value: "achievements", label: "Star" }, { value: "education", label: "Cap" },
  { value: "quran", label: "Triangle" }, { value: "care", label: "Half moon" }, { value: "finance", label: "Block & circle" },
  { value: "home", label: "House" }, { value: "vault", label: "Lock" }, { value: "expiries", label: "Hourglass" },
  { value: "charity", label: "Gift" }, { value: "fasts", label: "Ring" }, { value: "history", label: "Clock" },
];
export const isSpaceGlyph = (g: string): g is GlyphKind => SPACE_GLYPHS.some((x) => x.value === g);

export type SpacesOrder = { sections: string[]; cards: Record<string, string[]> };
export function spacesOrderOf(settings: Record<string, unknown> | null | undefined): SpacesOrder {
  const v = (settings ?? {}).spacesOrder as Partial<SpacesOrder> | undefined;
  return { sections: Array.isArray(v?.sections) ? v.sections : [], cards: v?.cards && typeof v.cards === "object" ? v.cards : {} };
}
/** Sort `xs` by the saved order of their keys; unknown keys keep their place after the known ones. */
export function bySavedOrder<T>(xs: T[], key: (x: T) => string, saved: string[] = []): T[] {
  const pos = new Map(saved.map((k, i) => [k, i]));
  return xs.map((x, i) => ({ x, i })).sort((a, b) => (pos.get(key(a.x)) ?? 1e6 + a.i) - (pos.get(key(b.x)) ?? 1e6 + b.i)).map((e) => e.x);
}
/** Section colours, shared by the Spaces page and other places that show a section. */
export const SECTION_TINT: Record<string, string> = {
  "Money": "#8FB59A", "Care": "#C9A48E", "Faith": "#9DB0C6", "Education & career": "#B9B27E", "Life admin": "#C8B48F", "You": "#A9A69A",
};
export const CUSTOM_TINT = "#AFA6C2";
