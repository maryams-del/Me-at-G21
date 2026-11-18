import { z } from "zod";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { periodCycles, users } from "@/db/schema";
import { defineOp, zDate, zId, zOptText, zTime } from "./registry";
import { audit, UserError, type Ctx } from "../audit";
import { encryptField, decryptField } from "@/lib/crypto";
import { addDays, daysBetween, dmy, todayLocal, type LocalDate } from "@/lib/time";

/*
 * Period log. Sensitive by design:
 *  - every op is aiAllowed:false, so Capture/AI can never propose or see these records;
 *  - notes and symptoms are encrypted at rest (AAD binds owner + row);
 *  - audit entries are marked sensitive and carry no dates or details;
 *  - nothing here creates notifications.
 */

const key = () => {
  const k = process.env.DATA_ENCRYPTION_KEY;
  if (!k) throw new Error("DATA_ENCRYPTION_KEY missing");
  return k;
};
const aad = (ownerId: string, id: string, field: string) => `period:${ownerId}:${id}:${field}`;
const enc = (ownerId: string, id: string, field: string, v: string | null | undefined) => (v ? encryptField(v, key(), aad(ownerId, id, field)) : null);
export const decPeriodField = (ownerId: string, id: string, field: string, v: string | null) => {
  if (!v) return null;
  try { return decryptField(v, key(), aad(ownerId, id, field)); } catch { return "[could not decrypt]"; }
};

export const SYMPTOMS = ["Cramps", "Headache", "Back pain", "Bloating", "Fatigue", "Mood changes", "Acne", "Nausea", "Tender breasts", "Heavy flow", "Light flow", "Spotting"] as const;
const zSymptoms = z.array(z.string().trim().min(1).max(40)).max(20).default([]);

type Row = typeof periodCycles.$inferSelect;

async function own(ctx: Ctx, id: string): Promise<Row> {
  const [r] = await ctx.tx.select().from(periodCycles).where(and(eq(periodCycles.id, id), eq(periodCycles.ownerId, ctx.ownerId), isNull(periodCycles.deletedAt)));
  if (!r) throw new UserError("Entry not found");
  return r;
}

/** Ranges may not overlap another logged period (an open one counts as running until today). */
async function checkOverlap(ctx: Ctx, start: LocalDate, end: LocalDate | null, exceptId?: string) {
  const today = todayLocal(ctx.tz, ctx.now);
  const others = await ctx.tx.select().from(periodCycles).where(and(eq(periodCycles.ownerId, ctx.ownerId), isNull(periodCycles.deletedAt), exceptId ? ne(periodCycles.id, exceptId) : undefined));
  const myEnd = end ?? today;
  for (const o of others) {
    const oEnd = o.endDate ?? today;
    if (start <= oEnd && o.startDate <= myEnd) throw new UserError(`That overlaps the period logged from ${dmy(o.startDate)}${o.endDate ? ` to ${dmy(o.endDate)}` : " (still open)"}. Correct that entry instead.`, "startDate");
  }
}

function checkDates(ctx: Ctx, start: LocalDate, end: LocalDate | null | undefined) {
  const today = todayLocal(ctx.tz, ctx.now);
  if (start > today) throw new UserError("Start date can't be in the future", "startDate");
  if (end && end > today) throw new UserError("End date can't be in the future", "endDate");
  if (end && end < start) throw new UserError("End date can't be before the start date", "endDate");
  if (end && daysBetween(start, end) > 20) throw new UserError("That's longer than 20 days. Check the dates (you can correct entries later).", "endDate");
}

