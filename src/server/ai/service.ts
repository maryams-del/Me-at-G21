import "server-only";
import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  aiProposals, aiProposalOperations, captureDrafts, routines, savingsGoals, debts, projects, tasks,
  charityPayments, periodCycles, expiryItems, people, mastersApplications, routineEvents, fastLedgerEvents,
  savingsTransactions, auditEvents, homeworkTasks, subscriptions, achievements, hobbies, documents,
} from "@/db/schema";
import { buildNavigation, buildCommand, type Suggestion } from "./actions";
import { getOp, runOpInTx } from "../ops";
import { UserError } from "../audit";
import { fastBalance, routineAnchor, routineDue } from "../ops/care";
import { debtOutstanding } from "../ops/finance";
import { nextClassOccurrence } from "../ops/planning";
import { formatMoney } from "@/lib/money";
import { todayLocal, dmy, daysBetween } from "@/lib/time";
import { fmtDateTime } from "@/lib/format";
import type { AiContext, AiProvider, Interpretation, ProposedOp, SearchQuery } from "./types";
import { offlineProvider } from "./offline";
import { anthropicProvider } from "./anthropic";

const PROPOSAL_TTL_MIN = 60;

export function getProvider(): AiProvider {
  const p = process.env.AI_PROVIDER ?? "offline";
  if (p === "anthropic") return anthropicProvider();
  return offlineProvider;
}

type AliasMap = Record<string, { id: string; kind: string; name: string }>;

