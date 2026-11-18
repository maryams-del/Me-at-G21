/**
 * "Ask AI" beyond logging: going to a page and running app commands.
 * Both the offline parser and Claude only *name* a page or command from these fixed catalogues;
 * the server builds every link itself, so the assistant can never send you to an arbitrary URL
 * or run anything that isn't listed here. Commands always wait for a tap on Proceed.
 */
import type { AiContext, NavRequest, CommandRequest } from "./types";
import { CSV_KEYS } from "@/lib/csv-keys";

export type PageDef = { id: string; label: string; href: string; words: RegExp; filters?: ("q" | "person" | "kind" | "year")[]; kinds?: Record<string, RegExp> };

const DOC_KINDS: Record<string, RegExp> = {
  passport: /passport/, national_id: /\b(national id|iqama|id card|identity)\b/, transcript: /transcript/, certificate: /certificate|certification|diploma|degree/,
  cv: /\b(cv|resume|résumé)\b/, application: /application file/, letter: /\bletter\b/,
};
const EXPIRY_KINDS: Record<string, RegExp> = {
  passport: /passport/, national_id: /\b(national id|iqama|id card)\b/, license: /licen[cs]e/, bank_card: /bank card|credit card|debit card|\bcard\b/, membership: /membership/,
};
const ACH_KINDS: Record<string, RegExp> = {
  award: /award|prize|won/, certification: /certification|course/, volunteering: /volunteer/, project: /\bproject/, publication: /publication|paper|article/, skill: /\bskill/,
};

