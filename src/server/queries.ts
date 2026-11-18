import "server-only";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, count, ne } from "drizzle-orm";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { getSession } from "./auth/core";
import { fastBalance, ensureActivity, latestCompletion, routineAnchor, routineDue, type WaxingRule, type DentalRule, dentalDue, applyAnnualFastRules } from "./ops/care";
import { debtOutstanding } from "./ops/finance";
import { ensureOccurrences } from "./ops/planning";
import { addDays, daysBetween, todayLocal, dmy } from "@/lib/time";

export type Owner = typeof t.users.$inferSelect;

/** Page guard: signed-in, fully onboarded owner or redirect. */
export async function pageOwner(): Promise<Owner & { sessionMethod: string }> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.method === "onboarding" || s.user.onboardingStep !== "complete") redirect("/onboarding");
  return { ...s.user, sessionMethod: s.method };
}

const db = () => getDb();
const ctxFor = (o: Owner) => ({ ownerId: o.id, tz: o.timezone, source: "manual" as const, now: new Date() });

export async function inboxCount(ownerId: string) {
  const [{ n }] = await db().select({ n: count() }).from(t.captureDrafts).where(and(eq(t.captureDrafts.ownerId, ownerId), eq(t.captureDrafts.status, "open")));
  return n;
}

/* ───── care ───── */

export async function waxingState(o: Owner) {
  const a = await db().transaction((tx) => ensureActivity({ tx, ownerId: o.id }, "waxing"));
  const rule = a.rule as WaxingRule;
  const last = await latestCompletion({ tx: db() }, a.id);
  const today = todayLocal(o.timezone);
  const events = await db().select().from(t.maintenanceCompletionEvents).where(and(eq(t.maintenanceCompletionEvents.activityId, a.id))).orderBy(desc(t.maintenanceCompletionEvents.completedOn), desc(t.maintenanceCompletionEvents.createdAt)).limit(40);
  if (!last) return { activity: a, rule, last: null, events, day: null, recommended: null, latest: null, overdue: false, today };
  const day = daysBetween(last.completedOn, today);
  return {
    activity: a, rule, last, events, today, day,
    recommended: addDays(last.completedOn, rule.recommendedDay), latest: addDays(last.completedOn, rule.windowDays),
    overdue: day > rule.windowDays,
  };
}

export async function dentalState(o: Owner) {
  const a = await db().transaction((tx) => ensureActivity({ tx, ownerId: o.id }, "dental"));
  const rule = a.rule as DentalRule;
  const last = await latestCompletion({ tx: db() }, a.id);
  const events = await db().select().from(t.maintenanceCompletionEvents).where(eq(t.maintenanceCompletionEvents.activityId, a.id)).orderBy(desc(t.maintenanceCompletionEvents.completedOn)).limit(40);
  const today = todayLocal(o.timezone);
  const due = last ? dentalDue(last.completedOn, rule) : null;
  return { activity: a, rule, last, events, due, daysLeft: due ? daysBetween(today, due) : null, today };
}

export async function routinesState(o: Owner) {
  const rs = await db().select().from(t.routines).where(eq(t.routines.ownerId, o.id)).orderBy(asc(t.routines.createdAt));
  const today = todayLocal(o.timezone);
  return Promise.all(rs.map(async (r) => {
    const anchor = await routineAnchor({ tx: db() }, r);
    const due = routineDue(r, anchor);
    const events = await db().select().from(t.routineEvents).where(eq(t.routineEvents.routineId, r.id)).orderBy(desc(t.routineEvents.onDate), desc(t.routineEvents.createdAt)).limit(12);
    const lastPurchase = events.find((e) => e.type === "purchased" && !e.voidedAt)?.onDate ?? null;
    return { routine: r, anchor, due, daysLeft: due ? daysBetween(today, due) : null, events, lastPurchase };
  }));
}

/* ───── faith ───── */

export async function fastsState(o: Owner) {
  await db().transaction((tx) => applyAnnualFastRules({ ...ctxFor(o), tx }));
  const balance = await fastBalance({ tx: db(), ownerId: o.id });
  const ledger = await db().select().from(t.fastLedgerEvents).where(eq(t.fastLedgerEvents.ownerId, o.id)).orderBy(desc(t.fastLedgerEvents.onDate), desc(t.fastLedgerEvents.createdAt));
  const rules = await db().select().from(t.annualFastAdditionRules).where(eq(t.annualFastAdditionRules.ownerId, o.id));
  const byYear = new Map<string, number>();
  for (const e of ledger) if (e.type === "completed" && !e.voidedAt) byYear.set(e.onDate.slice(0, 4), (byYear.get(e.onDate.slice(0, 4)) ?? 0) + 1);
  return { balance, ledger, rules, byYear: [...byYear].sort((a, b) => b[0].localeCompare(a[0])), hasInitial: ledger.some((e) => e.type === "initial" && !e.voidedAt) };
}

