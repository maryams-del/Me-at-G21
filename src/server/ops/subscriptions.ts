import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { subscriptions } from "@/db/schema";
import { defineOp, zAmount, zCurrency, zDate, zId, zOptText, zText, zTime } from "./registry";
import { audit, UserError, type Ctx } from "../audit";
import { toMinor, formatMoney } from "@/lib/money";
import { addDays, addMonths, daysBetween, dmy, localToInstant, todayLocal, type LocalDate } from "@/lib/time";
import { syncReminders, cancelReminders, type DesiredReminder } from "../reminders";

type Sub = typeof subscriptions.$inferSelect;
type Unit = "day" | "week" | "month";
export type Period = { value: number; unit: Unit };

export function periodOf(s: Pick<Sub, "cadence" | "intervalValue" | "intervalUnit">): Period {
  if (s.cadence === "monthly") return { value: 1, unit: "month" };
  if (s.cadence === "yearly") return { value: 12, unit: "month" };
  if (s.cadence === "weekly") return { value: 1, unit: "week" };
  return { value: Math.max(1, s.intervalValue), unit: s.intervalUnit as Unit };
}

/** k-th charge counted from the anchor (calendar months are added from the anchor each time, so Jan 31 → Feb 28 → Mar 31). */
const nth = (anchor: LocalDate, p: Period, k: number) => p.unit === "month" ? addMonths(anchor, k * p.value) : addDays(anchor, k * p.value * (p.unit === "week" ? 7 : 1));

/** Charges on or after `from`, up to `to` inclusive (max `limit`). */
export function chargesBetween(anchor: LocalDate, p: Period, from: LocalDate, to: LocalDate, limit = 60): LocalDate[] {
  const out: LocalDate[] = [];
  const approx = p.unit === "month" ? p.value * 28 : p.value * (p.unit === "week" ? 7 : 1);
  let k = anchor >= from ? 0 : Math.max(0, Math.floor(daysBetween(anchor, from) / (approx * 1.1)) - 1);
  for (let guard = 0; guard < 5000 && out.length < limit; guard++, k++) {
    const d = nth(anchor, p, k);
    if (d > to) break;
    if (d >= from) out.push(d);
  }
  return out;
}
export const nextCharge = (anchor: LocalDate, p: Period, from: LocalDate) => chargesBetween(anchor, p, from, addMonths(from, 13 * 12), 1)[0] ?? null;

/** Average cost per month in minor units (yearly ÷ 12, weekly × 365.25/7/12, etc.). */
export function monthlyEquivalentMinor(amountMinor: number, p: Period): number {
  if (p.unit === "month") return Math.round(amountMinor / p.value);
  const days = p.value * (p.unit === "week" ? 7 : 1);
  return Math.round((amountMinor * 365.25) / 12 / days);
}

/** Labels only: anything that looks like a card or account number is refused. */
const zPaymentLabel = z.string().trim().max(60)
  .refine((s) => !/\d{5,}/.test(s.replace(/[\s-]/g, "")), "Use a label like “Visa ending 4821”, never a full card number")
  .optional().nullable().or(z.literal("").transform(() => null));

const input = z.object({
  name: zText(120), category: zOptText(60),
  amount: zAmount, currency: zCurrency,
  cadence: z.enum(["monthly", "yearly", "weekly", "custom"]).default("monthly"),
  intervalValue: z.number().int().min(1).max(365).default(1),
  intervalUnit: z.enum(["day", "week", "month"]).default("month"),
  nextBillingDate: zDate,
  paymentLabel: zPaymentLabel,
  renewal: z.enum(["auto", "manual"]).default("auto"),
  trialEndsOn: zDate.optional().nullable(),
  url: z.string().trim().url().max(500).optional().nullable().or(z.literal("").transform(() => null)),
  notes: zOptText(2000),
  reminderOffsetsDays: z.array(z.number().int().min(-60).max(0)).max(6).default([-3]),
  trialOffsetsDays: z.array(z.number().int().min(-30).max(0)).max(6).default([-3, -1]),
  reminderTime: zTime.default("09:00"), remindersEnabled: z.boolean().default(true),
});

