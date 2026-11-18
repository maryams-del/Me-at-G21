import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { requireUser, AuthError } from "@/server/auth/core";

/** Machine-readable export of non-secret app data. Auth/security secrets are never included. */
export async function GET() {
  try {
    const s = await requireUser();
    const db = getDb();
    const o = s.user.id;
    const [charity, maint, maintEvents, routines, routineEvents, fasts, fastRules, goals, savingsTx, debts, repayments, projects, tasks, events, occurrences, homework, drafts, history] = await Promise.all([
      db.select().from(t.charityPayments).where(eq(t.charityPayments.ownerId, o)),
      db.select().from(t.maintenanceActivities).where(eq(t.maintenanceActivities.ownerId, o)),
      db.select().from(t.maintenanceCompletionEvents).where(eq(t.maintenanceCompletionEvents.ownerId, o)),
      db.select().from(t.routines).where(eq(t.routines.ownerId, o)),
      db.select().from(t.routineEvents).where(eq(t.routineEvents.ownerId, o)),
      db.select().from(t.fastLedgerEvents).where(eq(t.fastLedgerEvents.ownerId, o)),
      db.select().from(t.annualFastAdditionRules).where(eq(t.annualFastAdditionRules.ownerId, o)),
      db.select().from(t.savingsGoals).where(eq(t.savingsGoals.ownerId, o)),
      db.select().from(t.savingsTransactions).where(eq(t.savingsTransactions.ownerId, o)),
      db.select().from(t.debts).where(eq(t.debts.ownerId, o)),
      db.select().from(t.debtRepayments).where(eq(t.debtRepayments.ownerId, o)),
      db.select().from(t.projects).where(eq(t.projects.ownerId, o)),
      db.select().from(t.tasks).where(eq(t.tasks.ownerId, o)),
      db.select().from(t.recurringEvents).where(eq(t.recurringEvents.ownerId, o)),
      db.select().from(t.eventOccurrences).where(eq(t.eventOccurrences.ownerId, o)),
      db.select().from(t.homeworkTasks).where(eq(t.homeworkTasks.ownerId, o)),
      db.select().from(t.captureDrafts).where(eq(t.captureDrafts.ownerId, o)),
      db.select().from(t.auditEvents).where(eq(t.auditEvents.ownerId, o)),
    ]);
    const data = {
      format: "me-at-g21-export", version: 1, exportedAt: new Date().toISOString(), timezone: s.user.timezone,
      note: "Money values are integer minor units (e.g. halalas). Local dates are in the timezone above.",
      charity, maintenance: { activities: maint, events: maintEvents }, routines: { routines, events: routineEvents },
      fasts: { ledger: fasts, rules: fastRules }, savings: { goals, transactions: savingsTx }, debts: { debts, repayments },
      projects: { projects, tasks }, classes: { events, occurrences, homework }, drafts, history,
    };
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="me-at-g21-export-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
