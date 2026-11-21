import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, closeDb } from "@/db";
import { reminders, routines, recurringEvents, eventOccurrences, homeworkTasks, fastLedgerEvents } from "@/db/schema";
import { runOpInTx } from "@/server/ops";
import { fastBalance, applyAnnualFastRules, ensureKindRoutine } from "@/server/ops/care";
import { debtOutstanding } from "@/server/ops/finance";
import { ensureOccurrences } from "@/server/ops/planning";
import { resetDb, makeOwner, withCtx } from "../support/db";
import { localToInstant } from "@/lib/time";

const at = (d: string, t = "12:00") => localToInstant(d, t);
let owner: Awaited<ReturnType<typeof makeOwner>>;
const op = (now: Date, name: string, input: unknown) =>
  withCtx(owner.id, now, (ctx) => runOpInTx(ctx.tx, { ownerId: ctx.ownerId, tz: ctx.tz, source: "manual", now }, name, input));
const pending = (sourceType = "routine") => getDb().select().from(reminders)
  .where(and(eq(reminders.ownerId, owner.id), eq(reminders.sourceType, sourceType), eq(reminders.status, "scheduled")));

beforeEach(async () => { await resetDb(); owner = await makeOwner(); });
afterAll(async () => { await closeDb(); });

describe("Test 1 — waxing resets from the latest actual completion", () => {
  it("Nov 1 schedules 27/30 and one overdue nudge on 31; Nov 29 cancels the old ones and restarts", async () => {
    await op(at("2026-11-01"), "waxing.complete", { completedOn: "2026-11-01" });
    let r = await pending();
    expect(r.map((x) => x.fireAt.toISOString()).sort()).toEqual(["2026-11-28", "2026-12-01", "2026-12-02"].map((d) => localToInstant(d, "09:00").toISOString()));

    await op(at("2026-11-29"), "waxing.complete", { completedOn: "2026-11-29" });
    r = await pending();
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.dedupeKey.includes("2026-12-29"))).toBe(true); // due date of the new cycle
    const cancelled = await getDb().select().from(reminders).where(and(eq(reminders.sourceType, "routine"), eq(reminders.status, "cancelled")));
    expect(cancelled.length).toBeGreaterThanOrEqual(2); // the remaining Nov-1 schedule
  });

  it("correcting history recalculates without duplicates", async () => {
    await op(at("2026-11-01"), "waxing.complete", { completedOn: "2026-11-01" });
    const ev = await op(at("2026-11-05"), "waxing.complete", { completedOn: "2026-11-05" });
    await op(at("2026-11-06"), "routine.void", { eventId: ev.id });
    const r = await pending();
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.dedupeKey.includes("2026-12-01"))).toBe(true);
  });

  it("refuses a future completion date", async () => {
    await expect(op(at("2026-11-01"), "waxing.complete", { completedOn: "2026-11-02" })).rejects.toThrow(/future/);
  });
});

describe("Routines are generic", () => {
  it("a custom routine nudges once the day after it is due, marked private", async () => {
    const r = await op(at("2026-11-01"), "routine.create", { name: "Threading", intervalValue: 3, intervalUnit: "week", graceDays: 7, reminderOffsetsDays: [0, 7], sensitive: true, reminderTime: "20:00" });
    await op(at("2026-11-02"), "routine.log", { routineId: r.id, type: "completed", onDate: "2026-11-02" });
    const rs = await pending();
    expect(rs.map((x) => x.fireAt.toISOString()).sort()).toEqual(["2026-11-23", "2026-11-24"].map((d) => localToInstant(d, "20:00").toISOString()));
    expect(rs.every((x) => x.sensitive)).toBe(true);
  });
  it("templates add an editable routine once", async () => {
    await op(at("2026-11-01"), "routine.template", { template: "bedsheets" });
    const rows = await getDb().select().from(routines).where(eq(routines.ownerId, owner.id));
    expect(rows.map((x) => [x.name, x.intervalValue, x.intervalUnit])).toEqual([["Change bedsheets", 7, "day"]]);
  });
});

