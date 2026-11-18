import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  maintenanceActivities, maintenanceCompletionEvents, routines, routineEvents,
  fastLedgerEvents, annualFastAdditionRules,
} from "@/db/schema";
import { defineOp, zDate, zId, zOptText, zText, zTime } from "./registry";
import { audit, UserError, type Ctx } from "../audit";
import { addDays, addMonths, addInterval, localToInstant, todayLocal, toHijri, fromHijri, type LocalDate, dmy } from "@/lib/time";
import { syncReminders, cancelReminders, type DesiredReminder } from "../reminders";

/* ───────────── Waxing & dental (maintenance activities) ───────────── */

export type WaxingRule = { windowDays: number; recommendedDay: number; reminderDays: number[] };
export type DentalRule = { intervalMonths: number; reminderOffsetsDays: number[] };

export const DEFAULT_WAXING_RULE: WaxingRule = { windowDays: 40, recommendedDay: 30, reminderDays: [27, 30, 35, 38, 40] };
export const DEFAULT_DENTAL_RULE: DentalRule = { intervalMonths: 6, reminderOffsetsDays: [-14, -1, 0] };

export async function ensureActivity(ctx: Pick<Ctx, "tx" | "ownerId">, kind: "waxing" | "dental"): Promise<typeof maintenanceActivities.$inferSelect> {
  const [a] = await ctx.tx.select().from(maintenanceActivities)
    .where(and(eq(maintenanceActivities.ownerId, ctx.ownerId), eq(maintenanceActivities.kind, kind)));
  if (a) return a;
  const [created] = await ctx.tx.insert(maintenanceActivities).values({
    ownerId: ctx.ownerId, kind,
    name: kind === "waxing" ? "Waxing" : "Dental scaling",
    rule: kind === "waxing" ? DEFAULT_WAXING_RULE : DEFAULT_DENTAL_RULE,
  }).onConflictDoNothing().returning();
  return created ?? (await ensureActivity(ctx, kind));
}

export async function latestCompletion(ctx: Pick<Ctx, "tx">, activityId: string) {
  const [e] = await ctx.tx.select().from(maintenanceCompletionEvents)
    .where(and(eq(maintenanceCompletionEvents.activityId, activityId), isNull(maintenanceCompletionEvents.voidedAt)))
    .orderBy(desc(maintenanceCompletionEvents.completedOn), desc(maintenanceCompletionEvents.createdAt)).limit(1);
  return e ?? null;
}

/** Pure: the reminder set for a waxing anchor date. Exported for unit tests. */
export function waxingReminders(activityId: string, anchor: LocalDate, rule: WaxingRule, time: string, tz: string): DesiredReminder[] {
  return rule.reminderDays.map((day) => ({
    dedupeKey: `waxing:${activityId}:${anchor}:d${day}`,
    fireAt: localToInstant(addDays(anchor, day), time, tz),
    title: day >= rule.windowDays ? `Waxing: day ${day} — last day of your ${rule.windowDays}-day window` : `Waxing: day ${day} of ${rule.windowDays}`,
    publicBody: day < rule.recommendedDay ? `Recommended date is day ${rule.recommendedDay}` : day === rule.recommendedDay ? "Recommended date is today" : `Latest target is day ${rule.windowDays}`,
    sensitive: true,
    link: "/care/waxing",
  }));
}

export function dentalDue(anchor: LocalDate, rule: DentalRule) {
  return addMonths(anchor, rule.intervalMonths);
}

export function dentalReminders(activityId: string, anchor: LocalDate, rule: DentalRule, time: string, tz: string): DesiredReminder[] {
  const due = dentalDue(anchor, rule);
  return rule.reminderOffsetsDays.map((off) => ({
    dedupeKey: `dental:${activityId}:${due}:o${off}`,
    fireAt: localToInstant(addDays(due, off), time, tz),
    title: "Dental scaling",
    publicBody: off === 0 ? "Due today (your six-month cadence)" : `Due in ${-off} day${off === -1 ? "" : "s"}`,
    link: "/care/dental",
  }));
}

