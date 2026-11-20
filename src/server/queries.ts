import "server-only";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, count, ne, lt } from "drizzle-orm";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { getSession } from "./auth/core";
import { fastBalance, routineAnchor, routineDue, routineSkipped, applyAnnualFastRules } from "./ops/care";
import { debtOutstanding } from "./ops/finance";
import { decPeriodField, periodEstimate, periodSettingsOf } from "./ops/period";
import { cvBullet } from "./ops/career";
import { periodOf, chargesBetween, nextCharge, monthlyEquivalentMinor } from "./ops/subscriptions";
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

export async function routinesState(o: Owner) {
  const rs = await db().select().from(t.routines).where(eq(t.routines.ownerId, o.id)).orderBy(asc(t.routines.createdAt));
  const today = todayLocal(o.timezone);
  return Promise.all(rs.map(async (r) => {
    const anchor = await routineAnchor({ tx: db() }, r);
    const skipped = await routineSkipped({ tx: db() }, r, anchor);
    const due = skipped ? null : routineDue(r, anchor);
    const events = await db().select().from(t.routineEvents).where(eq(t.routineEvents.routineId, r.id)).orderBy(desc(t.routineEvents.onDate), desc(t.routineEvents.createdAt)).limit(12);
    const lastPurchase = events.find((e) => e.type === "purchased" && !e.voidedAt)?.onDate ?? null;
    const latest = due;
    const daysSince = anchor ? daysBetween(anchor, today) : null;
    const overdue = !r.paused && !!latest && today > latest;
    return { routine: r, anchor, due, latest, daysSince, cycleDays: anchor && latest ? daysBetween(anchor, latest) : null, daysLeft: due ? daysBetween(today, due) : null, overdue, skipped, events, lastPurchase };
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
  // Suggestions for the form: the platforms/recipients and causes used most often, across all years.
  const top = async (col: typeof t.charityPayments.recipient | typeof t.charityPayments.cause) => (await db()
    .select({ v: col, n: sql<number>`count(*)` }).from(t.charityPayments)
    .where(and(eq(t.charityPayments.ownerId, o.id), isNull(t.charityPayments.deletedAt), sql`${col} is not null and ${col} <> ''`))
    .groupBy(col).orderBy(sql`count(*) desc`).limit(12)).map((r) => r.v as string);
  const [recipients, causes] = await Promise.all([top(t.charityPayments.recipient), top(t.charityPayments.cause)]);
  return { rows, year, monthly, recipients, causes };
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
  const [upcoming, sentUnread, routines, fasts, quran, savings, debts, proj, drafts, pendingAi, recent, prefs, subs] = await Promise.all([
    db().select().from(t.reminders).where(and(eq(t.reminders.ownerId, o.id), inArray(t.reminders.status, ["scheduled", "snoozed"]), lte(t.reminders.fireAt, in7))).orderBy(asc(t.reminders.fireAt)).limit(12),
    db().select().from(t.reminders).where(and(eq(t.reminders.ownerId, o.id), eq(t.reminders.status, "sent"), gte(t.reminders.fireAt, new Date(now.getTime() - 3 * 86400_000)))).orderBy(desc(t.reminders.fireAt)).limit(8),
    routinesState(o), fastsState(o), quranState(o), savingsState(o), debtsState(o), projectsState(o),
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
  for (const r of routines) if (r.overdue) overdue.push({ label: r.routine.name, detail: `${-(r.daysLeft ?? 0)} day${r.daysLeft === -1 ? "" : "s"} overdue`, href: "/care/routines" });
  for (const tk of proj.tasks) if (tk.status !== "done" && tk.dueOn && tk.dueOn < today) overdue.push({ label: tk.title, detail: `Due ${dmy(tk.dueOn)}`, href: "/projects" });
  for (const d of debts) if (d.overdue) overdue.push({ label: d.debt.direction === "lent" ? `Collect from ${d.debt.counterparty}` : `Repay ${d.debt.counterparty}`, detail: `Was due ${dmy(d.debt.dueDate)}`, href: "/finance/debts" });

  const cls = quran.events.find((e) => e.kind === "class");
  const study = quran.events.find((e) => e.kind === "study");
  const nextClass = quran.occurrences.find((x) => cls && x.eventId === cls.id && x.status === "scheduled" && x.startsAt > now) ?? null;
  const openHomework = quran.homework.filter((h) => !h.completedAt);
  // actual calendar items for the week (not reminders): every scheduled class/event occurrence
  const weekEnd = addDays(todayLocal(o.timezone), 6);
  const weekEvents = quran.occurrences
    .filter((x) => x.status === "scheduled" && x.localDate >= todayLocal(o.timezone) && x.localDate <= weekEnd)
    .map((x) => { const ev = quran.events.find((e) => e.id === x.eventId); return ev && !ev.paused ? { date: x.localDate, startsAt: x.startsAt, title: ev.title, kind: ev.kind } : null; })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const recentlyDone = recent.filter((r) => ["completed", "deposit", "settled", "first_use", "repayment"].includes(r.action)).slice(0, 5);

  return {
    today, upcoming, sentUnread, expiring: expiring.filter((e) => e.expiresOn >= today), appDeadlines: apps.filter((r) => !r.overdue), routines, fasts, savings, debts, drafts, pendingAi: pendingAi[0].n,
    recent, recentlyDone, overdue, charityMonth, cls, study, nextClass, openHomework, weekEvents,
    tasksDueSoon: proj.tasks.filter((x) => x.status !== "done" && x.dueOn && x.dueOn <= addDays(today, 7)).slice(0, 6),
    notif: { pushEnabled: prefs[0]?.pushEnabled ?? false, devices: subs[0].n },
    period: periodSettingsOf(o.settings).showOnDashboard ? await periodState(o) : null,
    subscriptions: await subscriptionsState(o),
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
export async function expiriesState(o: Owner, f: { kind?: string; sort?: string; reminders?: string; q?: string } = {}) {
  const conds = [eq(t.expiryItems.ownerId, o.id), isNull(t.expiryItems.deletedAt)];
  if (f.kind) conds.push(eq(t.expiryItems.kind, f.kind));
  if (f.reminders === "on" || f.reminders === "off") conds.push(eq(t.expiryItems.remindersEnabled, f.reminders === "on"));
  if (f.q) conds.push(sql`(${t.expiryItems.label} ilike ${"%" + f.q + "%"} or ${t.expiryItems.notes} ilike ${"%" + f.q + "%"})`);
  const items = await db().select().from(t.expiryItems).where(and(...conds))
    .orderBy(asc(t.expiryItems.status), f.sort === "latest" ? desc(t.expiryItems.expiresOn) : asc(t.expiryItems.expiresOn));
  const renewals = items.length ? await db().select().from(t.renewalEvents).where(inArray(t.renewalEvents.itemId, items.map((i) => i.id))).orderBy(desc(t.renewalEvents.renewedOn)) : [];
  const docs = await db().select({ id: t.documents.id, title: t.documents.title }).from(t.documents).where(and(eq(t.documents.ownerId, o.id), isNull(t.documents.deletedAt)));
  const today = todayLocal(o.timezone);
  const docIds = items.map((i) => i.documentId).filter((x): x is string => !!x);
  const files = docIds.length ? await db().select({ id: t.documentFiles.id, documentId: t.documentFiles.documentId, filename: t.documentFiles.filename, contentType: t.documentFiles.contentType, version: t.documentFiles.version })
    .from(t.documentFiles).where(and(inArray(t.documentFiles.documentId, docIds), isNull(t.documentFiles.deletedAt))).orderBy(asc(t.documentFiles.version)) : [];
  return { items: items.map((i) => ({ item: i, daysLeft: daysBetween(today, i.expiresOn), renewals: renewals.filter((r) => r.itemId === i.id), files: files.filter((f) => f.documentId === i.documentId) })), docs, today };
}

export async function documentsState(o: Owner, f: { kind?: string; q?: string; sort?: string; reminders?: string } = {}) {
  const conds = [eq(t.documents.ownerId, o.id), isNull(t.documents.deletedAt)];
  if (f.kind) conds.push(eq(t.documents.kind, f.kind));
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
  const tracked = docs.length ? await db().select({ documentId: t.expiryItems.documentId, id: t.expiryItems.id, remindersEnabled: t.expiryItems.remindersEnabled, reminderOffsetsDays: t.expiryItems.reminderOffsetsDays, reminderTime: t.expiryItems.reminderTime })
    .from(t.expiryItems).where(and(inArray(t.expiryItems.documentId, docs.map((d) => d.id)), isNull(t.expiryItems.deletedAt))) : [];
  const out = docs.map((d) => {
    const it = tracked.find((x) => x.documentId === d.id) ?? null;
    return { doc: d, files: files.filter((f) => f.documentId === d.id), tracked: !!it?.remindersEnabled, reminders: it };
  });
  return f.reminders === "on" ? out.filter((x) => x.tracked) : f.reminders === "off" ? out.filter((x) => !x.tracked) : out;
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

/* ── Period log: decrypted only here, for the signed-in owner's own page ── */
export async function periodState(o: Owner, opts: { withDetails?: boolean } = {}) {
  const rows = await db().select().from(t.periodCycles).where(and(eq(t.periodCycles.ownerId, o.id), isNull(t.periodCycles.deletedAt))).orderBy(asc(t.periodCycles.startDate));
  const today = todayLocal(o.timezone);
  const settings = periodSettingsOf(o.settings);
  const cycles = rows.map((r, n) => {
    const next = rows[n + 1];
    let symptoms: string[] = [];
    if (opts.withDetails && r.symptomsEnc) { try { symptoms = JSON.parse(decPeriodField(o.id, r.id, "symptoms", r.symptomsEnc) ?? "[]"); } catch { symptoms = []; } }
    return {
      id: r.id, startDate: r.startDate, startTime: r.startTime, endDate: r.endDate, endTime: r.endTime,
      length: r.endDate ? daysBetween(r.startDate, r.endDate) + 1 : null,
      cycleLength: next ? daysBetween(r.startDate, next.startDate) : null,
      notes: opts.withDetails ? decPeriodField(o.id, r.id, "notes", r.notesEnc) : null,
      symptoms,
    };
  });
  const open = cycles.find((c) => !c.endDate) ?? null;
  const estimate = periodEstimate(cycles);
  return {
    today, settings, cycles: [...cycles].reverse(), open,
    openDay: open ? daysBetween(open.startDate, today) + 1 : null,
    estimate, daysToEstimate: estimate ? daysBetween(today, estimate.nextStart) : null,
  };
}

export async function achievementsState(o: Owner, f: { q?: string; kind?: string; area?: string; tag?: string; year?: string } = {}) {
  const [all, hobbyRows, projectRows, appRows, docRows] = await Promise.all([
    db().select().from(t.achievements).where(and(eq(t.achievements.ownerId, o.id), isNull(t.achievements.deletedAt))),
    db().select().from(t.hobbies).where(and(eq(t.hobbies.ownerId, o.id), isNull(t.hobbies.deletedAt))).orderBy(desc(t.hobbies.active), asc(t.hobbies.name)),
    db().select({ id: t.projects.id, name: t.projects.name, status: t.projects.status }).from(t.projects).where(and(eq(t.projects.ownerId, o.id), isNull(t.projects.deletedAt))),
    db().select({ id: t.mastersApplications.id, university: t.mastersApplications.university, program: t.mastersApplications.program, status: t.mastersApplications.status }).from(t.mastersApplications).where(and(eq(t.mastersApplications.ownerId, o.id), isNull(t.mastersApplications.deletedAt))),
    db().select({ id: t.documents.id, title: t.documents.title, kind: t.documents.kind }).from(t.documents).where(and(eq(t.documents.ownerId, o.id), isNull(t.documents.deletedAt))),
  ]);
  const words = (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const sortKey = (a: typeof all[number]) => a.endDate ?? a.startDate ?? a.createdAt.toISOString().slice(0, 10);
  const rows = all.filter((a) => {
    if (f.kind && a.kind !== f.kind) return false;
    if (f.area && a.area !== f.area) return false;
    if (f.tag && !a.tags.concat(a.skills).some((x) => x.toLowerCase() === f.tag!.toLowerCase())) return false;
    if (f.year && !(sortKey(a).startsWith(f.year) || (a.startDate ?? "").startsWith(f.year))) return false;
    if (words.length) {
      const hay = [a.title, a.organisation, a.description, a.outcome, a.summary, a.kind, a.area, ...a.tags, ...a.skills].filter(Boolean).join(" ").toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  }).sort((a, b) => Number(b.featured) - Number(a.featured) || sortKey(b).localeCompare(sortKey(a)));
  const tags = [...new Set(all.flatMap((a) => [...a.tags, ...a.skills]))].sort((a, b) => a.localeCompare(b));
  const years = [...new Set(all.map((a) => sortKey(a).slice(0, 4)))].sort().reverse();
  return {
    rows: rows.map((a) => ({ ...a, bullet: cvBullet(a), project: projectRows.find((p) => p.id === a.projectId) ?? null, application: appRows.find((x) => x.id === a.applicationId) ?? null, docs: docRows.filter((d) => a.documentIds.includes(d.id)) })),
    total: all.length, hobbies: hobbyRows, tags, years, projects: projectRows, applications: appRows, documents: docRows,
  };
}

export async function subscriptionsState(o: Owner) {
  const today = todayLocal(o.timezone);
  const all = await db().select().from(t.subscriptions).where(and(eq(t.subscriptions.ownerId, o.id), isNull(t.subscriptions.deletedAt))).orderBy(asc(t.subscriptions.name));
  const rows = all.map((s) => {
    const p = periodOf(s);
    const next = s.status === "active" ? nextCharge(s.anchorDate, p, today) : null;
    return { sub: s, next, daysLeft: next ? daysBetween(today, next) : null, monthlyMinor: monthlyEquivalentMinor(s.amountMinor, p), inTrial: !!s.trialEndsOn && s.trialEndsOn >= today };
  }).sort((a, b) => (a.next ?? "9999").localeCompare(b.next ?? "9999"));
  const active = rows.filter((r) => r.sub.status === "active");
  const totals: Record<string, { monthly: number; yearly: number }> = {};
  for (const r of active) {
    const c = r.sub.currency;
    totals[c] ??= { monthly: 0, yearly: 0 };
    totals[c].monthly += r.monthlyMinor;
    totals[c].yearly += r.monthlyMinor * 12;
  }
  const horizon = addDays(today, 60);
  const upcoming = active.flatMap((r) => chargesBetween(r.sub.anchorDate, periodOf(r.sub), today, horizon, 10)
    .filter((d) => !r.sub.trialEndsOn || d >= r.sub.trialEndsOn)
    .map((d) => ({ date: d, id: r.sub.id, name: r.sub.name, amountMinor: r.sub.amountMinor, currency: r.sub.currency, renewal: r.sub.renewal })))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { today, rows, active, totals, upcoming, horizon };
}

export async function zakatState(o: Owner) {
  const [calcs, pays] = await Promise.all([
    db().select().from(t.zakatCalculations).where(and(eq(t.zakatCalculations.ownerId, o.id), isNull(t.zakatCalculations.deletedAt))).orderBy(desc(t.zakatCalculations.evaluationDate), desc(t.zakatCalculations.createdAt)),
    db().select().from(t.zakatPayments).where(and(eq(t.zakatPayments.ownerId, o.id), isNull(t.zakatPayments.deletedAt))).orderBy(desc(t.zakatPayments.paidOn)),
  ]);
  const paidFor = (id: string) => pays.filter((p) => p.calculationId === id);
  return {
    calcs: calcs.map((c) => {
      const ps = paidFor(c.id).filter((p) => p.currency === c.currency);
      return { calc: c, paidMinor: ps.reduce((a, p) => a + p.amountMinor, 0), payments: ps.length };
    }),
    payments: pays.map((p) => ({ ...p, calc: calcs.find((c) => c.id === p.calculationId) ?? null })),
  };
}

/* ───── custom spaces ───── */

export async function customSpacesState(o: Owner) {
  const spaces = await db().select().from(t.customSpaces).where(and(eq(t.customSpaces.ownerId, o.id), isNull(t.customSpaces.deletedAt))).orderBy(asc(t.customSpaces.createdAt));
  const items = spaces.length ? await db().select({ spaceId: t.customSpaceItems.spaceId, done: t.customSpaceItems.done }).from(t.customSpaceItems).where(inArray(t.customSpaceItems.spaceId, spaces.map((s) => s.id))) : [];
  return spaces.map((s) => {
    const mine = items.filter((i) => i.spaceId === s.id);
    return { space: s, open: mine.filter((i) => !i.done).length, done: mine.filter((i) => i.done).length };
  });
}

export async function customSpaceDetail(o: Owner, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [s] = await db().select().from(t.customSpaces).where(and(eq(t.customSpaces.id, id), eq(t.customSpaces.ownerId, o.id)));
  if (!s) return null;
  const items = await db().select().from(t.customSpaceItems).where(eq(t.customSpaceItems.spaceId, s.id)).orderBy(asc(t.customSpaceItems.done), asc(t.customSpaceItems.createdAt));
  return { space: s, items };
}

/* ───── attention needed (the Inbox) ───── */

export type AttentionItem = { key: string; kind: "missing" | "overdue" | "storage"; label: string; detail: string; href: string };
const STORAGE_LIMIT = 1024 * 1024 * 1024; // Vercel Blob free allowance

/** Everything that needs the owner's attention: captures missing details, anything past its date, storage running out. */
export async function attentionItems(o: Owner): Promise<{ items: AttentionItem[]; drafts: (typeof t.captureDrafts.$inferSelect)[] }> {
  const today = todayLocal(o.timezone);
  const [drafts, rs, exp, dbs, tasks, apps, bytes] = await Promise.all([
    db().select().from(t.captureDrafts).where(and(eq(t.captureDrafts.ownerId, o.id), eq(t.captureDrafts.status, "open"))).orderBy(desc(t.captureDrafts.createdAt)),
    routinesState(o),
    db().select().from(t.expiryItems).where(and(eq(t.expiryItems.ownerId, o.id), isNull(t.expiryItems.deletedAt), eq(t.expiryItems.status, "active"), lt(t.expiryItems.expiresOn, today))),
    db().select().from(t.debts).where(and(eq(t.debts.ownerId, o.id), isNull(t.debts.deletedAt), eq(t.debts.status, "open"), lt(t.debts.dueDate, today))),
    db().select().from(t.tasks).where(and(eq(t.tasks.ownerId, o.id), isNull(t.tasks.deletedAt), ne(t.tasks.status, "done"), lt(t.tasks.dueOn, today))),
    applicationsState(o),
    documentStorageBytes(o.id),
  ]);
  const items: AttentionItem[] = [];
  for (const d of drafts) items.push({ key: `d${d.id}`, kind: "missing", label: `“${d.sourceText}” has missing information`, detail: `Missing: ${d.missingFields.join(", ")}`, href: "/inbox" });
  for (const r of rs) if (r.overdue) items.push({ key: `r${r.routine.id}`, kind: "overdue", label: `${r.routine.name} is overdue`, detail: `Was due ${dmy(r.due!)}`, href: "/care/routines" });
  for (const e of exp) items.push({ key: `e${e.id}`, kind: "overdue", label: `${e.label} has expired`, detail: `Expired ${dmy(e.expiresOn)}`, href: "/admin/expiries" });
  for (const d of dbs) items.push({ key: `b${d.id}`, kind: "overdue", label: d.direction === "lent" ? `${d.counterparty} hasn't repaid you` : `Repayment to ${d.counterparty} is overdue`, detail: `Was due ${dmy(d.dueDate!)}`, href: "/finance/debts" });
  for (const tk of tasks) items.push({ key: `t${tk.id}`, kind: "overdue", label: `${tk.title} is overdue`, detail: `Was due ${dmy(tk.dueOn!)}`, href: "/projects" });
  for (const a of apps) if (a.overdue) items.push({ key: `a${a.app.id}`, kind: "overdue", label: `${a.app.university} application deadline has passed`, detail: "Not marked as submitted", href: `/education/applications/${a.app.id}` });
  if (bytes > STORAGE_LIMIT * 0.8) items.push({ key: "storage", kind: "storage", label: "Document storage is running out", detail: `${Math.round((bytes / STORAGE_LIMIT) * 100)}% of 1 GB used`, href: "/admin/documents" });
  return { items, drafts };
}

export async function attentionCount(o: Owner) {
  return (await attentionItems(o)).items.length;
}