async function buildContext(ownerId: string, tz: string, currency: string): Promise<{ ctx: AiContext; aliases: AliasMap }> {
  const db = getDb();
  const [rs, gs, ds, ps, ts, es, fam, apps, subs, achs, hobs] = await Promise.all([
    db.select({ id: routines.id, name: routines.name, kind: routines.kind }).from(routines).where(eq(routines.ownerId, ownerId)).orderBy(asc(routines.createdAt)),
    db.select({ id: savingsGoals.id, name: savingsGoals.name }).from(savingsGoals).where(and(eq(savingsGoals.ownerId, ownerId), eq(savingsGoals.status, "active"))).orderBy(asc(savingsGoals.createdAt)),
    db.select({ id: debts.id, counterparty: debts.counterparty, direction: debts.direction }).from(debts).where(and(eq(debts.ownerId, ownerId), eq(debts.status, "open"), isNull(debts.deletedAt))).orderBy(asc(debts.createdAt)),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.ownerId, ownerId), eq(projects.status, "active"), isNull(projects.deletedAt))).orderBy(asc(projects.createdAt)),
    db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(and(eq(tasks.ownerId, ownerId), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`)).orderBy(desc(tasks.createdAt)).limit(30),
    db.select({ id: expiryItems.id, label: expiryItems.label, kind: expiryItems.kind, personId: expiryItems.personId }).from(expiryItems).where(and(eq(expiryItems.ownerId, ownerId), isNull(expiryItems.deletedAt), eq(expiryItems.status, "active"))).orderBy(asc(expiryItems.expiresOn)),
    db.select({ id: people.id, name: people.name, relation: people.relation }).from(people).where(and(eq(people.ownerId, ownerId), isNull(people.deletedAt))).orderBy(asc(people.createdAt)),
    db.select({ id: mastersApplications.id, university: mastersApplications.university, program: mastersApplications.program, status: mastersApplications.status }).from(mastersApplications).where(and(eq(mastersApplications.ownerId, ownerId), isNull(mastersApplications.deletedAt))).orderBy(asc(mastersApplications.createdAt)),
    db.select({ id: subscriptions.id, name: subscriptions.name, status: subscriptions.status }).from(subscriptions).where(and(eq(subscriptions.ownerId, ownerId), isNull(subscriptions.deletedAt))).orderBy(asc(subscriptions.name)),
    db.select({ id: achievements.id, title: achievements.title }).from(achievements).where(and(eq(achievements.ownerId, ownerId), isNull(achievements.deletedAt))).orderBy(desc(achievements.createdAt)).limit(40),
    db.select({ id: hobbies.id, name: hobbies.name }).from(hobbies).where(and(eq(hobbies.ownerId, ownerId), isNull(hobbies.deletedAt))).orderBy(asc(hobbies.name)),
  ]);
  const famName = new Map(fam.map((f) => [f.id, f.name]));
  const aliases: AliasMap = {};
  const tag = <T extends { id: string }>(prefix: string, rows: T[], kind: string, name: (r: T) => string) =>
    rows.map((r, i) => { const a = `${prefix}${i + 1}`; aliases[a] = { id: r.id, kind, name: name(r) }; return { ...r, alias: a }; });
  const today = todayLocal(tz);
  return {
    aliases,
    ctx: {
      today, tz, currency,
      weekday: new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: tz }).format(new Date()),
      routines: tag("r", rs, "routine", (r) => r.name).map(({ alias, name, kind }) => ({ alias, name, kind })),
      goals: tag("g", gs, "goal", (g) => g.name).map(({ alias, name }) => ({ alias, name })),
      debts: tag("d", ds, "debt", (d) => d.counterparty).map(({ alias, counterparty, direction }) => ({ alias, counterparty, direction })),
      projects: tag("p", ps, "project", (p) => p.name).map(({ alias, name }) => ({ alias, name })),
      tasks: tag("t", ts, "task", (t) => t.title).map(({ alias, title }) => ({ alias, title })),
      // Labels only (e.g. "Passport") — never ID numbers, dates of documents or files.
      expiries: tag("e", es, "expiry", (e) => (e.personId ? `${famName.get(e.personId) ?? ""}'s ${e.label}` : e.label)).map(({ alias, label, kind, personId }) => ({ alias, label: (personId ? `${famName.get(personId) ?? ""}'s ${label}` : label).replace(/\d[\d\s-]{4,}\d/g, "•••"), kind })),
      people: tag("f", fam, "person", (f) => f.name).map(({ alias, name, relation }) => ({ alias, name, relation })),
      applications: tag("a", apps, "application", (x) => `${x.university}, ${x.program}`).map(({ alias, university, program, status }) => ({ alias, university, program, status })),
      subscriptions: tag("s", subs, "subscription", (x) => x.name).map(({ alias, name, status }) => ({ alias, name, status })),
      achievements: tag("c", achs, "achievement", (x) => x.title).map(({ alias, title }) => ({ alias, title })),
      hobbies: tag("h", hobs, "hobby", (x) => x.name).map(({ alias, name }) => ({ alias, name })),
    },
  };
}

/** Replace "@alias" references with real IDs from the owner's own records. Unknown aliases → missing. */
function resolveAliases(op: ProposedOp, aliases: AliasMap): { input: Record<string, unknown>; missing: string[] } {
  const input: Record<string, unknown> = {};
  const missing = new Set(op.missing ?? []);
  for (const [k, v] of Object.entries(op.input ?? {})) {
    if (v === undefined) { missing.add(k); continue; }
    if (typeof v === "string" && v.startsWith("@")) {
      const hit = aliases[v.slice(1)];
      if (hit) input[k] = hit.id; else missing.add(k);
    } else input[k] = v;
  }
  return { input, missing: [...missing] };
}

function toAliasForm(payload: Record<string, unknown>, aliases: AliasMap) {
  const rev = Object.fromEntries(Object.entries(aliases).map(([a, v]) => [v.id, a]));
  return Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, typeof v === "string" && rev[v] ? `@${rev[v]}` : v]));
}

export type Choice = { field: string; question: string; options: { label: string; value: string }[] };
export type PreviewOp = {
  position: number; op: string; label: string; module: string; summary: string;
  input: Record<string, unknown>; display: Record<string, string>; missing: string[]; assumed: string[];
  valid: boolean; error: string | null; status: string; choices: Choice[];
};

/* Which record a missing id field refers to, so the preview can offer tap-to-choose options. */
const ID_FIELD_KIND: Record<string, string> = { routineId: "routine", goalId: "goal", debtId: "debt", projectId: "project", taskId: "task", itemId: "expiry", personId: "person", applicationId: "application" };
const OP_ID_KIND: Record<string, string> = { expiry: "expiry", subscription: "subscription", task: "task", routine: "routine", achievement: "achievement", hobby: "hobby", application: "application", debt: "debt" };
const NOUN: Record<string, string> = { routine: "routine", goal: "savings goal", debt: "record", project: "project", task: "task", expiry: "expiry", person: "family member", application: "application", subscription: "subscription", achievement: "achievement", hobby: "hobby" };
const STOP = new Set(["the", "a", "an", "my", "of", "for", "to", "and", "delete", "remove", "cancel", "please", "reminder", "expiry", "expiration", "it", "that", "this", "i", "want"]);

function choicesFor(opName: string, missing: string[], aliases: AliasMap, hint: string): Choice[] {
  const words = hint.toLowerCase().replace(/'s\b/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
  const out: Choice[] = [];
  for (const field of missing) {
    const kind = field === "id" ? OP_ID_KIND[opName.split(".")[0]] : ID_FIELD_KIND[field];
    if (!kind) continue;
    const all = Object.entries(aliases).filter(([, v]) => v.kind === kind);
    if (!all.length) continue;
    const score = (name: string) => words.filter((w) => name.toLowerCase().includes(w)).length;
    const best = Math.max(0, ...all.map(([, v]) => score(v.name)));
    const picked = (best > 0 ? all.filter(([, v]) => score(v.name) === best) : all).slice(0, 8);
    const verb = opName.endsWith(".delete") ? "Delete which" : opName.endsWith(".cancel") ? "Which" : "Which";
    // "Ali's Passport" vs "Passport": ask whose
    const bases = new Set(picked.map(([, v]) => v.name.replace(/^.*'s\s+/, "").toLowerCase()));
    const question = kind === "expiry" && picked.length > 1 && bases.size === 1 ? `${opName.endsWith(".delete") ? "Delete the" : "The"} ${[...bases][0]} expiry for whom?` : `${verb} ${NOUN[kind] ?? kind}?`;
    out.push({ field, question, options: picked.map(([a, v]) => ({ label: kind === "expiry" && !/'s\s/.test(v.name) ? `Yours: ${v.name}` : v.name, value: `@${a}` })) });
  }
  return out;
}

function describe(op: ProposedOp & { input: Record<string, unknown> }, aliases: AliasMap) {
  const def = getOp(op.op);
  const display: Record<string, string> = {};
  const names = Object.fromEntries(Object.values(aliases).map((a) => [a.id, a.name]));
  for (const [k, v] of Object.entries(op.input)) {
    if (v === null || v === undefined || (Array.isArray(v) && !v.length)) continue;
    display[k] = typeof v === "string" && names[v] ? names[v]
      : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? dmy(v)
      : Array.isArray(v) ? v.join(", ") : String(v);
  }
  if (!def || !def.aiAllowed) return { def: null, display, valid: false, error: "This action isn't allowed from AI capture", summary: op.op };
  const parsed = def.schema.safeParse(op.input);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "input")))];
    return { def, display, valid: false, error: `Needs: ${fields.join(", ")}`, summary: def.label, fields };
  }
  let summary = def.summarize(parsed.data);
  for (const [id, n] of Object.entries(names)) summary = summary.replaceAll(id, n);
  return { def, display, valid: true, error: null, summary, data: parsed.data };
}

async function storeVersion(proposalId: string, version: number, ops: ProposedOp[], aliases: AliasMap, hint = "") {
  const db = getDb();
  const rows = ops.map((o, i) => {
    const { input, missing } = resolveAliases(o, aliases);
    const d = describe({ ...o, input }, aliases);
    const missingAll = [...new Set([...missing, ...((d as { fields?: string[] }).fields ?? [])])];
    return {
      proposalId, version, position: i, module: d.def?.module ?? "unknown", action: o.op,
      payload: { input, assumed: o.assumed ?? [], display: d.display, valid: d.valid, error: d.error, choices: d.valid ? [] : choicesFor(o.op, missingAll, aliases, hint) },
      missingFields: d.valid ? [] : missingAll, summary: d.summary,
    };
  });
  if (rows.length) await db.insert(aiProposalOperations).values(rows);
}

export async function loadPreview(ownerId: string, proposalId: string) {
  const db = getDb();
  const [p] = await db.select().from(aiProposals).where(and(eq(aiProposals.id, proposalId), eq(aiProposals.ownerId, ownerId)));
  if (!p) throw new UserError("Proposal not found");
  const ops = await db.select().from(aiProposalOperations).where(and(eq(aiProposalOperations.proposalId, p.id), eq(aiProposalOperations.version, p.version))).orderBy(asc(aiProposalOperations.position));
  const preview: PreviewOp[] = ops.map((o) => {
    const pl = o.payload as { input: Record<string, unknown>; assumed: string[]; display: Record<string, string>; valid: boolean; error: string | null; choices?: Choice[] };
    return { position: o.position, op: o.action, label: getOp(o.action)?.label ?? o.action, module: o.module, summary: o.summary, input: pl.input, display: pl.display, missing: o.missingFields, assumed: pl.assumed, valid: pl.valid, error: pl.error, status: o.status, choices: pl.choices ?? [] };
  });
  return {
    id: p.id, version: p.version, status: p.status, inputText: p.inputText, questions: p.questions, provider: p.provider,
    expiresAt: p.expiresAt, operations: preview, result: p.result,
  };
}

/** Period/menstrual text never leaves the server: answered deterministically from the owner's own log, never sent to the AI provider or stored as a proposal. */
const PERIOD_RE = /\b(period|periods|menstrua\w*|menses)\b/i;
async function privatePeriodAnswer(owner: { id: string; timezone: string }, text: string, capture: boolean): Promise<{ answer: string; sources: Source[] } | null> {
  if (!PERIOD_RE.test(text)) return null;
  const db = getDb();
  const rows = await db.select({ startDate: periodCycles.startDate, endDate: periodCycles.endDate }).from(periodCycles)
    .where(and(eq(periodCycles.ownerId, owner.id), isNull(periodCycles.deletedAt))).orderBy(desc(periodCycles.startDate)).limit(3);
  const link = { label: "Period log", date: "", href: "/care/period" };
  const today = todayLocal(owner.timezone);
  const isQuestion = /\?|^(when|what|how|did|is|was|last)\b/i.test(text.trim());
  if (capture && !isQuestion) return { answer: "To keep it private, period entries aren't handled by Capture or the AI. Use the Period log page.", sources: [link] };
  if (!rows.length) return { answer: "No periods are logged yet. (Answered from your own log; nothing was sent to the AI.)", sources: [link] };
  const [last] = rows;
  const status = last.endDate ? `Your last period started on ${dmy(last.startDate)} and ended on ${dmy(last.endDate)} (${daysBetween(last.startDate, last.endDate) + 1} days).` : `Your current period started on ${dmy(last.startDate)} (day ${daysBetween(last.startDate, today) + 1}).`;
  return { answer: `${status} Answered from your own log; nothing was sent to the AI.`, sources: rows.map((r) => ({ label: r.endDate ? `Period ${dmy(r.startDate)} to ${dmy(r.endDate)}` : "Period (ongoing)", date: dmy(r.startDate), href: "/care/period" })) };
}

/** Step 1–3: interpret text into a stored proposal (or answer a search). Writes nothing else. */
export async function interpret(owner: { id: string; timezone: string; defaultCurrency: string }, text: string, mode: "text" | "voice") {
  const clean = text.trim().slice(0, 2000);
  if (!clean) throw new UserError("Type or say something first");
  // "open the period log" is just navigation, answered locally (period text never goes to the provider)
  if (/\bperiod\b/i.test(clean) && /^(?:please\s+)?(go to|open|show( me)?|take me to)\b/i.test(clean)) return { kind: "navigate" as const, suggestions: [{ label: "Go to Period log", href: "/care/period" }] };
  const priv = await privatePeriodAnswer(owner, clean, true);
  if (priv) return { kind: "search" as const, ...priv };
  const { ctx, aliases } = await buildContext(owner.id, owner.timezone, owner.defaultCurrency);
  const provider = getProvider();
  let out: Interpretation;
  try {
    out = await provider.interpret({ text: clean, ctx });
  } catch (e) {
    console.error("[ai] provider error:", (e as Error).message);
    throw new UserError("The assistant is unavailable right now. Nothing was saved — you can use the regular forms.");
  }
  if (out.intent === "search" && out.query) {
    return { kind: "search" as const, ...(await runSearch(owner, out.query, aliases)) };
  }
  if (out.intent === "navigate" && out.navigate) return { kind: "navigate" as const, ...(await navigation(owner.id, out.navigate, ctx, aliases)) };
  if (out.intent === "command" && out.command) return { kind: "command" as const, ...buildCommand(out.command) };
  const db = getDb();
  const [p] = await db.insert(aiProposals).values({
    ownerId: owner.id, inputText: clean, inputMode: mode, provider: provider.name, questions: out.questions,
    history: [{ role: "user", text: clean }], result: { aliases },
    expiresAt: new Date(Date.now() + PROPOSAL_TTL_MIN * 60_000),
  }).returning({ id: aiProposals.id });
  await storeVersion(p.id, 1, out.operations, aliases, clean);
  return { kind: "proposal" as const, proposal: await loadPreview(owner.id, p.id) };
}

/** Build "Go to …" links from a page request; asks "whose?" when several people have that kind of item. */
async function navigation(ownerId: string, nav: import("./types").NavRequest, ctx: AiContext, aliases: AliasMap): Promise<{ question?: string; suggestions: Suggestion[] }> {
  const ids = Object.fromEntries(Object.entries(aliases).map(([a, v]) => [a, v.id]));
  if (!nav.page) {
    return { question: `I couldn't find a page for “${(nav.q ?? "").slice(0, 60)}”. Here are the main ones:`, suggestions: [
      { label: "Go to Today", href: "/" }, { label: "Go to Documents & IDs", href: "/admin/documents" }, { label: "Go to Expiries", href: "/admin/expiries" },
      { label: "Go to Charity", href: "/finance/charity" }, { label: "Go to Routines", href: "/care/routines" }, { label: "Go to Settings", href: "/settings" },
    ] };
  }
  let owned: { personAlias: string; kind: string }[] = [];
  if (nav.kind && (nav.page === "documents" || nav.page === "expiries")) {
    const personAlias = Object.fromEntries(Object.entries(aliases).filter(([, v]) => v.kind === "person").map(([a, v]) => [v.id, `@${a}`]));
    const rows = nav.page === "documents"
      ? await getDb().select({ kind: documents.kind, personId: documents.personId }).from(documents).where(and(eq(documents.ownerId, ownerId), isNull(documents.deletedAt)))
      : await getDb().select({ kind: expiryItems.kind, personId: expiryItems.personId }).from(expiryItems).where(and(eq(expiryItems.ownerId, ownerId), isNull(expiryItems.deletedAt)));
    owned = rows.map((r) => ({ kind: r.kind, personAlias: r.personId ? personAlias[r.personId] ?? "" : "me" })).filter((r) => r.personAlias);
  }
  return buildNavigation(nav, ctx, ids, owned);
}

