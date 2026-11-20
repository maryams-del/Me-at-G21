import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { routines, routineEvents, fastLedgerEvents, annualFastAdditionRules } from "@/db/schema";
import { defineOp, zDate, zId, zOptText, zText, zTime } from "./registry";
import { audit, UserError, type Ctx } from "../audit";
import { addDays, addInterval, daysBetween, localToInstant, todayLocal, toHijri, fromHijri, type LocalDate, dmy } from "@/lib/time";
import { syncReminders, cancelReminders, type DesiredReminder } from "../reminders";

/* ───────────── Routines: anything you do on a cycle (waxing, dental scaling, toothbrush, bedsheets, custom) ───────────── */

type RoutineRow = typeof routines.$inferSelect;
type Unit = "day" | "week" | "month";

/** Ready-made settings people can start from; every field stays editable. */
export const ROUTINE_TEMPLATES = {
  waxing: { name: "Waxing", kind: "waxing", anchor: "completed", intervalValue: 30, intervalUnit: "day", graceDays: 10, reminderOffsetsDays: [-3, 0, 5, 8, 10], sensitive: true,
    blurb: "Next around day 30, at the latest by day 40" },
  dental: { name: "Dental scaling", kind: "dental", anchor: "completed", intervalValue: 6, intervalUnit: "month", graceDays: null, reminderOffsetsDays: [-14, -1, 0], sensitive: false,
    blurb: "Every 6 calendar months" },
  toothbrush: { name: "Replace toothbrush", kind: "toothbrush", anchor: "first_use", intervalValue: 3, intervalUnit: "month", graceDays: null, reminderOffsetsDays: [-14, 0], sensitive: false,
    blurb: "3 months after you start using it" },
  brushes: { name: "Clean makeup brushes", kind: "brushes", anchor: "completed", intervalValue: 7, intervalUnit: "day", graceDays: null, reminderOffsetsDays: [-1, 0], sensitive: false,
    blurb: "Every 7 days" },
  bedsheets: { name: "Change bedsheets", kind: "bedsheets", anchor: "completed", intervalValue: 7, intervalUnit: "day", graceDays: null, reminderOffsetsDays: [0], sensitive: false,
    blurb: "Every 7 days" },
} as const;
export type TemplateKey = keyof typeof ROUTINE_TEMPLATES;

export async function routineAnchor(ctx: Pick<Ctx, "tx">, r: RoutineRow): Promise<LocalDate | null> {
  // First-use routines (a toothbrush) keep counting from the last new one: skipping only silences them.
  const types = r.anchor === "first_use" ? ["first_use"] : ["completed", "skipped"];
  const [e] = await ctx.tx.select().from(routineEvents)
    .where(and(eq(routineEvents.routineId, r.id), isNull(routineEvents.voidedAt), inArray(routineEvents.type, types)))
    .orderBy(desc(routineEvents.onDate), desc(routineEvents.createdAt)).limit(1);
  return e?.onDate ?? null;
}

/** First-use routines: skipped since the last new one, so it stops nagging and just keeps counting days. */
export async function routineSkipped(ctx: Pick<Ctx, "tx">, r: RoutineRow, anchor: LocalDate | null): Promise<boolean> {
  if (r.anchor !== "first_use" || !anchor) return false;
  const [e] = await ctx.tx.select({ id: routineEvents.id }).from(routineEvents)
    .where(and(eq(routineEvents.routineId, r.id), isNull(routineEvents.voidedAt), eq(routineEvents.type, "skipped"), gte(routineEvents.onDate, anchor))).limit(1);
  return !!e;
}

export function routineDue(r: Pick<RoutineRow, "intervalValue" | "intervalUnit" | "snoozedUntil">, anchor: LocalDate | null): LocalDate | null {
  if (!anchor) return null;
  const due = addInterval(anchor, r.intervalValue, r.intervalUnit as Unit);
  return r.snoozedUntil && r.snoozedUntil > due ? r.snoozedUntil : due;
}

/** Pure: reminders for a routine whose next due date is `due`. Exported for tests. */
export function routineReminders(r: Pick<RoutineRow, "id" | "name" | "reminderOffsetsDays" | "reminderTime" | "graceDays" | "sensitive">, anchor: LocalDate, due: LocalDate, tz: string): DesiredReminder[] {
  const cycle = daysBetween(anchor, due);
  return [...new Set(r.reminderOffsetsDays)].sort((a, b) => a - b).map((off) => {
    const day = cycle + off;
    const last = r.graceDays !== null && r.graceDays !== undefined && off === r.graceDays;
    return {
      dedupeKey: `routine:${r.id}:${due}:o${off}`,
      fireAt: localToInstant(addDays(due, off), r.reminderTime, tz),
      title: off < 0 ? `${r.name}: due in ${-off} day${off === -1 ? "" : "s"}` : off === 0 ? `${r.name}: due today` : last ? `${r.name}: last day (day ${day})` : `${r.name}: ${off} day${off === 1 ? "" : "s"} past due`,
      publicBody: r.graceDays ? `Day ${day} since last time. Latest by day ${cycle + r.graceDays}` : off > 0 ? "Mark it done when you can" : "Open the app to mark it done",
      sensitive: r.sensitive,
      link: "/care/routines",
    };
  });
}

