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