/** Tap-to-choose: fill one field of one operation (e.g. which expiry to delete) → new preview version. Writes nothing else. */
export async function choose(owner: { id: string }, proposalId: string, position: number, field: string, value: string) {
  const p = await pendingProposal(owner.id, proposalId);
  const aliases = (p.result as { aliases: AliasMap }).aliases;
  if (!/^@[a-z]\d{1,3}$/.test(value) || !aliases[value.slice(1)]) throw new UserError("That option isn't available any more");
  const current = await getDb().select().from(aiProposalOperations).where(and(eq(aiProposalOperations.proposalId, p.id), eq(aiProposalOperations.version, p.version))).orderBy(asc(aiProposalOperations.position));
  const ops: ProposedOp[] = current.map((o) => {
    const pl = o.payload as { input: Record<string, unknown>; assumed: string[] };
    const input = toAliasForm(pl.input, aliases);
    if (o.position === position) input[field] = value;
    return { op: o.action, input, missing: o.position === position ? o.missingFields.filter((m) => m !== field) : o.missingFields, assumed: pl.assumed };
  });
  const version = p.version + 1;
  await storeVersion(p.id, version, ops, aliases, p.inputText);
  await getDb().update(aiProposals).set({ version, questions: [], updatedAt: new Date(), expiresAt: new Date(Date.now() + PROPOSAL_TTL_MIN * 60_000) }).where(eq(aiProposals.id, p.id));
  return loadPreview(owner.id, p.id);
}