export async function quranState(o: Owner) {
  const evs = await db().select().from(t.recurringEvents).where(eq(t.recurringEvents.ownerId, o.id)).orderBy(asc(t.recurringEvents.createdAt));
  await db().transaction(async (tx) => { for (const e of evs) await ensureOccurrences({ ...ctxFor(o), tx }, e.id); });
  const today = todayLocal(o.timezone);
  const occ = evs.length ? await db().select().from(t.eventOccurrences).where(and(inArray(t.eventOccurrences.eventId, evs.map((e) => e.id)), gte(t.eventOccurrences.localDate, addDays(today, -56)))).orderBy(asc(t.eventOccurrences.startsAt)) : [];
  const hw = occ.length ? await db().select().from(t.homeworkTasks).where(inArray(t.homeworkTasks.occurrenceId, occ.map((x) => x.id))).orderBy(asc(t.homeworkTasks.createdAt)) : [];
  return { events: evs, occurrences: occ, homework: hw, today };
}

/* ───── finance ───── */

export async function charityState(o: Owner, filter: { q?: string; year?: string }) {
  const year = filter.year && /^\d{4}$/.test(filter.year) ? filter.year : todayLocal(o.timezone).slice(0, 4);
  const conds = [eq(t.charityPayments.ownerId, o.id), isNull(t.charityPayments.deletedAt), gte(t.charityPayments.paidOn, `${year}-01-01`), lte(t.charityPayments.paidOn, `${year}-12-31`)];
  if (filter.q) conds.push(sql`(${t.charityPayments.recipient} ilike ${"%" + filter.q + "%"} or ${t.charityPayments.cause} ilike ${"%" + filter.q + "%"})`);
  const rows = await db().select().from(t.charityPayments).where(and(...conds)).orderBy(desc(t.charityPayments.paidOn), desc(t.charityPayments.createdAt));
  const monthly = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.status !== "completed") continue;
    const m = r.paidOn.slice(0, 7);
    const mm = monthly.get(m) ?? new Map();
    mm.set(r.currency, (mm.get(r.currency) ?? 0) + r.amountMinor);
    monthly.set(m, mm);
  }
  return { rows, year, monthly };
}

export async function savingsState(o: Owner) {
  const goals = await db().select().from(t.savingsGoals).where(eq(t.savingsGoals.ownerId, o.id)).orderBy(asc(t.savingsGoals.createdAt));
  return Promise.all(goals.map(async (g) => {
    const txs = await db().select().from(t.savingsTransactions).where(eq(t.savingsTransactions.goalId, g.id)).orderBy(desc(t.savingsTransactions.onDate), desc(t.savingsTransactions.createdAt));
    const live = txs.filter((x) => !x.voidedAt);
    const balance = g.openingBalanceMinor + live.reduce((s, x) => s + (x.type === "deposit" ? x.amountMinor : -x.amountMinor), 0);
    const byMonth = new Map<string, number>();
    for (const x of live) byMonth.set(x.onDate.slice(0, 7), (byMonth.get(x.onDate.slice(0, 7)) ?? 0) + (x.type === "deposit" ? x.amountMinor : -x.amountMinor));
    return { goal: g, txs, balance, pct: g.targetMinor > 0 ? Math.min(100, Math.floor((balance / g.targetMinor) * 100)) : 0, byMonth: [...byMonth].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12) };
  }));
}

export async function debtsState(o: Owner) {
  const ds = await db().select().from(t.debts).where(and(eq(t.debts.ownerId, o.id), isNull(t.debts.deletedAt))).orderBy(asc(t.debts.status), asc(t.debts.dueDate));
  const today = todayLocal(o.timezone);
  return Promise.all(ds.map(async (d) => {
    const { outstanding } = await debtOutstanding({ tx: db(), ownerId: o.id }, d.id);
    const pays = await db().select().from(t.debtRepayments).where(eq(t.debtRepayments.debtId, d.id)).orderBy(desc(t.debtRepayments.onDate));
    return { debt: d, outstanding, pays, overdue: d.status === "open" && !!d.dueDate && d.dueDate < today };
  }));
}