export async function syncMaintenance(ctx: Ctx, activityId: string) {
  const [a] = await ctx.tx.select().from(maintenanceActivities).where(eq(maintenanceActivities.id, activityId));
  const last = await latestCompletion(ctx, activityId);
  if (!a || !last || !a.remindersEnabled) return cancelReminders(ctx.tx, ctx.ownerId, a?.kind ?? "maintenance", activityId);
  const desired = a.kind === "waxing"
    ? waxingReminders(a.id, last.completedOn, a.rule as WaxingRule, a.reminderTime, ctx.tz)
    : dentalReminders(a.id, last.completedOn, a.rule as DentalRule, a.reminderTime, ctx.tz);
  await syncReminders(ctx.tx, ctx.ownerId, a.kind, a.id, desired, ctx.now);
}

function completeOp(kind: "waxing" | "dental") {
  return defineOp({
    name: `${kind}.complete`, module: kind, label: kind === "waxing" ? "Waxing completed" : "Dental scaling completed",
    aiAllowed: true,
    schema: z.object({ completedOn: zDate, detail: zOptText(200), notes: zOptText() }),
    summarize: (i) => `Log ${kind === "waxing" ? "waxing" : "dental scaling"} done on ${dmy(i.completedOn)}; restart the ${kind === "waxing" ? "40-day cycle (reminders on days 27, 30, 35, 38, 40)" : "six-month cadence"} from that date`,
    async run(ctx, i) {
      if (i.completedOn > todayLocal(ctx.tz, ctx.now)) throw new UserError("Completion date can't be in the future", "completedOn");
      const a = await ensureActivity(ctx, kind);
      const [e] = await ctx.tx.insert(maintenanceCompletionEvents).values({
        ownerId: ctx.ownerId, activityId: a.id, completedOn: i.completedOn, detail: i.detail, notes: i.notes, source: ctx.source,
      }).returning({ id: maintenanceCompletionEvents.id });
      await syncMaintenance(ctx, a.id);
      const msg = `${a.name} completed on ${dmy(i.completedOn)}`;
      await audit(ctx, kind, "completed", "maintenance_event", e.id, msg, kind === "waxing");
      return { id: e.id, message: msg };
    },
  });
}
export const waxingComplete = completeOp("waxing");
export const dentalComplete = completeOp("dental");

export const maintenanceVoid = defineOp({
  name: "maintenance.void", module: "care", label: "Remove a logged date", aiAllowed: false,
  schema: z.object({ eventId: zId, reason: zText(300) }),
  summarize: (i) => `Remove logged date (${i.reason})`,
  async run(ctx, i) {
    const res = await ctx.tx.update(maintenanceCompletionEvents).set({ voidedAt: ctx.now, voidReason: i.reason })
      .where(and(eq(maintenanceCompletionEvents.id, i.eventId), eq(maintenanceCompletionEvents.ownerId, ctx.ownerId), isNull(maintenanceCompletionEvents.voidedAt)))
      .returning({ activityId: maintenanceCompletionEvents.activityId, on: maintenanceCompletionEvents.completedOn });
    if (!res.length) throw new UserError("Entry not found");
    await syncMaintenance(ctx, res[0].activityId); // recalculates from the remaining latest entry
    await audit(ctx, "care", "corrected", "maintenance_event", i.eventId, `Removed entry for ${dmy(res[0].on)}: ${i.reason}`, true);
    return { id: i.eventId, message: "Entry removed and schedule recalculated" };
  },
});

export const maintenanceSettings = defineOp({
  name: "maintenance.settings", module: "care", label: "Reminder settings", aiAllowed: false,
  schema: z.object({
    kind: z.enum(["waxing", "dental"]), reminderTime: zTime, remindersEnabled: z.boolean(),
    reminderDays: z.array(z.number().int().min(1).max(120)).max(10).optional(),
    reminderOffsetsDays: z.array(z.number().int().min(-90).max(0)).max(10).optional(),
    intervalMonths: z.number().int().min(1).max(24).optional(),
  }),
  summarize: (i) => `Update ${i.kind} reminder settings`,
  async run(ctx, i) {
    const a = await ensureActivity(ctx, i.kind);
    const rule = { ...(a.rule as object) } as Record<string, unknown>;
    if (i.kind === "waxing" && i.reminderDays) rule.reminderDays = [...new Set(i.reminderDays)].sort((x, y) => x - y);
    if (i.kind === "dental") {
      if (i.reminderOffsetsDays) rule.reminderOffsetsDays = [...new Set(i.reminderOffsetsDays)].sort((x, y) => x - y);
      if (i.intervalMonths) rule.intervalMonths = i.intervalMonths;
    }
    await ctx.tx.update(maintenanceActivities).set({ rule, reminderTime: i.reminderTime, remindersEnabled: i.remindersEnabled, updatedAt: ctx.now })
      .where(eq(maintenanceActivities.id, a.id));
    await syncMaintenance(ctx, a.id);
    await audit(ctx, i.kind, "settings", "maintenance_activity", a.id, `Updated ${a.name} reminders`);
    return { id: a.id, message: "Settings saved" };
  },
});