async function pendingProposal(ownerId: string, proposalId: string) {
  const [p] = await getDb().select().from(aiProposals).where(and(eq(aiProposals.id, proposalId), eq(aiProposals.ownerId, ownerId)));
  if (!p) throw new UserError("Proposal not found");
  if (p.status !== "pending") throw new UserError(`This proposal is already ${p.status}`);
  if (p.expiresAt < new Date()) {
    await getDb().update(aiProposals).set({ status: "expired" }).where(eq(aiProposals.id, p.id));
    throw new UserError("This proposal expired. Nothing was saved — please capture it again.");
  }
  return p;
}

/** Step 5: natural-language correction → new preview version. Still writes nothing. */
export async function correct(owner: { id: string; timezone: string; defaultCurrency: string }, proposalId: string, text: string) {
  const p = await pendingProposal(owner.id, proposalId);
  const aliases = (p.result as { aliases: AliasMap }).aliases;
  const { ctx } = await buildContext(owner.id, owner.timezone, owner.defaultCurrency);
  // Reuse the proposal's alias map so references stay stable across versions.
  ctx.routines = Object.entries(aliases).filter(([, v]) => v.kind === "routine").map(([a, v]) => ({ alias: a, name: v.name, kind: ctx.routines.find((r) => r.name === v.name)?.kind ?? "custom" }));
  ctx.goals = Object.entries(aliases).filter(([, v]) => v.kind === "goal").map(([a, v]) => ({ alias: a, name: v.name }));
  const current = await getDb().select().from(aiProposalOperations).where(and(eq(aiProposalOperations.proposalId, p.id), eq(aiProposalOperations.version, p.version))).orderBy(asc(aiProposalOperations.position));
  const prevOps: ProposedOp[] = current.map((o) => {
    const pl = o.payload as { input: Record<string, unknown>; assumed: string[] };
    return { op: o.action, input: toAliasForm(pl.input, aliases), missing: o.missingFields, assumed: pl.assumed };
  });
  let out: Interpretation;
  try {
    out = await getProvider().interpret({ text: text.slice(0, 1000), ctx, previous: [{ text: p.inputText, operations: prevOps }] });
  } catch (e) {
    console.error("[ai] provider error:", (e as Error).message);
    throw new UserError("The assistant is unavailable right now. Your preview is unchanged.");
  }
  const version = p.version + 1;
  await storeVersion(p.id, version, out.operations, aliases, `${p.inputText} ${text}`);
  await getDb().update(aiProposals).set({
    version, questions: out.questions, updatedAt: new Date(),
    history: [...p.history, { role: "user", text: text.slice(0, 1000) }],
    expiresAt: new Date(Date.now() + PROPOSAL_TTL_MIN * 60_000),
  }).where(eq(aiProposals.id, p.id));
  return loadPreview(owner.id, p.id);
}