export async function projectsState(o: Owner) {
  const ps = await db().select().from(t.projects).where(and(eq(t.projects.ownerId, o.id), isNull(t.projects.deletedAt))).orderBy(asc(t.projects.status), asc(t.projects.targetDate));
  const ts = await db().select().from(t.tasks).where(and(eq(t.tasks.ownerId, o.id), isNull(t.tasks.deletedAt))).orderBy(asc(t.tasks.dueOn), desc(t.tasks.createdAt));
  return { projects: ps, tasks: ts, today: todayLocal(o.timezone) };
}

/* ───── dashboard ───── */

export async function dashboardState(o: Owner) {
  const overdueApps: Awaited<ReturnType<typeof applicationsState>> = [];
  const today = todayLocal(o.timezone);
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86400_000);
  const [upcoming, sentUnread, wax, dental, routines, fasts, quran, savings, debts, proj, drafts, pendingAi, recent, prefs, subs] = await Promise.all([
    db().select().from(t.reminders).where(and(eq(t.reminders.ownerId, o.id), inArray(t.reminders.status, ["scheduled", "snoozed"]), lte(t.reminders.fireAt, in7))).orderBy(asc(t.reminders.fireAt)).limit(12),
    db().select().from(t.reminders).where(and(eq(t.reminders.ownerId, o.id), eq(t.reminders.status, "sent"), gte(t.reminders.fireAt, new Date(now.getTime() - 3 * 86400_000)))).orderBy(desc(t.reminders.fireAt)).limit(8),
    waxingState(o), dentalState(o), routinesState(o), fastsState(o), quranState(o), savingsState(o), debtsState(o), projectsState(o),
    db().select().from(t.captureDrafts).where(and(eq(t.captureDrafts.ownerId, o.id), eq(t.captureDrafts.status, "open"))).orderBy(desc(t.captureDrafts.createdAt)),
    db().select({ n: count() }).from(t.aiProposals).where(and(eq(t.aiProposals.ownerId, o.id), eq(t.aiProposals.status, "pending"), gte(t.aiProposals.expiresAt, now))),
    db().select().from(t.auditEvents).where(eq(t.auditEvents.ownerId, o.id)).orderBy(desc(t.auditEvents.occurredAt)).limit(8),
    db().select().from(t.notificationPreferences).where(eq(t.notificationPreferences.ownerId, o.id)),
    db().select({ n: count() }).from(t.pushSubscriptions).where(and(eq(t.pushSubscriptions.ownerId, o.id), isNull(t.pushSubscriptions.revokedAt))),
  ]);
  const monthStart = today.slice(0, 8) + "01";
  const charityMonth = await db().select({ cur: t.charityPayments.currency, sum: sql<string>`sum(${t.charityPayments.amountMinor})` }).from(t.charityPayments)
    .where(and(eq(t.charityPayments.ownerId, o.id), eq(t.charityPayments.status, "completed"), isNull(t.charityPayments.deletedAt), gte(t.charityPayments.paidOn, monthStart))).groupBy(t.charityPayments.currency);

  const apps = (await applicationsState(o)).filter((r) => r.open && r.app.deadlineAt && (r.daysLeft ?? 99) <= 30);
  for (const r of apps) if (r.overdue) overdueApps.push(r);
  const names = new Map((await peopleList(o.id)).map((p) => [p.id, p.name]));
  const expiring = (await expiringSoon(o, 90)).map((e) => ({ ...e, label: e.personId && names.get(e.personId) ? `${names.get(e.personId)}'s ${e.label}` : e.label }));
  const overdue: { label: string; detail: string; href: string }[] = [];
  for (const r of overdueApps) overdue.push({ label: `${r.app.university} application`, detail: "Deadline passed and not marked submitted", href: `/education/applications/${r.app.id}` });
  for (const e of expiring) if (e.expiresOn < today) overdue.push({ label: e.label, detail: `Expired ${dmy(e.expiresOn)}`, href: "/admin/expiries" });
  if (wax.overdue && wax.day) overdue.push({ label: "Waxing", detail: `Day ${wax.day} — past your ${wax.rule.windowDays}-day window`, href: "/care/waxing" });
  if (dental.daysLeft !== null && dental.daysLeft < 0) overdue.push({ label: "Dental scaling", detail: `${-dental.daysLeft} days overdue`, href: "/care/dental" });
  for (const r of routines) if (!r.routine.paused && r.daysLeft !== null && r.daysLeft < 0) overdue.push({ label: r.routine.name, detail: `${-r.daysLeft} day${r.daysLeft === -1 ? "" : "s"} overdue`, href: "/care/routines" });
  for (const tk of proj.tasks) if (tk.status !== "done" && tk.dueOn && tk.dueOn < today) overdue.push({ label: tk.title, detail: `Due ${dmy(tk.dueOn)}`, href: "/projects" });
  for (const d of debts) if (d.overdue) overdue.push({ label: d.debt.direction === "lent" ? `Collect from ${d.debt.counterparty}` : `Repay ${d.debt.counterparty}`, detail: `Was due ${dmy(d.debt.dueDate)}`, href: "/finance/debts" });

  const cls = quran.events.find((e) => e.kind === "class");
  const study = quran.events.find((e) => e.kind === "study");
  const nextClass = quran.occurrences.find((x) => cls && x.eventId === cls.id && x.status === "scheduled" && x.startsAt > now) ?? null;
  const openHomework = quran.homework.filter((h) => !h.completedAt);
  const recentlyDone = recent.filter((r) => ["completed", "deposit", "settled", "first_use", "repayment"].includes(r.action)).slice(0, 5);

  return {
    today, upcoming, sentUnread, expiring: expiring.filter((e) => e.expiresOn >= today), appDeadlines: apps.filter((r) => !r.overdue), wax, dental, routines, fasts, savings, debts, drafts, pendingAi: pendingAi[0].n,
    recent, recentlyDone, overdue, charityMonth, cls, study, nextClass, openHomework,
    tasksDueSoon: proj.tasks.filter((x) => x.status !== "done" && x.dueOn && x.dueOn <= addDays(today, 7)).slice(0, 6),
    notif: { pushEnabled: prefs[0]?.pushEnabled ?? false, devices: subs[0].n },
    hidePeriod: true,
  };
}