export async function syncRoutine(ctx: Ctx, routineId: string) {
  const [r] = await ctx.tx.select().from(routines).where(eq(routines.id, routineId));
  if (!r) return;
  const anchor = await routineAnchor(ctx, r);
  const due = routineDue(r, anchor);
  if (!anchor || !due || r.paused || !r.remindersEnabled || await routineSkipped(ctx, r, anchor)) return cancelReminders(ctx.tx, ctx.ownerId, "routine", r.id);
  await syncReminders(ctx.tx, ctx.ownerId, "routine", r.id, routineReminders(r, anchor, due, ctx.tz), ctx.now);
}

const routineInput = z.object({
  name: zText(120), kind: z.string().trim().max(40).default("custom"),
  anchor: z.enum(["completed", "first_use"]).default("completed"),
  intervalValue: z.number().int().min(1).max(365), intervalUnit: z.enum(["day", "week", "month"]),
  reminderOffsetsDays: z.array(z.number().int().min(-120).max(120)).max(10).default([0]),
  graceDays: z.number().int().min(1).max(365).optional().nullable(),
  sensitive: z.boolean().default(false),
  reminderTime: zTime.default("09:00"), remindersEnabled: z.boolean().default(true), notes: zOptText(),
});

export const routineCreate = defineOp({
  name: "routine.create", module: "routines", label: "New routine", aiAllowed: true,
  schema: routineInput,
  summarize: (i) => `Create routine “${i.name}” every ${i.intervalValue} ${i.intervalUnit}${i.intervalValue > 1 ? "s" : ""}${i.graceDays ? `, at the latest ${i.graceDays} days after` : ""}`,
  async run(ctx, i) {
    const [r] = await ctx.tx.insert(routines).values({ ownerId: ctx.ownerId, ...i, graceDays: i.graceDays ?? null }).returning({ id: routines.id });
    await audit(ctx, "routines", "created", "routine", r.id, `Created routine “${i.name}”`, i.sensitive);
    return { id: r.id, message: `Routine “${i.name}” created` };
  },
});

export const routineFromTemplate = defineOp({
  name: "routine.template", module: "routines", label: "Add routine from template", aiAllowed: false,
  schema: z.object({ template: z.enum(Object.keys(ROUTINE_TEMPLATES) as [TemplateKey, ...TemplateKey[]]) }),
  summarize: (i) => `Add “${ROUTINE_TEMPLATES[i.template].name}”`,
  async run(ctx, i) {
    const { blurb: _b, ...t } = ROUTINE_TEMPLATES[i.template];
    void _b;
    const [r] = await ctx.tx.insert(routines).values({ ownerId: ctx.ownerId, ...t, reminderOffsetsDays: [...t.reminderOffsetsDays] }).returning({ id: routines.id });
    await audit(ctx, "routines", "created", "routine", r.id, `Added routine “${t.name}”`, t.sensitive);
    return { id: r.id, message: `“${t.name}” added. Log the last time you did it to start the count.` };
  },
});

export const routineUpdate = defineOp({
  name: "routine.update", module: "routines", label: "Edit routine", aiAllowed: false,
  schema: routineInput.extend({ id: zId, paused: z.boolean().default(false) }),
  summarize: (i) => `Update routine “${i.name}”`,
  async run(ctx, i) {
    const { id: rid, ...rest } = i;
    const res = await ctx.tx.update(routines).set({ ...rest, graceDays: rest.graceDays ?? null, updatedAt: ctx.now })
      .where(and(eq(routines.id, rid), eq(routines.ownerId, ctx.ownerId))).returning({ id: routines.id });
    if (!res.length) throw new UserError("Routine not found");
    await syncRoutine(ctx, rid);
    await audit(ctx, "routines", i.paused ? "paused" : "edited", "routine", rid, `Updated routine “${i.name}”`, i.sensitive);
    return { id: rid, message: "Routine updated" };
  },
});

export const routineDelete = defineOp({
  name: "routine.delete", module: "routines", label: "Delete routine", aiAllowed: true,
  schema: z.object({ id: zId }),
  summarize: () => "Delete routine and its history",
  async run(ctx, i) {
    const res = await ctx.tx.delete(routines).where(and(eq(routines.id, i.id), eq(routines.ownerId, ctx.ownerId))).returning({ name: routines.name, sensitive: routines.sensitive });
    if (!res.length) throw new UserError("Routine not found");
    await cancelReminders(ctx.tx, ctx.ownerId, "routine", i.id);
    await audit(ctx, "routines", "deleted", "routine", i.id, `Deleted routine “${res[0].name}”`, res[0].sensitive);
    return { id: i.id, message: "Routine deleted" };
  },
});

