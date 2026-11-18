import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, closeDb } from "@/db";
import { reminders, zakatCalculations, zakatPayments, charityPayments } from "@/db/schema";
import { runOpInTx, getOp } from "@/server/ops";
import { subscriptionsState, zakatState } from "@/server/queries";
import { resetDb, makeOwner, withCtx } from "../support/db";
import { localToInstant } from "@/lib/time";

const at = (d: string) => localToInstant(d, "12:00");
let owner: Awaited<ReturnType<typeof makeOwner>>;
const op = (now: Date, name: string, input: unknown, who = owner.id) =>
  withCtx(who, now, (ctx) => runOpInTx(ctx.tx, { ownerId: who, tz: ctx.tz, source: "manual", now }, name, input));
const pending = (sourceType: string) => getDb().select().from(reminders).where(and(eq(reminders.ownerId, owner.id), eq(reminders.sourceType, sourceType), eq(reminders.status, "scheduled")));

beforeEach(async () => { await resetDb(); owner = await makeOwner(); });
afterAll(async () => { await closeDb(); });

describe("Subscriptions (PRD 4.10)", () => {
  it("renewal and trial reminders, monthly equivalent, upcoming charges; cancelling stops reminders", async () => {
    const s = await op(at("2026-11-18"), "subscription.create", { name: "Cloud storage", amount: "119.88", currency: "SAR", cadence: "yearly", nextBillingDate: "2026-12-01", trialEndsOn: "2026-11-25", paymentLabel: "Visa ending 4821", reminderOffsetsDays: [-3, 0], trialOffsetsDays: [-1] });
    await op(at("2026-11-18"), "subscription.create", { name: "Music", amount: "21.99", currency: "SAR", cadence: "monthly", nextBillingDate: "2026-11-20" });
    const r = await pending("subscription");
    const keys = r.map((x) => x.dedupeKey.replace(/:[0-9a-f-]{36}:/, ":")).sort();
    expect(keys).toEqual(expect.arrayContaining(["sub:2026-12-01:o-3", "sub:2026-12-01:o0", "subtrial:2026-11-25:o-1"]));
    const trial = r.find((x) => x.dedupeKey.startsWith("subtrial"))!;
    expect(trial.fireAt.toISOString()).toBe(localToInstant("2026-11-24", "09:00").toISOString());

    const st = await subscriptionsState({ ...owner, timezone: "Asia/Riyadh" });
    expect(st.totals.SAR.monthly).toBe(9_99 + 21_99);
    expect(st.upcoming.map((u) => [u.name, u.date])).toEqual([["Music", "2026-11-20"], ["Cloud storage", "2026-12-01"], ["Music", "2026-12-20"]]);

    await op(at("2026-11-19"), "subscription.cancel", { id: s.id, cancelledOn: "2026-11-19" });
    expect((await pending("subscription")).every((x) => !x.dedupeKey.includes(s.id!))).toBe(true);
  });

  it("refuses card numbers in the payment label", async () => {
    await expect(op(at("2026-11-18"), "subscription.create", { name: "X", amount: "5", nextBillingDate: "2026-12-01", paymentLabel: "4111 1111 1111 1111" })).rejects.toThrow(/never a full card number/);
  });
});

describe("Zakat (PRD 4.17)", () => {
  it("server recomputes the snapshot; estimate is never a payment; payments are separate; next-year reminder", async () => {
    expect(getOp("zakat.calculate")!.aiAllowed).toBe(false);
    const c = await op(at("2026-11-18"), "zakat.calculate", {
      evaluationDate: "2026-11-18", currency: "SAR", nisabBasis: "silver", pricePerGram: "4.10", ratePercent: "2.5", remindNextYear: true,
      assets: [{ label: "Bank", amount: "20,000" }, { label: "", amount: "" }], liabilities: [],
      zakatMinor: 1, // ignored: not part of the input schema
    });
    const [row] = await getDb().select().from(zakatCalculations);
    expect(row.zakatMinor).toBe(50_000);
    expect(row.assets).toEqual([{ label: "Bank", amount: "20000" }]);
    expect(await getDb().select().from(zakatPayments)).toHaveLength(0);
    expect(await getDb().select().from(charityPayments)).toHaveLength(0);
    const rem = await pending("zakat");
    expect(rem).toHaveLength(2);
    expect(rem.every((x) => x.fireAt > at("2027-10-01"))).toBe(true); // ~354 days later

    await op(at("2026-11-20"), "zakat.payment", { paidOn: "2026-11-20", amount: "300", currency: "SAR", recipient: "Local charity", calculationId: c.id });
    const z = await zakatState(owner);
    expect(z.calcs[0]).toMatchObject({ paidMinor: 30_000, payments: 1 });
  });

  it("validation and owner isolation", async () => {
    await expect(op(at("2026-11-18"), "zakat.calculate", { evaluationDate: "2026-11-18", currency: "SAR", nisabBasis: "gold", ratePercent: "2.5", assets: [{ label: "Bank", amount: "100" }] })).rejects.toThrow(/gold price/);
    const other = await makeOwner("other@example.com");
    const c = await op(at("2026-11-18"), "zakat.calculate", { evaluationDate: "2026-11-18", currency: "SAR", nisabBasis: "manual", manualNisab: "2000", assets: [{ label: "Bank", amount: "5000" }] }, other.id);
    await expect(op(at("2026-11-18"), "zakat.payment", { paidOn: "2026-11-18", amount: "10", recipient: "X", calculationId: c.id })).rejects.toThrow(/Estimate not found/);
    await expect(op(at("2026-11-18"), "zakat.calculation.delete", { id: c.id })).rejects.toThrow(/not found/);
  });
});