export const PAGES: PageDef[] = [
  { id: "home", label: "Today", href: "/", words: /\b(home|today|dashboard|main page)\b/ },
  { id: "inbox", label: "Needs details", href: "/inbox", words: /\b(inbox|needs details|drafts?)\b/ },
  { id: "history", label: "History", href: "/history", words: /\b(history|activity|timeline|log of)\b/, filters: ["q"] },
  { id: "charity", label: "Charity", href: "/finance/charity", words: /\b(charity|donations?|sadaqah|sadaqa)\b/, filters: ["q", "year"] },
  { id: "savings", label: "Savings", href: "/finance/savings", words: /\b(savings?|saving goals?)\b/ },
  { id: "debts", label: "Lent & borrowed", href: "/finance/debts", words: /\b(lent|borrowed|debts?|loans?|owe|owes)\b/ },
  { id: "subscriptions", label: "Subscriptions", href: "/finance/subscriptions", words: /\b(subscriptions?|netflix|spotify|renewals?)\b/ },
  { id: "zakat", label: "Zakat", href: "/finance/zakat", words: /\bzakat\b/ },
  { id: "routines", label: "Routines", href: "/care/routines", words: /\b(routines?|waxing|dental|bedsheets?|toothbrush|brushes)\b/ },
  { id: "period", label: "Period log", href: "/care/period", words: /\b(period log|cycle)\b/ },
  { id: "expiries", label: "Expiries", href: "/admin/expiries", words: /\b(expir\w*|renew\w* dates?)\b/, filters: ["person", "kind"], kinds: EXPIRY_KINDS },
  { id: "documents", label: "Documents & IDs", href: "/admin/documents", words: /\b(documents?|docs?|ids?|passports?|iqama|certificates?|transcripts?|cv|resume|files?)\b/, filters: ["q", "person", "kind"], kinds: DOC_KINDS },
  { id: "family", label: "Family members", href: "/admin", words: /\b(family members?|people)\b/ },
  { id: "applications", label: "Master's applications", href: "/education/applications", words: /\b(applications?|masters?|master's|universit\w*|admissions?)\b/ },
  { id: "achievements", label: "Achievements & hobbies", href: "/education/achievements", words: /\b(achievements?|hobb\w*|awards?|portfolio|accomplishments?)\b/, filters: ["q", "kind", "year"], kinds: ACH_KINDS },
  { id: "projects", label: "Projects & tasks", href: "/projects", words: /\b(projects?|tasks?|to-?dos?)\b/ },
  { id: "fasts", label: "Make-up fasts", href: "/faith/fasts", words: /\b(fasts?|fasting|qada)\b/ },
  { id: "quran", label: "Quran class", href: "/quran", words: /\b(quran|class|homework)\b/ },
  { id: "space", label: "Your space", href: "/more", words: /(?!)/ }, // one of the owner's own spaces (target = its alias)
  { id: "vault", label: "Vault", href: "/vault", words: /\b(vault|passwords?)\b/ },
  { id: "settings", label: "Settings", href: "/settings", words: /\b(settings|profile)\b/ },
  { id: "security", label: "Security settings", href: "/settings/security", words: /\b(security|passkeys?|face id|recovery codes?|authenticator)\b/ },
  { id: "notifications", label: "Notification settings", href: "/settings/notifications", words: /\b(notifications?|quiet hours|push)\b/ },
  { id: "data", label: "Data & backups", href: "/settings/data", words: /\b(backups?|exports?|restore|recently deleted|trash)\b/ },
];
export const PAGE_IDS = PAGES.map((p) => p.id);

export type Suggestion = { label: string; detail?: string; href: string };

/** Turn a page request into concrete links (several when it's ambiguous). Only catalogue pages; every value URL-encoded. */
export function buildNavigation(nav: NavRequest, ctx: AiContext, ids: Record<string, string>, owned: { personAlias: string | "me"; kind: string }[] = []): { suggestions: Suggestion[]; question?: string } {
  const page = PAGES.find((p) => p.id === nav.page);
  if (!page) return { suggestions: [], question: "Which page did you mean?" };
  // one of the owner's own spaces
  if (page.id === "space") {
    const x = ctx.spaces.find((s) => `@${s.alias}` === nav.target || s.alias === nav.target);
    if (x && ids[x.alias]) return { suggestions: [{ label: `Go to ${x.name}`, detail: x.section, href: `/spaces/${encodeURIComponent(ids[x.alias])}` }] };
    return { question: "Which of your spaces?", suggestions: ctx.spaces.filter((s) => ids[s.alias]).map((s) => ({ label: `Go to ${s.name}`, detail: s.section, href: `/spaces/${encodeURIComponent(ids[s.alias])}` })) };
  }
  // a specific application
  if (page.id === "applications" && nav.target) {
    const a = ctx.applications.find((x) => `@${x.alias}` === nav.target || x.alias === nav.target);
    if (a) return { suggestions: [{ label: `Go to ${a.university}`, detail: a.program, href: `/education/applications/${encodeURIComponent(ids[a.alias] ?? "")}` }] };
  }
  const params = new URLSearchParams();
  const bits: string[] = [];
  const allowed = new Set(page.filters ?? []);
  const kindLabel = nav.kind && page.kinds ? nav.kind.replace(/_/g, " ") : null;
  if (allowed.has("kind") && nav.kind && page.kinds?.[nav.kind]) params.set("kind", nav.kind);
  if (allowed.has("year") && nav.year && /^\d{4}$/.test(nav.year)) { params.set("year", nav.year); bits.push(nav.year); }
  if (allowed.has("q") && nav.q && !params.get("kind")) { params.set("q", nav.q.slice(0, 80)); bits.push(`“${nav.q.slice(0, 80)}”`); }
  const personName = (p: string) => (p === "me" ? "Your" : `${ctx.people.find((x) => x.alias === p.replace(/^@/, ""))?.name ?? "?"}'s`);
  const make = (person?: string): Suggestion => {
    const ps = new URLSearchParams(params);
    if (person && allowed.has("person")) ps.set("person", person === "me" ? "me" : ids[person.replace(/^@/, "")] ?? "");
    const what = [person ? `${personName(person)} ${kindLabel ?? page.label.toLowerCase()}` : kindLabel ? `${kindLabel}s` : null, ...bits].filter(Boolean).join(", ");
    return { label: `Go to ${page.label}`, detail: what || undefined, href: `${page.href}${ps.toString() ? `?${ps}` : ""}` };
  };
  if (allowed.has("person") && nav.person && (nav.person === "me" || ids[nav.person.replace(/^@/, "")])) return { suggestions: [make(nav.person)] };
  // "open the passport" when more than one person has one → ask whose, with options
  if (allowed.has("person") && nav.kind) {
    const whose = [...new Set(owned.filter((o) => o.kind === nav.kind).map((o) => o.personAlias))];
    if (whose.length > 1) return { question: `Whose ${kindLabel}?`, suggestions: [...whose.map((w) => make(w)), make()] };
  }
  return { suggestions: [make()] };
}

/* ───────────── commands ───────────── */

export type CommandOption = { label: string; description: string; action: { type: "download" | "navigate"; href: string }; confirm?: string };

export const COMMANDS = ["backup.quick", "backup.full", "backup.choose", "export.csv", "export.json"] as const;

export function buildCommand(c: CommandRequest): { question?: string; options: CommandOption[] } {
  const quick: CommandOption = { label: "Download a quick backup", description: "Every record you've entered, encrypted. Doesn't include your document files.", action: { type: "download", href: "/api/backup/download?id=new" } };
  const full: CommandOption = { label: "Make a full backup", description: "Records and every document, locked with a password you choose. Opens the backup page to set the password.", action: { type: "navigate", href: "/settings/data#full-backup" } };
  switch (c.command) {
    case "backup.quick": return { options: [quick] };
    case "backup.full": return { options: [full] };
    case "backup.choose": return { question: "Which kind of backup?", options: [full, quick] };
    case "export.json": return { options: [{ label: "Download everything as JSON", description: "All your records in one file, for moving to another app.", action: { type: "download", href: "/api/export" } }] };
    case "export.csv": {
      const one = CSV_KEYS.find((k) => k.key === c.module);
      const opt = (k: (typeof CSV_KEYS)[number]): CommandOption => ({
        label: `Download ${k.label} spreadsheet`, description: "A CSV file for Excel, Numbers or Google Sheets.",
        action: { type: "download", href: `/api/export/csv?module=${k.key}${k.private ? "&private=1" : ""}` },
        confirm: k.private ? "This file contains your period log in plain text. Download it?" : undefined,
      });
      return one ? { options: [opt(one)] } : { question: "Which section do you want as a spreadsheet?", options: CSV_KEYS.filter((k) => !k.private).map(opt) };
    }
  }
  return { options: [] };
}

/* ───────────── offline detection (no AI key) ───────────── */

const GO = /^(?:please\s+)?(?:go to|goto|open( up)?|show( me)?|take me to|navigate to|bring up|view|see|where (?:is|are|can i (?:see|find)))\b\s*(?:my|the|our)?\s*/i;

/** Offline: "go to / open / show me …" → a page request. Null if it isn't one. */
export function detectNavigation(text: string, ctx: AiContext): NavRequest | null {
  const t = text.trim().toLowerCase().replace(/[?.!]+$/, "");
  // questions about records ("show me when I last waxed", "how much did I donate") are searches, not navigation
  if (/\b(when|how much|how many|last time|did i|have i|what is|what's)\b/.test(t)) return null;
  const explicit = GO.test(t);
  const rest = t.replace(GO, "").trim();
  const norm = (x: string) => x.toLowerCase().replace(/\b(my|the|list|page|space)\b/g, " ").replace(/\s+/g, " ").trim();
  const exact = (ctx.spaces ?? []).find((s) => norm(rest) === norm(s.name));
  const within = (ctx.spaces ?? []).find((s) => s.name.length > 2 && rest.includes(s.name.toLowerCase()));
  if (exact || (explicit && within)) return { page: "space", target: `@${(exact ?? within)!.alias}` };
  // just a page name ("subscriptions", "my documents page") — nothing else said
  const bare = PAGES.find((p) => p.words.test(t) && !t.replace(new RegExp(p.words.source, "g"), " ").replace(/\b(my|the|page|section|screen|please|all)\b/g, " ").trim());
  if (!explicit && !bare) return null;
  // the most specific page whose words appear (documents before expiries unless "expir…" is said)
  const order = /expir/.test(rest) ? ["expiries"] : [];
  const page = PAGES.find((p) => order.includes(p.id)) ?? PAGES.find((p) => p.words.test(rest)) ?? (explicit ? null : bare);
  if (!page) return explicit && /^(go to|goto|take me to|navigate to|open)\b/.test(t) ? { page: "", q: rest } : null;
  const nav: NavRequest = { page: page.id };
  if (page.kinds) for (const [k, re] of Object.entries(page.kinds)) if (re.test(rest)) { nav.kind = k; break; }
  const year = rest.match(/\b(20\d{2})\b/)?.[1];
  if (year) nav.year = year;
  const who = ctx.people.find((p) => new RegExp(`\\b${p.name.toLowerCase()}('s)?\\b`).test(rest));
  if (who) nav.person = `@${who.alias}`;
  else if (/\b(my|mine)\b/.test(t) && page.filters?.includes("person") && nav.kind) nav.person = "me";
  if (page.id === "applications") { const a = ctx.applications.find((x) => rest.includes(x.university.toLowerCase())); if (a) nav.target = `@${a.alias}`; }
  if (page.filters?.includes("q") && !nav.kind) {
    const q = rest.replace(page.words, "").replace(/\b(my|mine|the|for|of|in|from|page|section|all|20\d{2})\b/g, " ").replace(/\s+/g, " ").trim();
    if (q && q.length > 1) nav.q = q;
  }
  return nav;
}

/** Offline: backups and exports. */
export function detectCommand(text: string): CommandRequest | null {
  const t = text.toLowerCase();
  if (/\b(back ?up|backup)\b/.test(t) && !/\brestore\b/.test(t)) {
    if (/\b(full|documents?|files?|everything|with my|all of it)\b/.test(t)) return { command: "backup.full" };
    if (/\b(quick|records? only|just (the )?records?)\b/.test(t)) return { command: "backup.quick" };
    return { command: "backup.choose" };
  }
  if (/\b(export|spreadsheet|csv|excel|download)\b/.test(t) && !/\b(back ?up)\b/.test(t)) {
    if (/\bjson\b/.test(t)) return { command: "export.json" };
    const m = CSV_KEYS.find((k) => k.words.test(t));
    if (/\b(export|spreadsheet|csv|excel)\b/.test(t) || m) return { command: "export.csv", module: m?.key };
  }
  return null;
}