/* ───────────── Routines (toothbrush, brushes, bedsheets, custom) ───────────── */

type RoutineRow = typeof routines.$inferSelect;

export async function routineAnchor(ctx: Pick<Ctx, "tx">, r: RoutineRow): Promise<LocalDate | null> {
  const types = r.anchor === "first_use" ? ["first_use", "skipped"] : ["completed", "skipped"];
  const [e] = await ctx.tx.select().from(routineEvents)
    .where(and(eq(routineEvents.routineId, r.id), isNull(routineEvents.voidedAt), inArray(routineEvents.type, types)))
    .orderBy(desc(routineEvents.onDate), desc(routineEvents.createdAt)).limit(1);
  return e?.onDate ?? null;
}

export function routineDue(r: Pick<RoutineRow, "intervalValue" | "intervalUnit" | "snoozedUntil">, anchor: LocalDate | null): LocalDate | null {
  if (!anchor) return null;
  const due = addInterval(anchor, r.intervalValue, r.intervalUnit as "day" | "week" | "month");
  return r.snoozedUntil && r.snoozedUntil > due ? r.snoozedUntil : due;
}

export async function syncRoutine(ctx: Ctx, routineId: string) {
  const [r] = await ctx.tx.select().from(routines).where(eq(routines.id, routineId));
  if (!r) return;
  const anchor = await routineAnchor(ctx, r);
  const due = routineDue(r, anchor);
  if (!due || r.paused || !r.remindersEnabled) return cancelReminders(ctx.tx, ctx.ownerId, "routine", r.id);
  const desired = r.reminderOffsetsDays.map((off) => ({
    dedupeKey: `routine:${r.id}:${due}:o${off}`,
    fireAt: localToInstant(addDays(due, off), r.reminderTime, ctx.tz),
    title: r.name,
    publicBody: off === 0 ? "Due today" : `Due in ${-off} day${off === -1 ? "" : "s"}`,
    link: "/care/routines",
  }));
  await syncReminders(ctx.tx, ctx.ownerId, "routine", r.id, desired, ctx.now);
}

const routineInput = z.object({
  name: zText(120), kind: z.enum(["toothbrush", "brushes", "bedsheets", "custom"]).default("custom"),
  anchor: z.enum(["completed", "first_use"]).default("completed"),
  intervalValue: z.number().int().min(1).max(365), intervalUnit: z.enum(["day", "week", "month"]),
  reminderOffsetsDays: z.array(z.number().int().min(-60).max(0)).max(6).default([0]),
  reminderTime: zTime.default("09:00"), remindersEnabled: z.boolean().default(true), notes: zOptText(),
});

export const routineCreate = defineOp({
  name: "routine.create", module: "routines", label: "New routine", aiAllowed: true,
  schema: routineInput,
  summarize: (i) => `Create routine “${i.name}” every ${i.intervalValue} ${i.intervalUnit}${i.intervalValue > 1 ? "s" : ""}`,
  async run(ctx, i) {
    const [r] = await ctx.tx.insert(routines).values({ ownerId: ctx.ownerId, ...i }).returning({ id: routines.id });
    await audit(ctx, "routines", "created", "routine", r.id, `Created routine “${i.name}”`);
    return { id: r.id, message: `Routine “${i.name}” created` };
  },
});

export const routineUpdate = defineOp({
  name: "routine.update", module: "routines", label: "Edit routine", aiAllowed: false,
  schema: routineInput.extend({ id: zId, paused: z.boolean().default(false) }),
  summarize: (i) => `Update routine “${i.name}”`,
  async run(ctx, i) {
    const { id: rid, ...rest } = i;
    const res = await ctx.tx.update(routines).set({ ...rest, updatedAt: ctx.now })
      .where(and(eq(routines.id, rid), eq(routines.ownerId, ctx.ownerId))).returning({ id: routines.id });
    if (!res.length) throw new UserError("Routine not found");
    await syncRoutine(ctx, rid);
    await audit(ctx, "routines", i.paused ? "paused" : "edited", "routine", rid, `Updated routine “${i.name}”`);
    return { id: rid, message: "Routine updated" };
  },
});