async function logRoutine(ctx: Ctx, r: RoutineRow, type: string, onDate: string, notes: string | null) {
  if (onDate > todayLocal(ctx.tz, ctx.now)) throw new UserError("Date can't be in the future", "onDate");
  const [e] = await ctx.tx.insert(routineEvents).values({ ownerId: ctx.ownerId, routineId: r.id, type, onDate, notes, source: ctx.source }).returning({ id: routineEvents.id });
  if (r.snoozedUntil) await ctx.tx.update(routines).set({ snoozedUntil: null }).where(eq(routines.id, r.id));
  await syncRoutine(ctx, r.id);
  const verb = { completed: "done", skipped: "skipped", purchased: "purchased", first_use: "first used" }[type] ?? type;
  const msg = `${r.name}: ${verb} on ${dmy(onDate)}`;
  await audit(ctx, "routines", type, "routine_event", e.id, msg, r.sensitive);
  return { id: e.id, message: msg };
}

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
    return logRoutine(ctx, r, i.type, i.onDate, i.notes);
  },
});

/** Find the owner's routine of a template kind, creating it from the template if needed. */
export async function ensureKindRoutine(ctx: Ctx, kind: TemplateKey): Promise<RoutineRow> {
  const [r] = await ctx.tx.select().from(routines).where(and(eq(routines.ownerId, ctx.ownerId), eq(routines.kind, kind))).orderBy(asc(routines.createdAt)).limit(1);
  if (r) return r;
  const { blurb: _b, ...t } = ROUTINE_TEMPLATES[kind];
  void _b;
  const [created] = await ctx.tx.insert(routines).values({ ownerId: ctx.ownerId, ...t, reminderOffsetsDays: [...t.reminderOffsetsDays] }).returning();
  return created;
}

/** Shortcuts kept for Capture and the dashboard: "I waxed today", "dental scaling done". */
function completeOp(kind: "waxing" | "dental") {
  return defineOp({
    name: `${kind}.complete`, module: "routines", label: kind === "waxing" ? "Waxing completed" : "Dental scaling completed", aiAllowed: true,
    schema: z.object({ completedOn: zDate, detail: zOptText(200), notes: zOptText() }),
    summarize: (i) => `Log ${kind === "waxing" ? "waxing" : "dental scaling"} done on ${dmy(i.completedOn)}; the next one is counted from that date`,
    async run(ctx, i) {
      const r = await ensureKindRoutine(ctx, kind);
      return logRoutine(ctx, r, "completed", i.completedOn, [i.detail, i.notes].filter(Boolean).join(". ") || null);
    },
  });
}
/** "Changed bedsheets" when no bedsheets routine exists yet: adds it from the template, then logs it. */
export const routineDone = defineOp({
  name: "routine.done", module: "routines", label: "Log routine (adds it if new)", aiAllowed: true,
  schema: z.object({ kind: z.enum(Object.keys(ROUTINE_TEMPLATES) as [TemplateKey, ...TemplateKey[]]), type: z.enum(["completed", "purchased", "first_use"]).default("completed"), onDate: zDate, notes: zOptText() }),
  summarize: (i) => `${ROUTINE_TEMPLATES[i.kind].name}: ${{ completed: "done", purchased: "purchased", first_use: "first used" }[i.type]} on ${dmy(i.onDate)} (starts tracking it if you don't yet)`,
  async run(ctx, i) {
    const r = await ensureKindRoutine(ctx, i.kind);
    return logRoutine(ctx, r, i.type, i.onDate, i.notes);
  },
});
export const waxingComplete = completeOp("waxing");
export const dentalComplete = completeOp("dental");

export const routineSnooze = defineOp({
  name: "routine.snooze", module: "routines", label: "Snooze routine", aiAllowed: false,
  schema: z.object({ routineId: zId, until: zDate }),
  summarize: (i) => `Snooze until ${dmy(i.until)}`,
  async run(ctx, i) {
    const res = await ctx.tx.update(routines).set({ snoozedUntil: i.until, updatedAt: ctx.now })
      .where(and(eq(routines.id, i.routineId), eq(routines.ownerId, ctx.ownerId))).returning({ name: routines.name, sensitive: routines.sensitive });
    if (!res.length) throw new UserError("Routine not found");
    await syncRoutine(ctx, i.routineId);
    await audit(ctx, "routines", "snoozed", "routine", i.routineId, `${res[0].name} snoozed until ${dmy(i.until)}`, res[0].sensitive);
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
    await syncRoutine(ctx, res[0].routineId); // recalculates from the remaining latest entry, no duplicates
    await audit(ctx, "routines", "corrected", "routine_event", i.eventId, "Removed a routine entry");
    return { id: i.eventId, message: "Entry removed and schedule recalculated" };
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
