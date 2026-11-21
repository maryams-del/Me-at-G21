import type { GlyphKind } from "@/components/Glyph";

/** The built-in groups on the Spaces page. A custom space goes under one of these or a new section. */
export const BUILTIN_SECTIONS = ["Money", "Care", "Faith", "Education & career", "Life admin"] as const;
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
/** Pinned spaces: at most three. */
export const MAX_PINS = 3;
/** The owner's chosen pins (hrefs, left to right), or null if they've never pinned anything (then the page picks for them). */
export function spacesPinsOf(settings: Record<string, unknown> | null | undefined): string[] | null {
  const v = (settings ?? {}).spacesPins;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_PINS) : null;
}
/** Sort `xs` by the saved order of their keys; unknown keys keep their place after the known ones. */
export function bySavedOrder<T>(xs: T[], key: (x: T) => string, saved: string[] = []): T[] {
  const pos = new Map(saved.map((k, i) => [k, i]));
  return xs.map((x, i) => ({ x, i })).sort((a, b) => (pos.get(key(a.x)) ?? 1e6 + a.i) - (pos.get(key(b.x)) ?? 1e6 + b.i)).map((e) => e.x);
}
/** Section colours, shared by the Spaces page and other places that show a section. */
export const SECTION_TINT: Record<string, string> = {
  "Money": "#8FB59A", "Care": "#C9A48E", "Faith": "#9DB0C6", "Education & career": "#B9B27E", "Life admin": "#C8B48F",
};
export const CUSTOM_TINT = "#AFA6C2";

/* ───── Built-in spaces: the owner can rename them, change their icon or section, or hide them ───── */

export type BuiltinSpace = { href: string; label: string; glyph: GlyphKind; d: string; section: string };
/** Every built-in space, in its default section and order. */
export const BUILTIN_SPACES: BuiltinSpace[] = [
  { href: "/finance/charity", label: "Charity", glyph: "charity", d: "Donations, monthly and yearly totals", section: "Money" },
  { href: "/finance/savings", label: "Savings", glyph: "savings", d: "Goals and actual deposits", section: "Money" },
  { href: "/finance/debts", label: "Lent & borrowed", glyph: "debts", d: "Who owes whom, repayments", section: "Money" },
  { href: "/finance/subscriptions", label: "Subscriptions", glyph: "subscriptions", d: "Monthly cost and upcoming charges", section: "Money" },
  { href: "/finance/zakat", label: "Zakat", glyph: "zakat", d: "Step-by-step estimate and payments", section: "Money" },
  { href: "/care/routines", label: "Routines", glyph: "routines", d: "Waxing, dental scaling, bedsheets and more", section: "Care" },
  { href: "/care/period", label: "Period log", glyph: "period", d: "Private, never sent to the AI", section: "Care" },
  { href: "/faith/fasts", label: "Make-up fasts", glyph: "fasts", d: "Balance and completed fasts", section: "Faith" },
  { href: "/quran", label: "Quran class", glyph: "quran", d: "Classes, homework, study time", section: "Faith" },
  { href: "/education/applications", label: "Master's applications", glyph: "applications", d: "Deadlines, requirements, status", section: "Education & career" },
  { href: "/education/achievements", label: "Achievements & hobbies", glyph: "achievements", d: "Accomplishments and CV bullets", section: "Education & career" },
  { href: "/projects", label: "Projects & tasks", glyph: "projects", d: "Deadlines and checklists", section: "Education & career" },
  { href: "/admin/expiries", label: "Expiries & renewals", glyph: "expiries", d: "IDs, licences, anything that runs out", section: "Life admin" },
  { href: "/admin/documents", label: "Documents & IDs", glyph: "documents", d: "Encrypted files and ID numbers", section: "Life admin" },
  { href: "/vault", label: "Secure vault", glyph: "vault", d: "Locked away", section: "Life admin" },
];
export const isBuiltinHref = (h: string) => BUILTIN_SPACES.some((s) => s.href === h);

export type SpaceOverride = { label?: string; glyph?: string; section?: string; description?: string; hidden?: boolean };
export function spaceOverridesOf(settings: Record<string, unknown> | null | undefined): Record<string, SpaceOverride> {
  const v = (settings ?? {}).spaceOverrides;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, SpaceOverride>) : {};
}
/** A built-in space as the owner has set it up (name, icon, section, hidden). */
export function builtinSpace(href: string, settings: Record<string, unknown> | null | undefined) {
  const base = BUILTIN_SPACES.find((s) => s.href === href);
  if (!base) return null;
  const o = spaceOverridesOf(settings)[href] ?? {};
  return {
    ...base,
    label: o.label?.trim() || base.label,
    glyph: (o.glyph && builtinGlyphOptions(base).some((g) => g.value === o.glyph) ? o.glyph : base.glyph) as GlyphKind,
    section: o.section?.trim() || base.section,
    /** the owner's own "What it's for" line, shown under the title (null if they haven't written one) */
    note: o.description?.trim() || null,
    hidden: !!o.hidden,
    defaultLabel: base.label,
  };
}

/** Icons a built-in space can use: its own original icon plus the usual set. */
export function builtinGlyphOptions(base: BuiltinSpace) {
  return [...(SPACE_GLYPHS.some((g) => g.value === base.glyph) ? [] : [{ value: base.glyph, label: "Original" }]), ...SPACE_GLYPHS];
}