export const routineLog = defineOp({
  name: "routine.log", module: "routines", label: "Log routine event", aiAllowed: true,
  schema: z.object({
    routineId: zId,
    type: z.enum(["completed", "skipped", "purchased", "first_use"]),
    onDate: zDate, notes: zOptText(),
  }),
  draftable: ["routineId"],
  summarize: (i) => `${{ completed: "Mark done", skipped: "Skip this cycle", purchased: "Record purchase", first_use: "Record first use" }[i.type]} on ${dmy(i.onDate)}`,
  async run(ctx, i) {
    const [r] = await ctx.tx.select().from(routines).where(and(eq(routines.id, i.routineId), eq(routines.ownerId, ctx.ownerId)));
    if (!r) throw new UserError("Routine not found");
    if (i.onDate > todayLocal(ctx.tz, ctx.now)) throw new UserError("Date can't be in the future", "onDate");
    const [e] = await ctx.tx.insert(routineEvents).values({ ownerId: ctx.ownerId, routineId: r.id, type: i.type, onDate: i.onDate, notes: i.notes, source: ctx.source }).returning({ id: routineEvents.id });
    if (r.snoozedUntil) await ctx.tx.update(routines).set({ snoozedUntil: null }).where(eq(routines.id, r.id));
    await syncRoutine(ctx, r.id);
    const verb = { completed: "done", skipped: "skipped", purchased: "purchased", first_use: "first used" }[i.type];
    const msg = `${r.name} — ${verb} on ${dmy(i.onDate)}`;
    await audit(ctx, "routines", i.type, "routine_event", e.id, msg);
    return { id: e.id, message: msg };
  },
});

export const routineSnooze = defineOp({
  name: "routine.snooze", module: "routines", label: "Snooze routine", aiAllowed: false,
  schema: z.object({ routineId: zId, until: zDate }),
  summarize: (i) => `Snooze until ${dmy(i.until)}`,
  async run(ctx, i) {
    const res = await ctx.tx.update(routines).set({ snoozedUntil: i.until, updatedAt: ctx.now })
      .where(and(eq(routines.id, i.routineId), eq(routines.ownerId, ctx.ownerId))).returning({ name: routines.name });
    if (!res.length) throw new UserError("Routine not found");
    await syncRoutine(ctx, i.routineId);
    await audit(ctx, "routines", "snoozed", "routine", i.routineId, `${res[0].name} snoozed until ${dmy(i.until)}`);
    return { id: i.routineId, message: `Snoozed until ${dmy(i.until)}` };
  },
});

export const routineVoid = defineOp({
  name: "routine.void", module: "routines", label: "Remove routine entry", aiAllowed: false,
  schema: z.object({ eventId: zId }),
  summarize: () => "Remove entry",
  async run(ctx, i) {
    const res = await ctx.tx.update(routineEvents).set({ voidedAt: ctx.now })
      .where(and(eq(routineEvents.id, i.eventId), eq(routineEvents.ownerId, ctx.ownerId), isNull(routineEvents.voidedAt)))
      .returning({ routineId: routineEvents.routineId });
    if (!res.length) throw new UserError("Entry not found");
    await syncRoutine(ctx, res[0].routineId);
    await audit(ctx, "routines", "corrected", "routine_event", i.eventId, "Removed a routine entry");
    return { id: i.eventId, message: "Entry removed" };
  },
});

/* ───────────── Make-up fasts ledger ───────────── */

export async function fastBalance(ctx: Pick<Ctx, "tx" | "ownerId">) {
  const [{ b }] = await ctx.tx.select({ b: sql<string>`coalesce(sum(${fastLedgerEvents.delta}),0)` })
    .from(fastLedgerEvents).where(and(eq(fastLedgerEvents.ownerId, ctx.ownerId), isNull(fastLedgerEvents.voidedAt)));
  return Number(b);
}