export const periodStart = defineOp({
  name: "period.start", module: "period", label: "Period started", aiAllowed: false,
  schema: z.object({ startDate: zDate, startTime: zTime.optional().nullable(), notes: zOptText(2000), symptoms: zSymptoms }),
  summarize: (i) => `Period started ${dmy(i.startDate)}`,
  async run(ctx, i) {
    checkDates(ctx, i.startDate, null);
    const [open] = await ctx.tx.select().from(periodCycles).where(and(eq(periodCycles.ownerId, ctx.ownerId), isNull(periodCycles.deletedAt), isNull(periodCycles.endDate)));
    if (open) throw new UserError(`A period is already open since ${dmy(open.startDate)}. Log “Period ended” first, or correct that entry.`);
    await checkOverlap(ctx, i.startDate, null);
    const [r] = await ctx.tx.insert(periodCycles).values({ ownerId: ctx.ownerId, startDate: i.startDate, startTime: i.startTime ?? null, source: ctx.source }).returning({ id: periodCycles.id });
    await ctx.tx.update(periodCycles).set({ notesEnc: enc(ctx.ownerId, r.id, "notes", i.notes), symptomsEnc: i.symptoms.length ? enc(ctx.ownerId, r.id, "symptoms", JSON.stringify(i.symptoms)) : null }).where(eq(periodCycles.id, r.id));
    await audit(ctx, "period", "created", "period", r.id, "Period log entry", true);
    return { id: r.id, message: `Period start logged (${dmy(i.startDate)})` };
  },
});

export const periodEnd = defineOp({
  name: "period.end", module: "period", label: "Period ended", aiAllowed: false,
  schema: z.object({ endDate: zDate, endTime: zTime.optional().nullable() }),
  summarize: (i) => `Period ended ${dmy(i.endDate)}`,
  async run(ctx, i) {
    const [open] = await ctx.tx.select().from(periodCycles).where(and(eq(periodCycles.ownerId, ctx.ownerId), isNull(periodCycles.deletedAt), isNull(periodCycles.endDate))).orderBy(desc(periodCycles.startDate)).limit(1);
    if (!open) throw new UserError("There's no open period to end. Log “Period started” first, or add a past period with both dates.");
    checkDates(ctx, open.startDate, i.endDate);
    await ctx.tx.update(periodCycles).set({ endDate: i.endDate, endTime: i.endTime ?? null, updatedAt: ctx.now }).where(eq(periodCycles.id, open.id));
    await audit(ctx, "period", "completed", "period", open.id, "Period log entry", true);
    return { id: open.id, message: `Period end logged (${dmy(i.endDate)}, ${daysBetween(open.startDate, i.endDate) + 1} days)` };
  },
});

const fullInput = z.object({
  startDate: zDate, startTime: zTime.optional().nullable(), endDate: zDate.optional().nullable(), endTime: zTime.optional().nullable(),
  notes: zOptText(2000), symptoms: zSymptoms,
});

/** Add a past period with both dates (or correct one). */
export const periodAdd = defineOp({
  name: "period.add", module: "period", label: "Add past period", aiAllowed: false,
  schema: fullInput.extend({ endDate: zDate }),
  summarize: (i) => `Add period ${dmy(i.startDate)} to ${dmy(i.endDate)}`,
  async run(ctx, i) {
    checkDates(ctx, i.startDate, i.endDate);
    await checkOverlap(ctx, i.startDate, i.endDate);
    const [r] = await ctx.tx.insert(periodCycles).values({ ownerId: ctx.ownerId, startDate: i.startDate, startTime: i.startTime ?? null, endDate: i.endDate, endTime: i.endTime ?? null, source: ctx.source }).returning({ id: periodCycles.id });
    await ctx.tx.update(periodCycles).set({ notesEnc: enc(ctx.ownerId, r.id, "notes", i.notes), symptomsEnc: i.symptoms.length ? enc(ctx.ownerId, r.id, "symptoms", JSON.stringify(i.symptoms)) : null }).where(eq(periodCycles.id, r.id));
    await audit(ctx, "period", "created", "period", r.id, "Period log entry", true);
    return { id: r.id, message: "Past period added" };
  },
});