describe("Test 2 — dental six calendar months", () => {
  it("Jan 31 → due Jul 31 with reminders 14d, 1d, on the day", async () => {
    await op(at("2026-01-31"), "dental.complete", { completedOn: "2026-01-31" });
    const r = await pending();
    expect(r.map((x) => x.fireAt.toISOString()).sort()).toEqual(["2026-07-17", "2026-07-30", "2026-07-31", "2026-08-01"].map((d) => localToInstant(d, "09:00").toISOString()));
  });
  it("settings change reminder offsets", async () => {
    await op(at("2026-01-31"), "dental.complete", { completedOn: "2026-01-31" });
    const [d] = await getDb().select().from(routines).where(and(eq(routines.ownerId, owner.id), eq(routines.kind, "dental")));
    expect(d.name).toBe("Dental scaling");
    await op(at("2026-02-01"), "routine.update", { id: d.id, name: d.name, kind: "dental", anchor: "completed", intervalValue: 6, intervalUnit: "month", reminderTime: "10:00", remindersEnabled: true, reminderOffsetsDays: [-30, 0] });
    const r = await pending();
    expect(r.map((x) => x.fireAt.toISOString()).sort()).toEqual(["2026-07-01", "2026-07-31", "2026-08-01"].map((d) => localToInstant(d, "10:00").toISOString()));
  });
});

describe("Test 3 — toothbrush uses first-use date", () => {
  it("purchase and first use stored separately; due = first use + 3 months", async () => {
    const [r] = await getDb().insert(routines).values({ ownerId: owner.id, name: "Replace toothbrush", kind: "toothbrush", anchor: "first_use", intervalValue: 3, intervalUnit: "month", reminderOffsetsDays: [-14, 0] }).returning();
    await op(at("2026-11-10"), "routine.log", { routineId: r.id, type: "purchased", onDate: "2026-11-01" });
    expect(await pending("routine")).toHaveLength(0); // purchase alone doesn't start the clock
    await op(at("2026-11-10"), "routine.log", { routineId: r.id, type: "first_use", onDate: "2026-11-10" });
    const rem = await pending("routine");
    expect(rem.map((x) => x.fireAt.toISOString()).sort()).toEqual(["2027-01-27", "2027-02-10", "2027-02-11"].map((d) => localToInstant(d, "09:00").toISOString()));
  });
});