const values = (i: z.infer<typeof input>) => ({
  name: i.name, category: i.category ?? null, amountMinor: toMinor(i.amount, i.currency), currency: i.currency,
  cadence: i.cadence, intervalValue: i.cadence === "custom" ? i.intervalValue : 1, intervalUnit: i.cadence === "custom" ? i.intervalUnit : "month",
  anchorDate: i.nextBillingDate, paymentLabel: i.paymentLabel ?? null, renewal: i.renewal, trialEndsOn: i.trialEndsOn ?? null,
  url: i.url ?? null, notes: i.notes ?? null, reminderOffsetsDays: i.reminderOffsetsDays, trialOffsetsDays: i.trialOffsetsDays,
  reminderTime: i.reminderTime, remindersEnabled: i.remindersEnabled,
});

/** Pure: reminders for the next two charges and the trial end. Exported for tests. */
export function subscriptionReminders(s: Sub, today: LocalDate, tz: string): DesiredReminder[] {
  const p = periodOf(s);
  const out: DesiredReminder[] = [];
  const price = formatMoney(s.amountMinor, s.currency);
  for (const d of chargesBetween(s.anchorDate, p, today, addMonths(today, 26), 2)) {
    if (s.trialEndsOn && d < s.trialEndsOn) continue; // still in the free trial
    for (const off of [...new Set(s.reminderOffsetsDays)]) {
      out.push({
        dedupeKey: `sub:${s.id}:${d}:o${off}`,
        fireAt: localToInstant(addDays(d, off), s.reminderTime, tz),
        title: `${s.name} ${s.renewal === "manual" ? "needs renewing" : "renews"} ${off === 0 ? "today" : off === -1 ? "tomorrow" : `in ${-off} days`}`,
        publicBody: `${price} on ${dmy(d)}${s.paymentLabel ? `, ${s.paymentLabel}` : ""}`,
        link: "/finance/subscriptions",
      });
    }
  }
  if (s.trialEndsOn && s.trialEndsOn >= today) {
    for (const off of [...new Set(s.trialOffsetsDays)]) {
      out.push({
        dedupeKey: `subtrial:${s.id}:${s.trialEndsOn}:o${off}`,
        fireAt: localToInstant(addDays(s.trialEndsOn, off), s.reminderTime, tz),
        title: `${s.name} free trial ends ${off === 0 ? "today" : off === -1 ? "tomorrow" : `in ${-off} days`}`,
        publicBody: `Then ${price}. Cancel before ${dmy(s.trialEndsOn)} if you don't want it`,
        link: "/finance/subscriptions",
      });
    }
  }
  return out;
}

export async function syncSubscription(ctx: Ctx, id: string) {
  const [s] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, id));
  if (!s || s.deletedAt || s.status !== "active" || !s.remindersEnabled) return cancelReminders(ctx.tx, ctx.ownerId, "subscription", id);
  await syncReminders(ctx.tx, ctx.ownerId, "subscription", s.id, subscriptionReminders(s, todayLocal(ctx.tz, ctx.now), ctx.tz), ctx.now);
}

async function own(ctx: Ctx, id: string) {
  const [s] = await ctx.tx.select().from(subscriptions).where(and(eq(subscriptions.id, id), eq(subscriptions.ownerId, ctx.ownerId), isNull(subscriptions.deletedAt)));
  if (!s) throw new UserError("Subscription not found");
  return s;
}

