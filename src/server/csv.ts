import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { fromMinor } from "@/lib/money";
import { dmy } from "@/lib/time";
import { decPeriodField } from "./ops/period";

/*
 * Spreadsheet (CSV) export, one file per section. Opens in Excel, Numbers and Google Sheets.
 * Dates are dd/mm/yyyy, money is a plain number with its currency in the next column.
 * Never included: passwords/vault, sign-in secrets, full ID numbers, file contents.
 * The period log is only exported when explicitly requested.
 */

type Cell = string | number | boolean | null | undefined;
const esc = (v: Cell) => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
  // guard against spreadsheet formula injection from text fields
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export function toCsv(header: string[], rows: Cell[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}
const d = (x: string | null | undefined) => (x ? dmy(x) : "");
const ts = (x: Date | null | undefined, tz: string) => (x ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(x).replace(",", "") : "");
const m = (minor: number | null | undefined, cur: string) => (minor === null || minor === undefined ? "" : fromMinor(minor, cur));

export type CsvModule = { key: string; label: string; group: string; private?: boolean; build: (ownerId: string, tz: string) => Promise<{ header: string[]; rows: Cell[][] }> };

const db = () => getDb();

export const CSV_MODULES: CsvModule[] = [
  { key: "charity", label: "Charity", group: "Finance", async build(o) {
    const r = await db().select().from(t.charityPayments).where(and(eq(t.charityPayments.ownerId, o), isNull(t.charityPayments.deletedAt))).orderBy(desc(t.charityPayments.paidOn));
    return { header: ["Date", "Recipient", "Cause", "Amount", "Currency", "Status", "Recurring", "Notes"], rows: r.map((x) => [d(x.paidOn), x.recipient, x.cause, m(x.amountMinor, x.currency), x.currency, x.status, x.recurring, x.notes]) };
  } },
  { key: "savings", label: "Savings deposits & withdrawals", group: "Finance", async build(o) {
    const goals = await db().select().from(t.savingsGoals).where(eq(t.savingsGoals.ownerId, o));
    const r = await db().select().from(t.savingsTransactions).where(and(eq(t.savingsTransactions.ownerId, o), isNull(t.savingsTransactions.voidedAt))).orderBy(desc(t.savingsTransactions.onDate));
    const g = (id: string) => goals.find((x) => x.id === id);
    return { header: ["Date", "Goal", "Type", "Amount", "Currency", "Notes"], rows: r.map((x) => [d(x.onDate), g(x.goalId)?.name, x.type, m(x.amountMinor, g(x.goalId)?.currency ?? "SAR"), g(x.goalId)?.currency, x.notes]) };
  } },
  { key: "savings-goals", label: "Savings goals", group: "Finance", async build(o) {
    const r = await db().select().from(t.savingsGoals).where(eq(t.savingsGoals.ownerId, o)).orderBy(asc(t.savingsGoals.name));
    return { header: ["Goal", "Target", "Currency", "Target date", "Opening balance", "Planned per month", "Status", "Notes"], rows: r.map((x) => [x.name, m(x.targetMinor, x.currency), x.currency, d(x.targetDate), m(x.openingBalanceMinor, x.currency), m(x.plannedMonthlyMinor, x.currency), x.status, x.notes]) };
  } },
  { key: "debts", label: "Lent & borrowed", group: "Finance", async build(o) {
    const r = await db().select().from(t.debts).where(and(eq(t.debts.ownerId, o), isNull(t.debts.deletedAt))).orderBy(desc(t.debts.onDate));
    const reps = await db().select().from(t.debtRepayments).where(and(eq(t.debtRepayments.ownerId, o), isNull(t.debtRepayments.voidedAt)));
    return { header: ["Date", "Direction", "Person", "Original amount", "Repaid", "Adjustments", "Outstanding", "Currency", "Due", "Status", "Notes"], rows: r.map((x) => {
      const mine = reps.filter((p) => p.debtId === x.id);
      const paid = mine.filter((p) => p.type === "repayment").reduce((a, p) => a + p.amountMinor, 0);
      const adj = mine.filter((p) => p.type === "adjustment").reduce((a, p) => a + p.amountMinor, 0);
      return [d(x.onDate), x.direction === "lent" ? "I lent (owed to me)" : "I borrowed (I owe)", x.counterparty, m(x.originalMinor, x.currency), m(paid, x.currency), m(adj, x.currency), m(x.originalMinor + adj - paid, x.currency), x.currency, d(x.dueDate), x.status, x.notes];
    }) };
  } },
  { key: "subscriptions", label: "Subscriptions", group: "Finance", async build(o) {
    const r = await db().select().from(t.subscriptions).where(and(eq(t.subscriptions.ownerId, o), isNull(t.subscriptions.deletedAt))).orderBy(asc(t.subscriptions.name));
    return { header: ["Service", "Category", "Cost", "Currency", "Billed", "Billing anchor date", "Renews", "Trial ends", "Paid with", "Status", "Cancelled on", "Link", "Notes"], rows: r.map((x) => [x.name, x.category, m(x.amountMinor, x.currency), x.currency, x.cadence === "custom" ? `every ${x.intervalValue} ${x.intervalUnit}s` : x.cadence, d(x.anchorDate), x.renewal, d(x.trialEndsOn), x.paymentLabel, x.status, d(x.cancelledOn), x.url, x.notes]) };
  } },
  { key: "zakat-payments", label: "Zakat payments", group: "Finance", async build(o) {
    const r = await db().select().from(t.zakatPayments).where(and(eq(t.zakatPayments.ownerId, o), isNull(t.zakatPayments.deletedAt))).orderBy(desc(t.zakatPayments.paidOn));
    return { header: ["Date", "Paid to", "Amount", "Currency", "Notes"], rows: r.map((x) => [d(x.paidOn), x.recipient, m(x.amountMinor, x.currency), x.currency, x.notes]) };
  } },
  { key: "zakat-estimates", label: "Zakat estimates", group: "Finance", async build(o) {
    const r = await db().select().from(t.zakatCalculations).where(and(eq(t.zakatCalculations.ownerId, o), isNull(t.zakatCalculations.deletedAt))).orderBy(desc(t.zakatCalculations.evaluationDate));
    return { header: ["As of", "Currency", "Assets", "Deductions", "Net", "Nisab basis", "Price per gram", "Nisab", "Rate %", "Estimate", "Notes"], rows: r.map((x) => [d(x.evaluationDate), x.currency, m(x.assetsMinor, x.currency), m(x.liabilitiesMinor, x.currency), m(x.netMinor, x.currency), x.nisabBasis, x.pricePerGram, m(x.nisabMinor, x.currency), x.rateBp / 100, m(x.zakatMinor, x.currency), x.notes]) };
  } },
  { key: "fasts", label: "Make-up fasts ledger", group: "Faith", async build(o) {
    const r = await db().select().from(t.fastLedgerEvents).where(and(eq(t.fastLedgerEvents.ownerId, o), isNull(t.fastLedgerEvents.voidedAt))).orderBy(asc(t.fastLedgerEvents.onDate), asc(t.fastLedgerEvents.createdAt));
    let bal = 0;
    return { header: ["Date", "Entry", "Change", "Balance after", "Reason"], rows: r.map((x) => { bal += x.delta; return [d(x.onDate), x.type.replace(/_/g, " "), x.delta, bal, x.reason]; }) };
  } },
  { key: "routines", label: "Routine history", group: "Personal care", async build(o) {
    const rs = await db().select().from(t.routines).where(eq(t.routines.ownerId, o));
    const r = await db().select().from(t.routineEvents).where(and(eq(t.routineEvents.ownerId, o), isNull(t.routineEvents.voidedAt))).orderBy(desc(t.routineEvents.onDate));
    return { header: ["Date", "Routine", "What happened", "Notes"], rows: r.map((x) => [d(x.onDate), rs.find((y) => y.id === x.routineId)?.name, x.type.replace("_", " "), x.notes]) };
  } },
  { key: "period", label: "Period log", group: "Personal care", private: true, async build(o) {
    const r = await db().select().from(t.periodCycles).where(and(eq(t.periodCycles.ownerId, o), isNull(t.periodCycles.deletedAt))).orderBy(desc(t.periodCycles.startDate));
    return { header: ["Started", "Start time", "Ended", "End time", "Symptoms", "Notes"], rows: r.map((x) => {
      let sym = "";
      try { sym = x.symptomsEnc ? (JSON.parse(decPeriodField(o, x.id, "symptoms", x.symptomsEnc) ?? "[]") as string[]).join("; ") : ""; } catch { sym = ""; }
      return [d(x.startDate), x.startTime, d(x.endDate), x.endTime, sym, decPeriodField(o, x.id, "notes", x.notesEnc)];
    }) };
  } },
  { key: "expiries", label: "Expiries", group: "Life admin", async build(o) {
    const people = await db().select().from(t.people).where(eq(t.people.ownerId, o));
    const r = await db().select().from(t.expiryItems).where(and(eq(t.expiryItems.ownerId, o), isNull(t.expiryItems.deletedAt))).orderBy(asc(t.expiryItems.expiresOn));
    return { header: ["Item", "Type", "Belongs to", "Expires", "Issuer"], rows: r.map((x) => [x.label, x.kind, x.personId ? people.find((p) => p.id === x.personId)?.name : "Me", d(x.expiresOn), x.issuer]) };
  } },
  { key: "documents", label: "Documents (details only, no files or ID numbers)", group: "Life admin", async build(o) {
    const people = await db().select().from(t.people).where(eq(t.people.ownerId, o));
    const files = await db().select({ documentId: t.documentFiles.documentId }).from(t.documentFiles).where(and(eq(t.documentFiles.ownerId, o), isNull(t.documentFiles.deletedAt)));
    const r = await db().select().from(t.documents).where(and(eq(t.documents.ownerId, o), isNull(t.documents.deletedAt))).orderBy(asc(t.documents.kind), asc(t.documents.title));
    return { header: ["Title", "Type", "Belongs to", "Issuer", "Issued", "Expires", "ID (masked)", "Files", "Notes"], rows: r.map((x) => [x.title, x.kind, x.personId ? people.find((p) => p.id === x.personId)?.name : "Me", x.issuer, d(x.issuedOn), d(x.expiresOn), x.idMasked, files.filter((f) => f.documentId === x.id).length, x.notes]) };
  } },
  { key: "applications", label: "Master's applications", group: "Education & career", async build(o, tz) {
    const r = await db().select().from(t.mastersApplications).where(and(eq(t.mastersApplications.ownerId, o), isNull(t.mastersApplications.deletedAt))).orderBy(asc(t.mastersApplications.deadlineAt));
    return { header: ["University", "Program", "Country", "Intake", "Deadline (university's time)", "Timezone", "Deadline (your time)", "Verified", "Status", "Submitted", "Fee", "Fee currency", "Link", "Notes"], rows: r.map((x) => [x.university, x.program, x.country, x.intake, x.deadlineDate ? `${d(x.deadlineDate)} ${x.deadlineTime ?? "23:59"}` : "", x.deadlineTz, ts(x.deadlineAt, tz), x.deadlineVerified, x.status, d(x.submittedOn), x.feeMinor !== null ? m(x.feeMinor, x.feeCurrency ?? "SAR") : "", x.feeCurrency, x.url, x.notes]) };
  } },
  { key: "tasks", label: "Projects & tasks", group: "Education & career", async build(o) {
    const ps = await db().select().from(t.projects).where(eq(t.projects.ownerId, o));
    const r = await db().select().from(t.tasks).where(and(eq(t.tasks.ownerId, o), isNull(t.tasks.deletedAt))).orderBy(asc(t.tasks.dueOn));
    return { header: ["Task", "Project", "Status", "Due", "Due time", "Priority", "Notes"], rows: r.map((x) => [x.title, ps.find((p) => p.id === x.projectId)?.name, x.status, d(x.dueOn), x.dueTime, x.priority, x.notes]) };
  } },
  { key: "achievements", label: "Achievements", group: "Education & career", async build(o) {
    const r = await db().select().from(t.achievements).where(and(eq(t.achievements.ownerId, o), isNull(t.achievements.deletedAt))).orderBy(desc(t.achievements.endDate));
    return { header: ["Title", "Type", "Area", "Where", "Started", "Finished", "Outcome", "CV line", "Skills", "Tags", "Links", "Details"], rows: r.map((x) => [x.title, x.kind, x.area, x.organisation, d(x.startDate), d(x.endDate), x.outcome, x.summary, x.skills.join("; "), x.tags.join("; "), x.links.map((l) => l.url).join(" "), x.description]) };
  } },
  { key: "hobbies", label: "Hobbies", group: "Education & career", async build(o) {
    const r = await db().select().from(t.hobbies).where(and(eq(t.hobbies.ownerId, o), isNull(t.hobbies.deletedAt))).orderBy(asc(t.hobbies.name));
    return { header: ["Hobby", "Level", "Since", "Active", "Tags", "Notes"], rows: r.map((x) => [x.name, x.level, d(x.since), x.active, x.tags.join("; "), x.notes]) };
  } },
  { key: "homework", label: "Quran class homework", group: "Faith", async build(o, tz) {
    const r = await db().select().from(t.homeworkTasks).where(eq(t.homeworkTasks.ownerId, o)).orderBy(desc(t.homeworkTasks.createdAt));
    return { header: ["Homework", "Reference", "Due", "Priority", "Completed", "Details"], rows: r.map((x) => [x.title, x.reference, ts(x.dueAt, tz), x.priority, ts(x.completedAt, tz), x.description]) };
  } },
];