describe("Test 4 — make-up fasts ledger", () => {
  it("annual addition is idempotent across retries; completion decrements by 1", async () => {
    await op(at("2026-11-18"), "fasts.initial", { count: 10, asOf: "2026-01-01" });
    await op(at("2026-11-18"), "fasts.rule.save", { amount: 6, calendar: "gregorian", month: 3, day: 1, startYear: 2026 });
    for (let i = 0; i < 3; i++) await withCtx(owner.id, at("2026-11-18"), (ctx) => applyAnnualFastRules(ctx));
    expect(await fastBalance({ tx: getDb(), ownerId: owner.id })).toBe(16);
    const adds = await getDb().select().from(fastLedgerEvents).where(eq(fastLedgerEvents.type, "annual_addition"));
    expect(adds).toHaveLength(1);
    await op(at("2026-11-18"), "fasts.complete", { onDate: "2026-11-17" });
    expect(await fastBalance({ tx: getDb(), ownerId: owner.id })).toBe(15);
  });
  it("same date twice needs an explicit historical correction", async () => {
    await op(at("2026-11-18"), "fasts.initial", { count: 3, asOf: "2026-01-01" });
    await op(at("2026-11-18"), "fasts.complete", { onDate: "2026-11-17" });
    await expect(op(at("2026-11-18"), "fasts.complete", { onDate: "2026-11-17" })).rejects.toThrow(/already recorded/);
  });
  it("no accidental negative balance", async () => {
    await expect(op(at("2026-11-18"), "fasts.complete", { onDate: "2026-11-17" })).rejects.toThrow(/don't owe any fasts/);
    await expect(op(at("2026-11-18"), "fasts.adjust", { delta: -2, onDate: "2026-11-18", reason: "x" })).rejects.toThrow(/can't go below 0/);
    // The old "override" escape hatch is gone: the balance can never be pushed below 0.
    await expect(op(at("2026-11-18"), "fasts.adjust", { delta: -2, onDate: "2026-11-18", reason: "x", overrideNegative: true })).rejects.toThrow(/can't go below 0/);
  });
  it("Hijri rule adds on the Umm al-Qura date only once that date has passed", async () => {
    await op(at("2026-11-18"), "fasts.rule.save", { amount: 5, calendar: "hijri", month: 10, day: 1, startYear: 1447 });
    const adds = await getDb().select().from(fastLedgerEvents).where(eq(fastLedgerEvents.type, "annual_addition"));
    expect(adds.map((a) => a.periodKey)).toEqual(["hijri:1447"]); // 1 Shawwal 1448 is in 2027 → not yet
  });
});

describe("Test 5 — lent/borrowed partial repayments", () => {
  it("updates outstanding and settles at zero; reminders say collect vs repay", async () => {
    const d = await op(at("2026-11-18"), "debt.create", { direction: "lent", counterparty: "Sara", amount: "200", currency: "SAR", onDate: "2026-11-17", dueDate: "2026-11-20" });
    let r = await pending("debt");
    expect(r.some((x) => x.title === "I need to collect")).toBe(true);
    await op(at("2026-11-19"), "debt.repay", { debtId: d.id, amount: "50", onDate: "2026-11-19" });
    expect((await debtOutstanding({ tx: getDb(), ownerId: owner.id }, d.id!)).outstanding).toBe(15000);
    await expect(op(at("2026-11-19"), "debt.repay", { debtId: d.id, amount: "151", onDate: "2026-11-19" })).rejects.toThrow(/more than the outstanding/);
    await op(at("2026-11-19"), "debt.repay", { debtId: d.id, amount: "150", onDate: "2026-11-19" });
    const o = await debtOutstanding({ tx: getDb(), ownerId: owner.id }, d.id!);
    expect(o.outstanding).toBe(0);
    expect(o.debt.status).toBe("settled");
    r = await pending("debt");
    expect(r).toHaveLength(0);

    const b = await op(at("2026-11-18"), "debt.create", { direction: "borrowed", counterparty: "Nora", amount: "80", currency: "SAR", onDate: "2026-11-18", dueDate: "2026-11-25" });
    const rb = await getDb().select().from(reminders).where(eq(reminders.sourceId, b.id!));
    expect(rb.some((x) => x.title === "I need to repay")).toBe(true);
  });
});

describe("Test 6 — savings: plans aren't money", () => {
  it("planned monthly amount does not change balance; deposits do", async () => {
    const g = await op(at("2026-11-18"), "savings.goal.create", { name: "Laptop", target: "5000", currency: "SAR", plannedMonthly: "500", reminderDayOfMonth: 1, remindersEnabled: true });
    const { runSearch } = await import("@/server/ai/service");
    let s = await runSearch({ id: owner.id, timezone: "Asia/Riyadh" }, { type: "savings_status" }, {});
    expect(s.answer).toContain("0 SAR of 5,000 SAR");
    await op(at("2026-11-18"), "savings.deposit", { goalId: g.id, amount: "750.25", onDate: "2026-11-18" });
    s = await runSearch({ id: owner.id, timezone: "Asia/Riyadh" }, { type: "savings_status" }, {});
    expect(s.answer).toContain("750.25 SAR of 5,000 SAR (15%)");
    await expect(op(at("2026-11-18"), "savings.withdraw", { goalId: g.id, amount: "1000", onDate: "2026-11-18" })).rejects.toThrow(/exceeds/);
  });
});

describe("Tests 7 & 25 — Quran class", () => {
  async function setup(now: Date) {
    const [cls] = await getDb().insert(recurringEvents).values({ ownerId: owner.id, kind: "class", title: "Quran class", weekday: 7, localTime: "19:00", startDate: "2026-11-18", reminderLeadMinutes: 60 }).returning();
    await withCtx(owner.id, now, (ctx) => ensureOccurrences(ctx, cls.id));
    return cls;
  }
  it("every Sunday 19:00 Riyadh with an 18:00 reminder; editable to 30 min", async () => {
    const now = at("2026-11-18");
    const cls = await setup(now);
    const occ = await getDb().select().from(eventOccurrences).where(eq(eventOccurrences.eventId, cls.id));
    expect(occ).toHaveLength(8);
    const first = occ.sort((a, b) => a.localDate.localeCompare(b.localDate))[0];
    expect(first.localDate).toBe("2026-11-22");
    expect(first.startsAt.toISOString()).toBe("2026-11-22T16:00:00.000Z");
    let [rem] = await getDb().select().from(reminders).where(and(eq(reminders.sourceId, first.id), eq(reminders.status, "scheduled")));
    expect(rem.fireAt.toISOString()).toBe("2026-11-22T15:00:00.000Z"); // 18:00 Riyadh
    await op(now, "event.update", { id: cls.id, title: "Quran class", weekday: 7, localTime: "19:00", reminderLeadMinutes: 30, remindersEnabled: true });
    [rem] = await getDb().select().from(reminders).where(and(eq(reminders.sourceId, first.id), eq(reminders.status, "scheduled")));
    expect(rem.fireAt.toISOString()).toBe("2026-11-22T15:30:00.000Z"); // 18:30 Riyadh
  });
  it("homework is per occurrence; cancelling one class leaves others and history intact", async () => {
    const now = at("2026-11-18");
    const cls = await setup(now);
    const occ = (await getDb().select().from(eventOccurrences).where(eq(eventOccurrences.eventId, cls.id))).sort((a, b) => a.localDate.localeCompare(b.localDate));
    const h1 = await op(now, "homework.create", { title: "Memorise Al-Mulk 1-5" });
    await op(now, "homework.create", { occurrenceId: occ[1].id, title: "Revise Al-Mulk" });
    await op(now, "homework.update", { id: h1.id, title: "Memorise Al-Mulk 1-5", done: true });
    const hw = await getDb().select().from(homeworkTasks);
    expect(hw.find((h) => h.occurrenceId === occ[0].id)?.completedAt).not.toBeNull();
    expect(hw.find((h) => h.occurrenceId === occ[1].id)?.completedAt).toBeNull();

    await op(now, "occurrence.update", { id: occ[0].id, status: "cancelled", scope: "one" });
    const after = await getDb().select().from(eventOccurrences).where(eq(eventOccurrences.eventId, cls.id));
    expect(after.filter((o) => o.status === "cancelled")).toHaveLength(1);
    expect(await getDb().select().from(homeworkTasks)).toHaveLength(2);
    const remCancelled = await getDb().select().from(reminders).where(and(eq(reminders.sourceId, occ[0].id), eq(reminders.status, "scheduled")));
    expect(remCancelled).toHaveLength(0);

    await op(now, "occurrence.update", { id: occ[3].id, status: "cancelled", scope: "future" });
    const final = await getDb().select().from(eventOccurrences).where(eq(eventOccurrences.eventId, cls.id));
    expect(final.filter((o) => o.status === "scheduled").map((o) => o.localDate).sort()).toEqual(["2026-11-29", "2026-12-06"]);
  });
});

describe("Test 17 — owner isolation in ops", () => {
  it("cannot touch another owner's records by ID", async () => {
    const other = await makeOwner("other@example.com");
    const d = await withCtx(other.id, at("2026-11-18"), (ctx) => runOpInTx(ctx.tx, { ownerId: other.id, tz: ctx.tz, source: "manual", now: ctx.now }, "debt.create", { direction: "lent", counterparty: "X", amount: "10", currency: "SAR", onDate: "2026-11-18" }));
    await expect(op(at("2026-11-18"), "debt.repay", { debtId: d.id, amount: "5", onDate: "2026-11-18" })).rejects.toThrow(/not found/);
    await expect(op(at("2026-11-18"), "charity.delete", { id: d.id })).rejects.toThrow(/not found/);
    const a = await withCtx(other.id, at("2026-11-18"), (ctx) => ensureKindRoutine({ ...ctx, source: "manual" }, "waxing"));
    expect(a.ownerId).toBe(other.id);
    await expect(op(at("2026-11-18"), "routine.log", { routineId: a.id, type: "completed", onDate: "2026-11-18" })).rejects.toThrow(/not found/);
  });
});