export const fastComplete = defineOp({
  name: "fasts.complete", module: "fasts", label: "Fast completed", aiAllowed: true,
  schema: z.object({ onDate: zDate, historicalCorrection: z.boolean().default(false), notes: zOptText() }),
  summarize: (i) => `Record one make-up fast completed on ${dmy(i.onDate)} (balance −1)`,
  async run(ctx, i) {
    if (i.onDate > todayLocal(ctx.tz, ctx.now)) throw new UserError("Date can't be in the future", "onDate");
    const balance = await fastBalance(ctx);
    if (balance <= 0 && !i.historicalCorrection) throw new UserError("Your balance is already 0. Set an opening balance or tick ‘historical correction’ to override.", "onDate");
    const [dup] = await ctx.tx.select({ id: fastLedgerEvents.id }).from(fastLedgerEvents).where(and(
      eq(fastLedgerEvents.ownerId, ctx.ownerId), eq(fastLedgerEvents.type, "completed"),
      eq(fastLedgerEvents.onDate, i.onDate), isNull(fastLedgerEvents.voidedAt)));
    if (dup && !i.historicalCorrection) throw new UserError(`A fast is already recorded on ${dmy(i.onDate)}`, "onDate");
    const [e] = await ctx.tx.insert(fastLedgerEvents).values({
      ownerId: ctx.ownerId, type: "completed", delta: -1, onDate: i.onDate, reason: i.notes,
      overrideNegative: balance <= 0, source: ctx.source,
    }).returning({ id: fastLedgerEvents.id });
    const msg = `Fast completed on ${dmy(i.onDate)} — ${balance - 1} remaining`;
    await audit(ctx, "fasts", "completed", "fast_ledger_event", e.id, msg);
    return { id: e.id, message: msg };
  },
});

export const fastInitial = defineOp({
  name: "fasts.initial", module: "fasts", label: "Set opening balance", aiAllowed: false,
  schema: z.object({ count: z.number().int().min(0).max(5000), asOf: zDate, notes: zOptText() }),
  summarize: (i) => `Set opening balance of ${i.count} as of ${dmy(i.asOf)}`,
  async run(ctx, i) {
    const [existing] = await ctx.tx.select({ id: fastLedgerEvents.id }).from(fastLedgerEvents)
      .where(and(eq(fastLedgerEvents.ownerId, ctx.ownerId), eq(fastLedgerEvents.type, "initial"), isNull(fastLedgerEvents.voidedAt)));
    if (existing) throw new UserError("An opening balance already exists. Use an adjustment with a reason instead.");
    const [e] = await ctx.tx.insert(fastLedgerEvents).values({ ownerId: ctx.ownerId, type: "initial", delta: i.count, onDate: i.asOf, reason: i.notes }).returning({ id: fastLedgerEvents.id });
    await audit(ctx, "fasts", "created", "fast_ledger_event", e.id, `Opening balance ${i.count} as of ${dmy(i.asOf)}`);
    return { id: e.id, message: "Opening balance saved" };
  },
});

export const fastAdjust = defineOp({
  name: "fasts.adjust", module: "fasts", label: "Manual adjustment", aiAllowed: false,
  schema: z.object({ delta: z.number().int().min(-1000).max(1000).refine((v) => v !== 0, "Must not be 0"), onDate: zDate, reason: zText(500), overrideNegative: z.boolean().default(false) }),
  summarize: (i) => `Adjust balance by ${i.delta > 0 ? "+" : ""}${i.delta}: ${i.reason}`,
  async run(ctx, i) {
    const balance = await fastBalance(ctx);
    if (balance + i.delta < 0 && !i.overrideNegative) throw new UserError(`This would make the balance ${balance + i.delta}. Tick the override to confirm a historical correction.`, "delta");
    const [e] = await ctx.tx.insert(fastLedgerEvents).values({ ownerId: ctx.ownerId, type: "adjustment", delta: i.delta, onDate: i.onDate, reason: i.reason, overrideNegative: i.overrideNegative }).returning({ id: fastLedgerEvents.id });
    await audit(ctx, "fasts", "adjusted", "fast_ledger_event", e.id, `Adjusted by ${i.delta}: ${i.reason}`);
    return { id: e.id, message: "Adjustment recorded" };
  },
});

