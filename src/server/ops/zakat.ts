import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { zakatCalculations, zakatPayments } from "@/db/schema";
import { defineOp, zAmount, zCurrency, zDate, zId, zOptText, zText } from "./registry";
import { audit, UserError, type Ctx } from "../audit";
import { toMinor, formatMoney } from "@/lib/money";
import { computeZakat } from "@/lib/zakat";
import { dmy, fromHijri, toHijri, localToInstant, todayLocal } from "@/lib/time";
import { syncReminders, cancelReminders } from "../reminders";

/*
 * Zakat: an estimate calculator with saved snapshots, and a separate payments log.
 * Estimates are never payments; nothing here moves money; no religious rulings.
 * Calculations are manual-only (not AI-allowed); the AI may only propose logging a payment she describes.
 */

const zLine = z.object({ label: z.string().trim().max(80).default(""), amount: z.string().trim().max(24).default("") })
  .refine((l) => !l.amount || /^\d+(\.\d{1,3})?$/.test(l.amount.replace(/,/g, "")), "Amounts must be positive numbers");
const zDec = z.string().trim().regex(/^\d+(\.\d{1,3})?$/, "Enter a number").optional().nullable().or(z.literal("").transform(() => null));

export const zakatCalcInput = z.object({
  evaluationDate: zDate, currency: zCurrency,
  assets: z.array(zLine).max(40), liabilities: z.array(zLine).max(40).default([]),
  nisabBasis: z.enum(["gold", "silver", "manual"]),
  pricePerGram: zDec, nisabGrams: zDec, manualNisab: zDec,
  priceSource: zOptText(200),
  ratePercent: z.string().trim().regex(/^\d{1,2}(\.\d{1,2})?$/, "Rate like 2.5").default("2.5"),
  remindNextYear: z.boolean().default(false),
  notes: zOptText(2000),
});

/** One lunar (Hijri) year after the evaluation date, for the optional "remind me next year". */
export function nextHawl(date: string): string {
  const h = toHijri(date);
  try { return fromHijri(h.year + 1, h.month, h.day); } catch { return fromHijri(h.year + 1, h.month, Math.min(h.day, 29)); }
}

async function syncZakat(ctx: Ctx, id: string) {
  const [c] = await ctx.tx.select().from(zakatCalculations).where(eq(zakatCalculations.id, id));
  if (!c || c.deletedAt || !c.remindNextYear) return cancelReminders(ctx.tx, ctx.ownerId, "zakat", id);
  const due = nextHawl(c.evaluationDate);
  await syncReminders(ctx.tx, ctx.ownerId, "zakat", c.id, [-7, 0].map((off) => {
    const d = new Date(localToInstant(due, "09:00", ctx.tz).getTime() + off * 86400_000);
    return {
      dedupeKey: `zakat:${c.id}:${due}:o${off}`, fireAt: d,
      title: off === 0 ? "A lunar year since your last zakat estimate" : "A lunar year since your last zakat estimate is next week",
      publicBody: `Last estimate ${dmy(c.evaluationDate)}. Open the calculator when you're ready`,
      link: "/finance/zakat",
    };
  }), ctx.now);
}

export const zakatCalculate = defineOp({
  name: "zakat.calculate", module: "zakat", label: "Save zakat estimate", aiAllowed: false,
  schema: zakatCalcInput,
  summarize: (i) => `Save zakat estimate as of ${dmy(i.evaluationDate)}`,
  async run(ctx, i) {
    if (i.evaluationDate > todayLocal(ctx.tz, ctx.now)) throw new UserError("Evaluation date can't be in the future", "evaluationDate");
    const assets = i.assets.filter((l) => l.amount).map((l) => ({ label: l.label || "Asset", amount: l.amount.replace(/,/g, "") }));
    const liabilities = i.liabilities.filter((l) => l.amount).map((l) => ({ label: l.label || "Deduction", amount: l.amount.replace(/,/g, "") }));
    if (!assets.length) throw new UserError("Add at least one asset amount", "assets");
    let r;
    try {
      r = computeZakat({ currency: i.currency, assets, liabilities, nisabBasis: i.nisabBasis, pricePerGram: i.pricePerGram, nisabGrams: i.nisabGrams, manualNisab: i.manualNisab, ratePercent: i.ratePercent }, (m) => formatMoney(m, i.currency));
    } catch (e) { throw new UserError((e as Error).message); }
    const [c] = await ctx.tx.insert(zakatCalculations).values({
      ownerId: ctx.ownerId, evaluationDate: i.evaluationDate, currency: i.currency, assets, liabilities,
      nisabBasis: i.nisabBasis, pricePerGram: i.nisabBasis === "manual" ? null : i.pricePerGram ?? null,
      nisabGrams: i.nisabBasis === "manual" ? null : i.nisabGrams ?? null, priceSource: i.priceSource ?? null,
      assetsMinor: r.assetsMinor, liabilitiesMinor: r.liabilitiesMinor, netMinor: r.netMinor, nisabMinor: r.nisabMinor,
      aboveNisab: r.aboveNisab, rateBp: r.rateBp, zakatMinor: r.zakatMinor, steps: r.steps, remindNextYear: i.remindNextYear, notes: i.notes ?? null,
    }).returning({ id: zakatCalculations.id });
    await syncZakat(ctx, c.id);
    await audit(ctx, "zakat", "created", "zakat_calculation", c.id, `Saved zakat estimate (${formatMoney(r.zakatMinor, i.currency)}) as of ${dmy(i.evaluationDate)}`);
    return { id: c.id, message: `Estimate saved: ${formatMoney(r.zakatMinor, i.currency)}. This is not a payment.` };
  },
});