type Outcome = { position: number; status: string; message: string; id: string | null };
export type Selection = { position: number; mode: "apply" | "draft" | "skip" };

/**
 * Step 6: the ONLY place AI proposals become records. Requires the exact version the owner saw.
 * All selected operations commit in one transaction or none do. Re-confirming returns the
 * stored outcome (idempotent) instead of writing twice.
 */
export async function confirm(owner: { id: string; timezone: string }, proposalId: string, version: number, selections: Selection[]) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`select id, status, version, expires_at, input_text from ai_proposals where id = ${proposalId} and owner_id = ${owner.id} for update`);
    const p = locked.rows[0] as { id: string; status: string; version: number; expires_at: Date; input_text: string } | undefined;
    if (!p) throw new UserError("Proposal not found");
    if (p.status === "confirmed") {
      const [done] = await tx.select({ result: aiProposals.result }).from(aiProposals).where(eq(aiProposals.id, p.id));
      return { alreadyConfirmed: true, outcomes: ((done.result as { outcomes?: Outcome[] })?.outcomes ?? []) };
    }
    if (p.status !== "pending") throw new UserError(`This proposal is ${p.status}`);
    if (new Date(p.expires_at) < new Date()) throw new UserError("This proposal expired. Nothing was saved.");
    if (p.version !== version) throw new UserError("The preview changed since you looked at it. Please review the latest version.");

    const ops = await tx.select().from(aiProposalOperations).where(and(eq(aiProposalOperations.proposalId, p.id), eq(aiProposalOperations.version, version))).orderBy(asc(aiProposalOperations.position));
    const now = new Date();
    const outcomes: Outcome[] = [];
    for (const o of ops) {
      const sel = selections.find((s) => s.position === o.position)?.mode ?? "skip";
      const pl = o.payload as { input: Record<string, unknown>; valid: boolean };
      if (sel === "skip") {
        await tx.update(aiProposalOperations).set({ status: "skipped" }).where(eq(aiProposalOperations.id, o.id));
        outcomes.push({ position: o.position, status: "skipped", message: "Not saved", id: null });
        continue;
      }
      if (sel === "draft") {
        const [d] = await tx.insert(captureDrafts).values({
          ownerId: owner.id, sourceText: p.input_text, targetModule: o.module, action: o.action, payload: pl.input,
          missingFields: o.missingFields.length ? o.missingFields : ["details"],
        }).returning({ id: captureDrafts.id });
        await tx.update(aiProposalOperations).set({ status: "drafted", resultEntityId: d.id }).where(eq(aiProposalOperations.id, o.id));
        await tx.insert(auditEvents).values({ ownerId: owner.id, category: "inbox", action: "drafted", entityType: "capture_draft", entityId: d.id, summary: `Saved for later: ${o.summary}`, source: "ai", occurredAt: now });
        outcomes.push({ position: o.position, status: "drafted", message: "Saved to Needs Details", id: d.id });
        continue;
      }
      const def = getOp(o.action);
      if (!def?.aiAllowed) throw new UserError("Operation not allowed");
      // Re-validated inside runOpInTx with the same schema the forms use; any failure aborts everything.
      const res = await runOpInTx(tx, { ownerId: owner.id, tz: owner.timezone, source: "ai", now }, o.action, pl.input);
      await tx.update(aiProposalOperations).set({ status: "applied", resultEntityId: res.id }).where(eq(aiProposalOperations.id, o.id));
      outcomes.push({ position: o.position, status: "applied", message: res.message, id: res.id });
    }
    if (!outcomes.some((x) => x.status !== "skipped")) throw new UserError("Nothing selected to save");
    await tx.update(aiProposals).set({ status: "confirmed", confirmedAt: now, result: sql`coalesce(${aiProposals.result}, '{}'::jsonb) || ${JSON.stringify({ outcomes })}::jsonb`, updatedAt: now }).where(eq(aiProposals.id, p.id));
    return { alreadyConfirmed: false, outcomes };
  });
}