export const subscriptionCreate = defineOp({
  name: "subscription.create", module: "subscriptions", label: "Add subscription", aiAllowed: true,
  schema: input, draftable: ["amount", "nextBillingDate"],
  summarize: (i) => `Add subscription ${i.name}: ${i.amount} ${i.currency} ${i.cadence === "custom" ? `every ${i.intervalValue} ${i.intervalUnit}s` : i.cadence}, next charge ${dmy(i.nextBillingDate)}${i.trialEndsOn ? `, trial ends ${dmy(i.trialEndsOn)}` : ""}`,
  async run(ctx, i) {
    const [s] = await ctx.tx.insert(subscriptions).values({ ownerId: ctx.ownerId, ...values(i), source: ctx.source }).returning({ id: subscriptions.id });
    await syncSubscription(ctx, s.id);
    await audit(ctx, "subscriptions", "created", "subscription", s.id, `Added ${i.name} (${i.amount} ${i.currency} ${i.cadence})`);
    return { id: s.id, message: `${i.name} added` };
  },
});

export const subscriptionUpdate = defineOp({
  name: "subscription.update", module: "subscriptions", label: "Edit subscription", aiAllowed: false,
  schema: input.extend({ id: zId }),
  summarize: (i) => `Update ${i.name}`,
  async run(ctx, i) {
    await own(ctx, i.id);
    await ctx.tx.update(subscriptions).set({ ...values(i), updatedAt: ctx.now }).where(eq(subscriptions.id, i.id));
    await syncSubscription(ctx, i.id);
    await audit(ctx, "subscriptions", "edited", "subscription", i.id, `Edited ${i.name}`);
    return { id: i.id, message: "Saved" };
  },
});

/** Records that she cancelled it (with the provider). The app never cancels anything itself. */
export const subscriptionCancel = defineOp({
  name: "subscription.cancel", module: "subscriptions", label: "Mark subscription cancelled", aiAllowed: true,
  schema: z.object({ id: zId, cancelledOn: zDate }),
  draftable: ["id"],
  summarize: (i) => `Mark subscription cancelled on ${dmy(i.cancelledOn)} (records it only; cancel with the provider yourself)`,
  async run(ctx, i) {
    const s = await own(ctx, i.id);
    if (s.status === "cancelled") throw new UserError("Already marked cancelled");
    if (i.cancelledOn > todayLocal(ctx.tz, ctx.now)) throw new UserError("Date can't be in the future", "cancelledOn");
    await ctx.tx.update(subscriptions).set({ status: "cancelled", cancelledOn: i.cancelledOn, updatedAt: ctx.now }).where(eq(subscriptions.id, i.id));
    await syncSubscription(ctx, i.id);
    await audit(ctx, "subscriptions", "cancelled", "subscription", i.id, `${s.name} marked cancelled`);
    return { id: i.id, message: `${s.name} marked cancelled. Reminders stopped.` };
  },
});

export const subscriptionReactivate = defineOp({
  name: "subscription.reactivate", module: "subscriptions", label: "Reactivate subscription", aiAllowed: false,
  schema: z.object({ id: zId, nextBillingDate: zDate }),
  summarize: (i) => `Reactivate, next charge ${dmy(i.nextBillingDate)}`,
  async run(ctx, i) {
    const s = await own(ctx, i.id);
    await ctx.tx.update(subscriptions).set({ status: "active", cancelledOn: null, anchorDate: i.nextBillingDate, updatedAt: ctx.now }).where(eq(subscriptions.id, i.id));
    await syncSubscription(ctx, i.id);
    await audit(ctx, "subscriptions", "edited", "subscription", i.id, `${s.name} reactivated`);
    return { id: i.id, message: `${s.name} active again` };
  },
});

export const subscriptionDelete = defineOp({
  name: "subscription.delete", module: "subscriptions", label: "Delete subscription", aiAllowed: false,
  schema: z.object({ id: zId }),
  summarize: () => "Delete subscription",
  async run(ctx, i) {
    const s = await own(ctx, i.id);
    await ctx.tx.update(subscriptions).set({ deletedAt: ctx.now }).where(eq(subscriptions.id, i.id));
    await cancelReminders(ctx.tx, ctx.ownerId, "subscription", i.id);
    await audit(ctx, "subscriptions", "deleted", "subscription", i.id, `Deleted ${s.name}`);
    return { id: i.id, message: "Deleted" };
  },
});