export const zakatCalcDelete = defineOp({
  name: "zakat.calculation.delete", module: "zakat", label: "Delete zakat estimate", aiAllowed: false,
  schema: z.object({ id: zId }),
  summarize: () => "Delete estimate",
  async run(ctx, i) {
    const res = await ctx.tx.update(zakatCalculations).set({ deletedAt: ctx.now })
      .where(and(eq(zakatCalculations.id, i.id), eq(zakatCalculations.ownerId, ctx.ownerId), isNull(zakatCalculations.deletedAt))).returning({ id: zakatCalculations.id });
    if (!res.length) throw new UserError("Estimate not found");
    await cancelReminders(ctx.tx, ctx.ownerId, "zakat", i.id);
    await audit(ctx, "zakat", "deleted", "zakat_calculation", i.id, "Deleted a zakat estimate");
    return { id: i.id, message: "Estimate deleted" };
  },
});

const payInput = z.object({
  paidOn: zDate, amount: zAmount, currency: zCurrency, recipient: zText(200),
  calculationId: zId.optional().nullable(), notes: zOptText(2000),
});

async function checkCalc(ctx: Ctx, id: string | null | undefined) {
  if (!id) return;
  const [c] = await ctx.tx.select({ id: zakatCalculations.id }).from(zakatCalculations).where(and(eq(zakatCalculations.id, id), eq(zakatCalculations.ownerId, ctx.ownerId), isNull(zakatCalculations.deletedAt)));
  if (!c) throw new UserError("Estimate not found", "calculationId");
}

export const zakatPay = defineOp({
  name: "zakat.payment", module: "zakat", label: "Log zakat payment", aiAllowed: true,
  schema: payInput, draftable: ["amount", "recipient"],
  summarize: (i) => `Log zakat paid: ${i.amount} ${i.currency} to ${i.recipient} on ${dmy(i.paidOn)}`,
  async run(ctx, i) {
    if (i.paidOn > todayLocal(ctx.tz, ctx.now)) throw new UserError("Date can't be in the future", "paidOn");
    await checkCalc(ctx, i.calculationId);
    const [p] = await ctx.tx.insert(zakatPayments).values({ ownerId: ctx.ownerId, paidOn: i.paidOn, amountMinor: toMinor(i.amount, i.currency), currency: i.currency, recipient: i.recipient, calculationId: i.calculationId ?? null, notes: i.notes ?? null, source: ctx.source }).returning({ id: zakatPayments.id });
    await audit(ctx, "zakat", "created", "zakat_payment", p.id, `Zakat paid ${i.amount} ${i.currency} — ${i.recipient}`);
    return { id: p.id, message: `Zakat payment logged: ${i.amount} ${i.currency}` };
  },
});

export const zakatPayUpdate = defineOp({
  name: "zakat.payment.update", module: "zakat", label: "Edit zakat payment", aiAllowed: false,
  schema: payInput.extend({ id: zId }),
  summarize: () => "Edit zakat payment",
  async run(ctx, i) {
    if (i.paidOn > todayLocal(ctx.tz, ctx.now)) throw new UserError("Date can't be in the future", "paidOn");
    await checkCalc(ctx, i.calculationId);
    const res = await ctx.tx.update(zakatPayments).set({ paidOn: i.paidOn, amountMinor: toMinor(i.amount, i.currency), currency: i.currency, recipient: i.recipient, calculationId: i.calculationId ?? null, notes: i.notes ?? null, updatedAt: ctx.now })
      .where(and(eq(zakatPayments.id, i.id), eq(zakatPayments.ownerId, ctx.ownerId), isNull(zakatPayments.deletedAt))).returning({ id: zakatPayments.id });
    if (!res.length) throw new UserError("Payment not found");
    await audit(ctx, "zakat", "edited", "zakat_payment", i.id, `Edited zakat payment (${i.amount} ${i.currency})`);
    return { id: i.id, message: "Saved" };
  },
});

export const zakatPayDelete = defineOp({
  name: "zakat.payment.delete", module: "zakat", label: "Delete zakat payment", aiAllowed: false,
  schema: z.object({ id: zId }),
  summarize: () => "Delete zakat payment",
  async run(ctx, i) {
    const res = await ctx.tx.update(zakatPayments).set({ deletedAt: ctx.now })
      .where(and(eq(zakatPayments.id, i.id), eq(zakatPayments.ownerId, ctx.ownerId), isNull(zakatPayments.deletedAt))).returning({ id: zakatPayments.id });
    if (!res.length) throw new UserError("Payment not found");
    await audit(ctx, "zakat", "deleted", "zakat_payment", i.id, "Deleted a zakat payment");
    return { id: i.id, message: "Deleted" };
  },
});