export async function historyState(o: Owner, q: { q?: string; category?: string; from?: string; to?: string }) {
  const conds = [eq(t.auditEvents.ownerId, o.id)];
  if (q.q) conds.push(sql`${t.auditEvents.summary} ilike ${"%" + q.q.replace(/[%_\\]/g, "") + "%"}`);
  if (q.category) conds.push(eq(t.auditEvents.category, q.category));
  if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) conds.push(gte(t.auditEvents.occurredAt, new Date(q.from + "T00:00:00+03:00")));
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) conds.push(lte(t.auditEvents.occurredAt, new Date(q.to + "T23:59:59+03:00")));
  const rows = await db().select().from(t.auditEvents).where(and(...conds)).orderBy(desc(t.auditEvents.occurredAt)).limit(200);
  const cats = await db().selectDistinct({ c: t.auditEvents.category }).from(t.auditEvents).where(eq(t.auditEvents.ownerId, o.id));
  return { rows, categories: cats.map((c) => c.c).sort() };
}

export async function remindersFor(ownerId: string, sourceType: string, sourceIds: string[]) {
  if (!sourceIds.length) return [];
  return db().select().from(t.reminders).where(and(eq(t.reminders.ownerId, ownerId), eq(t.reminders.sourceType, sourceType), inArray(t.reminders.sourceId, sourceIds), inArray(t.reminders.status, ["scheduled", "snoozed"]), ne(t.reminders.status, "cancelled"))).orderBy(asc(t.reminders.fireAt));
}

/* ───── life admin ───── */

export async function peopleList(ownerId: string) {
  return db().select().from(t.people).where(and(eq(t.people.ownerId, ownerId), isNull(t.people.deletedAt))).orderBy(asc(t.people.createdAt));
}
/** "me" = the owner's own items (person_id is null); a UUID = that family member. */
const personCond = (col: typeof t.documents.personId | typeof t.expiryItems.personId, person?: string) =>
  person === "me" ? isNull(col) : person ? eq(col, person) : undefined;

