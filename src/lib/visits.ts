import type { GlyphKind } from "@/components/Glyph";

/** Pages that can appear under "Frequently visited" on Today. */
export const VISITABLE: { href: string; label: string; glyph: GlyphKind }[] = [
  { href: "/admin/documents", label: "Documents & IDs", glyph: "documents" },
  { href: "/admin/expiries", label: "Expiries", glyph: "expiries" },
  { href: "/finance/charity", label: "Charity", glyph: "charity" },
  { href: "/finance/savings", label: "Savings", glyph: "savings" },
  { href: "/finance/debts", label: "Lent & borrowed", glyph: "debts" },
  { href: "/finance/subscriptions", label: "Subscriptions", glyph: "subscriptions" },
  { href: "/finance/zakat", label: "Zakat", glyph: "zakat" },
  { href: "/care/routines", label: "Routines", glyph: "routines" },
  { href: "/care/period", label: "Period log", glyph: "period" },
  { href: "/faith/fasts", label: "Make-up fasts", glyph: "fasts" },
  { href: "/quran", label: "Quran class", glyph: "quran" },
  { href: "/education/applications", label: "Applications", glyph: "applications" },
  { href: "/education/achievements", label: "Achievements", glyph: "achievements" },
  { href: "/projects", label: "Projects & tasks", glyph: "projects" },
  { href: "/vault", label: "Secure vault", glyph: "vault" },
  { href: "/history", label: "History", glyph: "history" },
  { href: "/inbox", label: "Needs details", glyph: "inbox" },
];

const KEY = "g21-visits";
const DEFAULT = "/admin/documents";
export const MAX_FREQUENT = 3;
type Visits = Record<string, { n: number; at: number }>;

function load(): Visits {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") as Visits; } catch { return {}; }
}

/** Count a visit to the section that `path` belongs to (longest matching prefix). Kept on this device only. */
export function recordVisit(path: string) {
  const hit = VISITABLE.filter((v) => path === v.href || path.startsWith(v.href + "/")).sort((a, b) => b.href.length - a.href.length)[0];
  if (!hit) return;
  try {
    const v = load();
    v[hit.href] = { n: (v[hit.href]?.n ?? 0) + 1, at: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch { /* private mode: skip */ }
}

/** Top sections by visits (ties: most recent first). Documents & IDs fills in until there is history. */
export function frequent() {
  const v = load();
  const ranked = VISITABLE.filter((s) => v[s.href]).sort((a, b) => v[b.href].n - v[a.href].n || v[b.href].at - v[a.href].at).slice(0, MAX_FREQUENT);
  if (!ranked.some((s) => s.href === DEFAULT) && ranked.length < MAX_FREQUENT) ranked.push(VISITABLE.find((s) => s.href === DEFAULT)!);
  return ranked;
}
