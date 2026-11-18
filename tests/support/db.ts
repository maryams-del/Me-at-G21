import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import type { Ctx } from "@/server/audit";

export async function resetDb() {
  const db = getDb();
  const r = await db.execute(sql`select tablename from pg_tables where schemaname='public'`);
  const names = (r.rows as { tablename: string }[]).map((x) => `"${x.tablename}"`).join(",");
  if (names) await db.execute(sql.raw(`truncate ${names} restart identity cascade`));
}

export async function makeOwner(email = "owner@example.com") {
  const [u] = await getDb().insert(users).values({ email, onboardingStep: "complete", emailVerifiedAt: new Date() }).returning();
  return u;
}

/** Run fn in a transaction with a ctx at a fixed "now". */
export async function withCtx<T>(ownerId: string, now: Date, fn: (ctx: Ctx) => Promise<T>, source: "manual" | "ai" = "manual") {
  return getDb().transaction((tx) => fn({ tx, ownerId, tz: "Asia/Riyadh", source, now }));
}

/** Snapshot of row counts for every user-data table (used to prove "no write before confirm"). */
export async function userDataCounts() {
  const tables = ["charity_payments", "maintenance_completion_events", "routine_events", "fast_ledger_events", "savings_transactions", "savings_goals", "debts", "debt_repayments", "projects", "tasks", "homework_tasks", "reminders", "capture_drafts", "audit_events"];
  const out: Record<string, number> = {};
  for (const t of tables) {
    const r = await getDb().execute(sql.raw(`select count(*)::int as n from ${t}`));
    out[t] = (r.rows[0] as { n: number }).n;
  }
  return out;
}