export async function expiriesState(o: Owner, f: { kind?: string; sort?: string; person?: string } = {}) {
  const conds = [eq(t.expiryItems.ownerId, o.id), isNull(t.expiryItems.deletedAt)];
  if (f.kind) conds.push(eq(t.expiryItems.kind, f.kind));
  const pc = personCond(t.expiryItems.personId, f.person);
  if (pc) conds.push(pc);
  const items = await db().select().from(t.expiryItems).where(and(...conds))
    .orderBy(asc(t.expiryItems.status), f.sort === "latest" ? desc(t.expiryItems.expiresOn) : asc(t.expiryItems.expiresOn));
  const renewals = items.length ? await db().select().from(t.renewalEvents).where(inArray(t.renewalEvents.itemId, items.map((i) => i.id))).orderBy(desc(t.renewalEvents.renewedOn)) : [];
  const docs = await db().select({ id: t.documents.id, title: t.documents.title }).from(t.documents).where(and(eq(t.documents.ownerId, o.id), isNull(t.documents.deletedAt)));
  const today = todayLocal(o.timezone);
  return { items: items.map((i) => ({ item: i, daysLeft: daysBetween(today, i.expiresOn), renewals: renewals.filter((r) => r.itemId === i.id) })), docs, today };
}

export async function documentsState(o: Owner, f: { kind?: string; q?: string; sort?: string; person?: string } = {}) {
  const conds = [eq(t.documents.ownerId, o.id), isNull(t.documents.deletedAt)];
  if (f.kind) conds.push(eq(t.documents.kind, f.kind));
  const pc = personCond(t.documents.personId, f.person);
  if (pc) conds.push(pc);
  const order = f.sort === "expiry" ? [sql`${t.documents.expiresOn} asc nulls last`, asc(t.documents.title)]
    : f.sort === "recent" ? [desc(t.documents.updatedAt)] : [asc(t.documents.kind), asc(t.documents.title)];
  let docs = await db().select().from(t.documents).where(and(...conds)).orderBy(...order);
  if (f.q) {
    const names = new Map((await peopleList(o.id)).map((p) => [p.id, p.name]));
    const self = o.displayName ?? "me";
    docs = rankDocuments(docs.map((d) => ({ ...d, personName: d.personId ? names.get(d.personId) ?? "" : self })), f.q);
  }
  const files = docs.length ? await db().select({
    id: t.documentFiles.id, documentId: t.documentFiles.documentId, version: t.documentFiles.version, filename: t.documentFiles.filename,
    contentType: t.documentFiles.contentType, sizeBytes: t.documentFiles.sizeBytes, createdAt: t.documentFiles.createdAt,
  }).from(t.documentFiles).where(and(inArray(t.documentFiles.documentId, docs.map((d) => d.id)), isNull(t.documentFiles.deletedAt))).orderBy(desc(t.documentFiles.version)) : [];
  const tracked = docs.length ? await db().select({ documentId: t.expiryItems.documentId, id: t.expiryItems.id }).from(t.expiryItems).where(and(inArray(t.expiryItems.documentId, docs.map((d) => d.id)), isNull(t.expiryItems.deletedAt))) : [];
  return docs.map((d) => ({ doc: d, files: files.filter((f) => f.documentId === d.id), tracked: tracked.some((x) => x.documentId === d.id) }));
}

const DOC_KIND_WORDS: Record<string, string> = {
  passport: "passport", national_id: "national id iqama identity card residence", transcript: "transcript grades marks",
  certificate: "certificate certification diploma degree", cv: "cv resume résumé", application: "application",
  letter: "letter official", other: "other",
};

/**
 * Multi-word search: each word may match the title, the document type (e.g. "passport", "iqama",
 * "certificate"), issuer, notes, tags or the last 4 digits of an ID. Documents matching more words
 * rank higher; a title hit counts most. "maryam passport" → title has "maryam" + type is passport → top.
 */