export const periodUpdate = defineOp({
  name: "period.update", module: "period", label: "Correct period entry", aiAllowed: false,
  schema: fullInput.extend({ id: zId }),
  summarize: () => "Correct period entry",
  async run(ctx, i) {
    await own(ctx, i.id);
    checkDates(ctx, i.startDate, i.endDate);
    if (!i.endDate) {
      const [open] = await ctx.tx.select({ id: periodCycles.id }).from(periodCycles).where(and(eq(periodCycles.ownerId, ctx.ownerId), isNull(periodCycles.deletedAt), isNull(periodCycles.endDate), ne(periodCycles.id, i.id)));
      if (open) throw new UserError("Another period is already open. Add an end date here.", "endDate");
    }
    await checkOverlap(ctx, i.startDate, i.endDate ?? null, i.id);
    await ctx.tx.update(periodCycles).set({
      startDate: i.startDate, startTime: i.startTime ?? null, endDate: i.endDate ?? null, endTime: i.endTime ?? null,
      notesEnc: enc(ctx.ownerId, i.id, "notes", i.notes), symptomsEnc: i.symptoms.length ? enc(ctx.ownerId, i.id, "symptoms", JSON.stringify(i.symptoms)) : null,
      updatedAt: ctx.now,
    }).where(eq(periodCycles.id, i.id));
    await audit(ctx, "period", "corrected", "period", i.id, "Period log entry", true);
    return { id: i.id, message: "Entry corrected" };
  },
});

export const periodDelete = defineOp({
  name: "period.delete", module: "period", label: "Delete period entry", aiAllowed: false,
  schema: z.object({ id: zId }),
  summarize: () => "Delete period entry",
  async run(ctx, i) {
    await own(ctx, i.id);
    await ctx.tx.update(periodCycles).set({ deletedAt: ctx.now, notesEnc: null, symptomsEnc: null }).where(eq(periodCycles.id, i.id));
    await audit(ctx, "period", "deleted", "period", i.id, "Period log entry", true);
    return { id: i.id, message: "Entry deleted" };
  },
});

export type PeriodSettings = { showOnDashboard: boolean; showEstimate: boolean };
export const DEFAULT_PERIOD_SETTINGS: PeriodSettings = { showOnDashboard: false, showEstimate: true };
export const periodSettingsOf = (settings: Record<string, unknown> | null | undefined): PeriodSettings =>
  ({ ...DEFAULT_PERIOD_SETTINGS, ...((settings?.period as Partial<PeriodSettings>) ?? {}) });

export const periodSettings = defineOp({
  name: "period.settings", module: "period", label: "Period privacy settings", aiAllowed: false,
  schema: z.object({ showOnDashboard: z.boolean().default(false), showEstimate: z.boolean().default(true) }),
  summarize: () => "Update period privacy settings",
  async run(ctx, i) {
    const [u] = await ctx.tx.select({ settings: users.settings }).from(users).where(eq(users.id, ctx.ownerId));
    await ctx.tx.update(users).set({ settings: { ...(u?.settings ?? {}), period: i }, updatedAt: ctx.now }).where(eq(users.id, ctx.ownerId));
    await audit(ctx, "period", "settings", "user", ctx.ownerId, "Period privacy settings changed", true);
    return { id: ctx.ownerId, message: "Settings saved" };
  },
});

/* ── Pure helpers (exported for tests) ── */

export type Cycle = { startDate: LocalDate; endDate: LocalDate | null };

/** Cycle length = days from one start to the next start. Uses up to the last 6 complete cycles; ignores implausible gaps (<15 or >60 days, e.g. a missed log). */
export function periodEstimate(cyclesAsc: Cycle[]): { avgCycle: number; avgLength: number | null; nextStart: LocalDate; basedOn: number } | null {
  const gaps: number[] = [];
  for (let n = 1; n < cyclesAsc.length; n++) {
    const g = daysBetween(cyclesAsc[n - 1].startDate, cyclesAsc[n].startDate);
    if (g >= 15 && g <= 60) gaps.push(g);
  }
  const recent = gaps.slice(-6);
  if (recent.length < 2) return null; // need at least 3 logged starts before estimating
  const avgCycle = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
  const lens = cyclesAsc.filter((c) => c.endDate).slice(-6).map((c) => daysBetween(c.startDate, c.endDate!) + 1);
  const avgLength = lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : null;
  return { avgCycle, avgLength, nextStart: addDays(cyclesAsc[cyclesAsc.length - 1].startDate, avgCycle), basedOn: recent.length };
}