export const fastVoid = defineOp({
  name: "fasts.void", module: "fasts", label: "Remove ledger entry", aiAllowed: false,
  schema: z.object({ eventId: zId }),
  summarize: () => "Remove ledger entry",
  async run(ctx, i) {
    const res = await ctx.tx.update(fastLedgerEvents).set({ voidedAt: ctx.now })
      .where(and(eq(fastLedgerEvents.id, i.eventId), eq(fastLedgerEvents.ownerId, ctx.ownerId), isNull(fastLedgerEvents.voidedAt)))
      .returning({ type: fastLedgerEvents.type, on: fastLedgerEvents.onDate });
    if (!res.length) throw new UserError("Entry not found");
    await audit(ctx, "fasts", "corrected", "fast_ledger_event", i.eventId, `Removed ${res[0].type} entry dated ${dmy(res[0].on)}`);
    return { id: i.eventId, message: "Entry removed" };
  },
});

export const fastRuleSave = defineOp({
  name: "fasts.rule.save", module: "fasts", label: "Annual addition rule", aiAllowed: false,
  schema: z.object({
    id: zId.optional(), amount: z.number().int().min(1).max(60),
    calendar: z.enum(["hijri", "gregorian"]), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31),
    startYear: z.number().int().min(1300).max(2200), active: z.boolean().default(true), notes: zOptText(),
  }),
  summarize: (i) => `Add ${i.amount} each year on ${i.calendar} ${i.month}/${i.day} from ${i.startYear}`,
  async run(ctx, i) {
    let ruleId = i.id;
    if (ruleId) {
      const res = await ctx.tx.update(annualFastAdditionRules).set({ amount: i.amount, calendar: i.calendar, month: i.month, day: i.day, startYear: i.startYear, active: i.active, notes: i.notes, updatedAt: ctx.now })
        .where(and(eq(annualFastAdditionRules.id, ruleId), eq(annualFastAdditionRules.ownerId, ctx.ownerId))).returning({ id: annualFastAdditionRules.id });
      if (!res.length) throw new UserError("Rule not found");
    } else {
      const [r] = await ctx.tx.insert(annualFastAdditionRules).values({ ownerId: ctx.ownerId, amount: i.amount, calendar: i.calendar, month: i.month, day: i.day, startYear: i.startYear, active: i.active, notes: i.notes }).returning({ id: annualFastAdditionRules.id });
      ruleId = r.id;
    }
    await audit(ctx, "fasts", "settings", "annual_fast_rule", ruleId!, `Annual rule: +${i.amount} on ${i.calendar} ${i.month}/${i.day} from ${i.startYear}`);
    await applyAnnualFastRules(ctx);
    return { id: ruleId!, message: "Rule saved" };
  },
});

/** Pure helper: the Gregorian date a rule fires in a given rule-calendar year. */
export function ruleDate(rule: { calendar: string; month: number; day: number }, year: number): LocalDate {
  if (rule.calendar === "hijri") return fromHijri(year, rule.month, rule.day);
  const dim = new Date(Date.UTC(year, rule.month, 0)).getUTCDate();
  return `${year}-${String(rule.month).padStart(2, "0")}-${String(Math.min(rule.day, dim)).padStart(2, "0")}`;
}

/**
 * Idempotent: inserts each (rule, year) addition at most once thanks to the unique index
 * (rule_id, period_key). Safe to call on every page load, retry, or cron tick.
 */
export async function applyAnnualFastRules(ctx: Ctx) {
  const rules = await ctx.tx.select().from(annualFastAdditionRules)
    .where(and(eq(annualFastAdditionRules.ownerId, ctx.ownerId), eq(annualFastAdditionRules.active, true)));
  const today = todayLocal(ctx.tz, ctx.now);
  let added = 0;
  for (const r of rules) {
    const currentYear = r.calendar === "hijri" ? toHijri(today).year : Number(today.slice(0, 4));
    for (let y = r.startYear; y <= currentYear; y++) {
      const on = ruleDate(r, y);
      if (on > today) continue;
      const res = await ctx.tx.insert(fastLedgerEvents).values({
        ownerId: ctx.ownerId, type: "annual_addition", delta: r.amount, onDate: on, ruleId: r.id,
        periodKey: `${r.calendar}:${y}`, reason: `Annual addition (${r.calendar} ${y})`,
      }).onConflictDoNothing({ target: [fastLedgerEvents.ruleId, fastLedgerEvents.periodKey] }).returning({ id: fastLedgerEvents.id });
      if (res.length) {
        added++;
        await audit({ ...ctx, source: "manual" }, "fasts", "annual_addition", "fast_ledger_event", res[0].id, `Annual addition +${r.amount} (${r.calendar} ${y})`);
      }
    }
  }
  return added;
}