export async function cancel(ownerId: string, proposalId: string) {
  await getDb().update(aiProposals).set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(aiProposals.id, proposalId), eq(aiProposals.ownerId, ownerId), eq(aiProposals.status, "pending")));
  return { ok: true };
}

/* ───────────── Smart search: deterministic queries over permitted, non-sensitive records ───────────── */

type Source = { label: string; date: string; href: string };

export async function runSearch(owner: { id: string; timezone: string }, q: SearchQuery, aliases: AliasMap): Promise<{ answer: string; sources: Source[]; calculation?: string }> {
  const db = getDb();
  const ownerId = owner.id;
  const tz = owner.timezone;
  const fmt = (d: string) => dmy(d);
  switch (q.type) {
    case "last_event": {
      if (q.target === "waxing" || q.target === "dental") {
        const label = q.target === "waxing" ? "waxing" : "dental scaling";
        const [r] = await db.select().from(routines).where(and(eq(routines.ownerId, ownerId), eq(routines.kind, q.target))).limit(1);
        const rows = r ? await db.select().from(routineEvents).where(and(eq(routineEvents.routineId, r.id), eq(routineEvents.type, "completed"), isNull(routineEvents.voidedAt))).orderBy(desc(routineEvents.onDate)).limit(3) : [];
        if (!rows.length) return { answer: `I couldn't find any logged ${label}.`, sources: [] };
        const ago = daysBetween(rows[0].onDate, todayLocal(tz));
        return {
          answer: `Your last ${label} was on ${fmt(rows[0].onDate)} (${ago} day${ago === 1 ? "" : "s"} ago).`,
          sources: rows.map((e) => ({ label: `${r!.name} done`, date: dmy(e.onDate), href: "/care/routines" })),
        };
      }
      if (q.target === "fasts") {
        const rows = await db.select().from(fastLedgerEvents).where(and(eq(fastLedgerEvents.ownerId, ownerId), eq(fastLedgerEvents.type, "completed"), isNull(fastLedgerEvents.voidedAt))).orderBy(desc(fastLedgerEvents.onDate)).limit(3);
        if (!rows.length) return { answer: "No completed make-up fasts are logged yet.", sources: [] };
        return { answer: `Your last make-up fast was on ${fmt(rows[0].onDate)}.`, sources: rows.map((r) => ({ label: "Fast completed", date: dmy(r.onDate), href: "/faith/fasts" })) };
      }
      if (q.target === "charity") {
        const rows = await db.select().from(charityPayments).where(and(eq(charityPayments.ownerId, ownerId), eq(charityPayments.status, "completed"), isNull(charityPayments.deletedAt))).orderBy(desc(charityPayments.paidOn)).limit(3);
        if (!rows.length) return { answer: "No donations are logged yet.", sources: [] };
        return { answer: `Your last donation was ${formatMoney(rows[0].amountMinor, rows[0].currency)} to ${rows[0].recipient} on ${fmt(rows[0].paidOn)}.`, sources: rows.map((r) => ({ label: `${formatMoney(r.amountMinor, r.currency)} — ${r.recipient}`, date: dmy(r.paidOn), href: "/finance/charity" })) };
      }
      if (q.target.startsWith("routine:")) {
        const id = aliases[q.target.slice(8).replace(/^@/, "")]?.id;
        const [r] = id ? await db.select().from(routines).where(and(eq(routines.id, id), eq(routines.ownerId, ownerId))) : [];
        if (!r) return { answer: "I couldn't tell which routine you meant.", sources: [] };
        const evs = await db.select().from(routineEvents).where(and(eq(routineEvents.routineId, r.id), isNull(routineEvents.voidedAt))).orderBy(desc(routineEvents.onDate)).limit(3);
        if (!evs.length) return { answer: `Nothing is logged for “${r.name}” yet.`, sources: [] };
        const due = routineDue(r, await routineAnchor({ tx: db }, r));
        return { answer: `“${r.name}”: last ${evs[0].type.replace("_", " ")} on ${fmt(evs[0].onDate)}.${due ? ` Next due ${fmt(due)}.` : ""}`, sources: evs.map((e) => ({ label: `${r.name} — ${e.type.replace("_", " ")}`, date: dmy(e.onDate), href: "/care/routines" })) };
      }
      return { answer: "I can look up the last waxing, dental scaling, fast, donation or routine.", sources: [] };
    }
    case "charity_total": {
      const rows = await db.select().from(charityPayments).where(and(eq(charityPayments.ownerId, ownerId), eq(charityPayments.status, "completed"), isNull(charityPayments.deletedAt), gte(charityPayments.paidOn, q.from), lte(charityPayments.paidOn, q.to))).orderBy(desc(charityPayments.paidOn));
      if (!rows.length) return { answer: `No completed donations between ${fmt(q.from)} and ${fmt(q.to)}.`, sources: [] };
      const byCur = new Map<string, number>();
      for (const r of rows) byCur.set(r.currency, (byCur.get(r.currency) ?? 0) + r.amountMinor);
      const totals = [...byCur].map(([c, m]) => formatMoney(m, c)).join(" + ");
      return {
        answer: `You donated ${totals} between ${fmt(q.from)} and ${fmt(q.to)}.`,
        calculation: `${rows.length} completed donation${rows.length === 1 ? "" : "s"} summed per currency; planned donations excluded.`,
        sources: rows.slice(0, 10).map((r) => ({ label: `${formatMoney(r.amountMinor, r.currency)} — ${r.recipient}`, date: dmy(r.paidOn), href: "/finance/charity" })),
      };
    }
    case "fast_balance": {
      const b = await fastBalance({ tx: db, ownerId });
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(fastLedgerEvents).where(and(eq(fastLedgerEvents.ownerId, ownerId), isNull(fastLedgerEvents.voidedAt)));
      return { answer: n ? `Your make-up fast balance is ${b}.` : "You haven't set up a fast balance yet.", calculation: "Opening balance + annual additions + adjustments − completed fasts.", sources: n ? [{ label: "Fast ledger", date: dmy(todayLocal(tz)), href: "/faith/fasts" }] : [] };
    }
    case "debts_outstanding": {
      const ds = await db.select().from(debts).where(and(eq(debts.ownerId, ownerId), eq(debts.status, "open"), isNull(debts.deletedAt), q.direction ? eq(debts.direction, q.direction) : sql`true`));
      if (!ds.length) return { answer: q.direction === "borrowed" ? "You don't owe anyone right now." : q.direction === "lent" ? "No one owes you right now." : "No open lent/borrowed records.", sources: [] };
      const lines: Source[] = [];
      for (const d of ds) {
        const { outstanding } = await debtOutstanding({ tx: db, ownerId }, d.id);
        lines.push({ label: `${d.direction === "lent" ? `${d.counterparty} owes you` : `You owe ${d.counterparty}`} ${formatMoney(outstanding, d.currency)}`, date: dmy(d.dueDate ?? d.onDate), href: "/finance/debts" });
      }
      return { answer: lines.map((l) => l.label).join("; ") + ".", sources: lines };
    }
    case "savings_status": {
      const goals = await db.select().from(savingsGoals).where(and(eq(savingsGoals.ownerId, ownerId), eq(savingsGoals.status, "active"), q.goal && aliases[q.goal.replace(/^@/, "")] ? eq(savingsGoals.id, aliases[q.goal.replace(/^@/, "")].id) : sql`true`));
      if (!goals.length) return { answer: "No active savings goals.", sources: [] };
      const out: Source[] = [];
      for (const g of goals) {
        const [{ net }] = await db.select({ net: sql<string>`coalesce(sum(case when type='deposit' then amount_minor else -amount_minor end),0)` }).from(savingsTransactions).where(and(eq(savingsTransactions.goalId, g.id), isNull(savingsTransactions.voidedAt)));
        const bal = g.openingBalanceMinor + Number(net);
        out.push({ label: `${g.name}: ${formatMoney(bal, g.currency)} of ${formatMoney(g.targetMinor, g.currency)} (${Math.floor((bal / g.targetMinor) * 100)}%)`, date: dmy(todayLocal(tz)), href: "/finance/savings" });
      }
      return { answer: out.map((o) => o.label).join("; ") + ".", calculation: "Opening balance + deposits − withdrawals (planned contributions not counted).", sources: out };
    }
    case "next_class": {
      const o = await db.transaction((tx) => nextClassOccurrence({ tx, ownerId, tz, source: "manual", now: new Date() }));
      if (!o) return { answer: "No upcoming class is scheduled.", sources: [] };
      const hw = await db.select().from(homeworkTasks).where(and(eq(homeworkTasks.occurrenceId, o.id), isNull(homeworkTasks.completedAt)));
      return { answer: `Next class: ${fmtDateTime(o.startsAt, tz)}${hw.length ? ` — ${hw.length} homework item${hw.length === 1 ? "" : "s"} open` : ""}.`, sources: [{ label: "Quran class", date: dmy(o.localDate), href: "/quran" }] };
    }
    case "text": {
      const term = `%${q.q.replace(/[%_\\]/g, "").slice(0, 80)}%`;
      const rows = await db.select().from(auditEvents)
        .where(and(eq(auditEvents.ownerId, ownerId), eq(auditEvents.sensitive, false), or(ilike(auditEvents.summary, term), ilike(auditEvents.category, term))))
        .orderBy(desc(auditEvents.occurredAt)).limit(10);
      if (!rows.length) return { answer: `No results for “${q.q}”.`, sources: [] };
      return { answer: `Found ${rows.length} matching entr${rows.length === 1 ? "y" : "ies"}.`, sources: rows.map((r) => ({ label: r.summary, date: dmy(r.occurredAt.toISOString().slice(0, 10)), href: `/history?q=${encodeURIComponent(q.q)}` })) };
    }
  }
}

export async function searchDirect(owner: { id: string; timezone: string; defaultCurrency: string }, text: string) {
  const priv = await privatePeriodAnswer(owner, text, false);
  if (priv) return priv;
  const { ctx, aliases } = await buildContext(owner.id, owner.timezone, owner.defaultCurrency);
  const out = await getProvider().interpret({ text, ctx });
  if (out.intent === "search" && out.query) return runSearch(owner, out.query, aliases);
  return runSearch(owner, { type: "text", q: text }, aliases);
}