export function rankDocuments<T extends { title: string; kind: string; issuer: string | null; notes: string | null; tags: string[]; idMasked: string | null; personName?: string }>(docs: T[], q: string): T[] {
  const words = q.toLowerCase().normalize("NFKD").split(/[\s,]+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter((w) => w.length >= 2).slice(0, 8);
  if (!words.length) return docs;
  const scored = docs.map((d) => {
    const title = `${d.title} ${d.personName ?? ""}`.toLowerCase();
    const kind = `${d.kind.replace("_", " ")} ${DOC_KIND_WORDS[d.kind] ?? ""}`.toLowerCase();
    const rest = [d.issuer, d.notes, d.tags.join(" "), d.idMasked?.replace(/\D/g, "")].filter(Boolean).join(" ").toLowerCase();
    let score = 0, matched = 0;
    for (const w of words) {
      let s = 0;
      if (title.split(/\s+/).some((t) => t.startsWith(w))) s = 3; else if (title.includes(w)) s = 2.5;
      if (kind.split(/\s+/).some((t) => t.startsWith(w))) s = Math.max(s, 2);
      if (!s && rest.includes(w)) s = 1;
      if (s) { matched++; score += s; }
    }
    return { d, score: score + (matched === words.length ? 5 : 0), matched };
  });
  return scored.filter((x) => x.matched > 0).sort((a, b) => b.score - a.score || a.d.title.localeCompare(b.d.title)).map((x) => x.d);
}

/** Total bytes of live (non-deleted) document files, for the storage meter. */
export async function documentStorageBytes(ownerId: string) {
  const [{ n }] = await db().select({ n: sql<string>`coalesce(sum(${t.documentFiles.sizeBytes}),0)` }).from(t.documentFiles).where(and(eq(t.documentFiles.ownerId, ownerId), isNull(t.documentFiles.deletedAt)));
  return Number(n);
}

export async function expiringSoon(o: Owner, days = 90) {
  const today = todayLocal(o.timezone);
  return db().select().from(t.expiryItems).where(and(eq(t.expiryItems.ownerId, o.id), isNull(t.expiryItems.deletedAt), eq(t.expiryItems.status, "active"), lte(t.expiryItems.expiresOn, addDays(today, days)))).orderBy(asc(t.expiryItems.expiresOn));
}

/* ───── education ───── */

export async function applicationsState(o: Owner) {
  const apps = await db().select().from(t.mastersApplications).where(and(eq(t.mastersApplications.ownerId, o.id), isNull(t.mastersApplications.deletedAt)));
  const reqs = apps.length ? await db().select().from(t.applicationRequirements).where(inArray(t.applicationRequirements.applicationId, apps.map((a) => a.id))) : [];
  const now = Date.now();
  const rows = apps.map((a) => {
    const r = reqs.filter((x) => x.applicationId === a.id);
    const msLeft = a.deadlineAt ? a.deadlineAt.getTime() - now : null;
    const daysLeft = msLeft === null ? null : Math.ceil(msLeft / 86400_000);
    const open = a.status === "researching" || a.status === "preparing";
    // Highlight when inside one of this application's own reminder windows (default 30/14/7/1 days)
    const window = open && daysLeft !== null && daysLeft >= 0 ? [...a.reminderOffsetsDays].map((x) => -x).sort((x, y) => x - y).find((d) => daysLeft <= d) ?? null : null;
    return { app: a, reqTotal: r.length, reqDone: r.filter((x) => x.doneAt).length, daysLeft, open, window, overdue: open && msLeft !== null && msLeft < 0 };
  });
  rows.sort((x, y) => Number(y.open) - Number(x.open) || (x.app.deadlineAt?.getTime() ?? Infinity) - (y.app.deadlineAt?.getTime() ?? Infinity) || x.app.university.localeCompare(y.app.university));
  return rows;
}

export async function applicationDetail(o: Owner, id: string) {
  const [a] = await db().select().from(t.mastersApplications).where(and(eq(t.mastersApplications.id, id), eq(t.mastersApplications.ownerId, o.id), isNull(t.mastersApplications.deletedAt)));
  if (!a) return null;
  const [reqs, events, followUps, docs, allDocs] = await Promise.all([
    db().select().from(t.applicationRequirements).where(eq(t.applicationRequirements.applicationId, a.id)).orderBy(asc(t.applicationRequirements.position)),
    db().select().from(t.applicationStatusEvents).where(eq(t.applicationStatusEvents.applicationId, a.id)).orderBy(desc(t.applicationStatusEvents.onDate), desc(t.applicationStatusEvents.createdAt)),
    db().select().from(t.tasks).where(and(eq(t.tasks.applicationId, a.id), eq(t.tasks.ownerId, o.id), isNull(t.tasks.deletedAt))).orderBy(asc(t.tasks.dueOn)),
    a.documentIds.length ? db().select({ id: t.documents.id, title: t.documents.title, kind: t.documents.kind }).from(t.documents).where(and(inArray(t.documents.id, a.documentIds), eq(t.documents.ownerId, o.id), isNull(t.documents.deletedAt))) : Promise.resolve([]),
    db().select({ id: t.documents.id, title: t.documents.title }).from(t.documents).where(and(eq(t.documents.ownerId, o.id), isNull(t.documents.deletedAt))).orderBy(asc(t.documents.title)),
  ]);
  const rem = await remindersFor(o.id, "application", [a.id]);
  return { app: a, reqs, events, followUps, docs, allDocs, reminders: rem };
}
