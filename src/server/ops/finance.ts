import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { charityPayments, savingsGoals, savingsTransactions, debts, debtRepayments } from "@/db/schema";
import { defineOp, zDate, zAmount, zCurrency, zId, zText, zOptText, zTime } from "./registry";
import { audit, UserError, type Ctx } from "../audit";
import { toMinor, formatMoney } from "@/lib/money";
import { addDays, localToInstant, todayLocal, addMonths, dmy } from "@/lib/time";
import { syncReminders, cancelReminders, type DesiredReminder } from "../reminders";

/* ───────────── Charity ───────────── */

const charityInput = z.object({
  paidOn: zDate,
  recipient: zText(200),
  cause: zOptText(200),
  amount: zAmount,
  currency: zCurrency,
  status: z.enum(["planned", "completed"]).default("completed"),
  recurring: z.boolean().default(false),
  notes: zOptText(),
});

export const charityCreate = defineOp({
  name: "charity.create", module: "charity", label: "Log charity", aiAllowed: true,
  // repeatMonths: also add the same donation on the same day of each of the next N months, within the same year.
  schema: charityInput.extend({ repeatMonths: z.number().int().min(0).max(11).default(0) }), draftable: ["amount", "recipient", "paidOn"],
  summarize: (i) => `${i.status === "planned" ? "Plan" : "Log"} donation of ${i.amount} ${i.currency} to ${i.recipient}${i.cause ? ` for ${i.cause}` : ""} on ${dmy(i.paidOn)}${i.repeatMonths ? `, and for the next ${i.repeatMonths} month${i.repeatMonths === 1 ? "" : "s"}` : ""}`,
  async run(ctx, i) {
    const year = i.paidOn.slice(0, 4);
    const dates = [i.paidOn, ...Array.from({ length: i.repeatMonths }, (_, k) => addMonths(i.paidOn, k + 1))].filter((d) => d.slice(0, 4) === year);
    const recurring = i.recurring || dates.length > 1;
    const rows = await ctx.tx.insert(charityPayments).values(dates.map((paidOn) => ({
      ownerId: ctx.ownerId, paidOn, recipient: i.recipient, cause: i.cause,
      amountMinor: toMinor(i.amount, i.currency), currency: i.currency, status: i.status,
      recurring, notes: i.notes, source: ctx.source,
    }))).returning({ id: charityPayments.id });
    const row = rows[0];
    const msg = `${i.status === "planned" ? "Planned" : "Donated"} ${i.amount} ${i.currency} — ${i.recipient}${rows.length > 1 ? `, plus ${rows.length - 1} more month${rows.length === 2 ? "" : "s"}` : ""}`;
    await audit(ctx, "charity", "created", "charity_payment", row.id, msg);
    return { id: row.id, message: msg };
  },
});

export const charityUpdate = defineOp({
  name: "charity.update", module: "charity", label: "Edit charity entry", aiAllowed: true,
  schema: charityInput.extend({ id: zId }),
  summarize: (i) => `Update donation to ${i.recipient}: ${i.amount} ${i.currency} on ${dmy(i.paidOn)} (${i.status})`,
  async run(ctx, i) {
    const res = await ctx.tx.update(charityPayments).set({
      paidOn: i.paidOn, recipient: i.recipient, cause: i.cause, amountMinor: toMinor(i.amount, i.currency),
      currency: i.currency, status: i.status, recurring: i.recurring, notes: i.notes, updatedAt: ctx.now,
    }).where(and(eq(charityPayments.id, i.id), eq(charityPayments.ownerId, ctx.ownerId), isNull(charityPayments.deletedAt)))
      .returning({ id: charityPayments.id });
    if (!res.length) throw new UserError("Entry not found");
    await audit(ctx, "charity", "edited", "charity_payment", i.id, `Edited donation — ${i.recipient}`);
    return { id: i.id, message: "Donation updated" };
  },
});

export const charityDelete = defineOp({
  name: "charity.delete", module: "charity", label: "Delete charity entry", aiAllowed: false,
  schema: z.object({ id: zId }),
  summarize: () => "Delete donation",
  async run(ctx, i) {
    const res = await ctx.tx.update(charityPayments).set({ deletedAt: ctx.now })
      .where(and(eq(charityPayments.id, i.id), eq(charityPayments.ownerId, ctx.ownerId), isNull(charityPayments.deletedAt)))
      .returning({ recipient: charityPayments.recipient });
    if (!res.length) throw new UserError("Entry not found");
    await audit(ctx, "charity", "deleted", "charity_payment", i.id, `Deleted donation — ${res[0].recipient}`);
    return { id: i.id, message: "Donation deleted" };
  },
});

/* ───────────── Savings ───────────── */

async function goalBalance(ctx: Ctx, goalId: string) {
  const [g] = await ctx.tx.select().from(savingsGoals).where(and(eq(savingsGoals.id, goalId), eq(savingsGoals.ownerId, ctx.ownerId)));
  if (!g) throw new UserError("Savings goal not found");
  const [{ net }] = await ctx.tx.select({
    net: sql<string>`coalesce(sum(case when ${savingsTransactions.type}='deposit' then ${savingsTransactions.amountMinor} else -${savingsTransactions.amountMinor} end),0)`,
  }).from(savingsTransactions).where(and(eq(savingsTransactions.goalId, goalId), isNull(savingsTransactions.voidedAt)));
  return { goal: g, balance: g.openingBalanceMinor + Number(net) };
}

async function syncSavingsReminders(ctx: Ctx, goalId: string) {
  const [g] = await ctx.tx.select().from(savingsGoals).where(eq(savingsGoals.id, goalId));
  if (!g || !g.remindersEnabled || !g.reminderDayOfMonth || g.status !== "active") {
    return cancelReminders(ctx.tx, ctx.ownerId, "savings_goal", goalId);
  }
  const today = todayLocal(ctx.tz, ctx.now);
  const desired: DesiredReminder[] = [];
  for (let m = 0; m < 3; m++) {
    const monthStart = addMonths(today.slice(0, 8) + "01", m);
    const dim = new Date(Date.UTC(+monthStart.slice(0, 4), +monthStart.slice(5, 7), 0)).getUTCDate();
    const day = Math.min(g.reminderDayOfMonth, dim);
    const date = monthStart.slice(0, 8) + String(day).padStart(2, "0");
    desired.push({
      dedupeKey: `savings:${g.id}:${date}`, fireAt: localToInstant(date, "09:00", ctx.tz),
      title: `Savings: ${g.name}`,
      publicBody: g.plannedMonthlyMinor ? `Planned contribution ${formatMoney(g.plannedMonthlyMinor, g.currency)}` : "Monthly contribution reminder",
      link: `/finance/savings`,
    });
  }
  await syncReminders(ctx.tx, ctx.ownerId, "savings_goal", g.id, desired, ctx.now);
}

const goalInput = z.object({
  name: zText(120), target: zAmount, currency: zCurrency, targetDate: zDate.optional().nullable(),
  openingBalance: zAmount.default("0"), plannedMonthly: zAmount.optional().nullable(),
  reminderDayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
  remindersEnabled: z.boolean().default(false), notes: zOptText(),
});

export const savingsGoalCreate = defineOp({
  name: "savings.goal.create", module: "savings", label: "Create savings goal", aiAllowed: true,
  schema: goalInput, draftable: ["target"],
  summarize: (i) => `Create savings goal “${i.name}” — target ${i.target} ${i.currency}${i.targetDate ? ` by ${dmy(i.targetDate)}` : ""}`,
  async run(ctx, i) {
    const [g] = await ctx.tx.insert(savingsGoals).values({
      ownerId: ctx.ownerId, name: i.name, targetMinor: toMinor(i.target, i.currency), currency: i.currency,
      targetDate: i.targetDate ?? null, openingBalanceMinor: toMinor(i.openingBalance, i.currency),
      plannedMonthlyMinor: i.plannedMonthly ? toMinor(i.plannedMonthly, i.currency) : null,
      reminderDayOfMonth: i.reminderDayOfMonth ?? null, remindersEnabled: i.remindersEnabled, notes: i.notes,
    }).returning({ id: savingsGoals.id });
    await syncSavingsReminders(ctx, g.id);
    await audit(ctx, "savings", "created", "savings_goal", g.id, `Created goal “${i.name}”`);
    return { id: g.id, message: `Goal “${i.name}” created` };
  },
});

export const savingsGoalUpdate = defineOp({
  name: "savings.goal.update", module: "savings", label: "Edit savings goal", aiAllowed: false,
  schema: goalInput.extend({ id: zId, status: z.enum(["active", "achieved", "archived"]).default("active") }),
  summarize: (i) => `Update goal “${i.name}”`,
  async run(ctx, i) {
    const res = await ctx.tx.update(savingsGoals).set({
      name: i.name, targetMinor: toMinor(i.target, i.currency), currency: i.currency, targetDate: i.targetDate ?? null,
      openingBalanceMinor: toMinor(i.openingBalance, i.currency),
      plannedMonthlyMinor: i.plannedMonthly ? toMinor(i.plannedMonthly, i.currency) : null,
      reminderDayOfMonth: i.reminderDayOfMonth ?? null, remindersEnabled: i.remindersEnabled,
      status: i.status, notes: i.notes, updatedAt: ctx.now,
    }).where(and(eq(savingsGoals.id, i.id), eq(savingsGoals.ownerId, ctx.ownerId))).returning({ id: savingsGoals.id });
    if (!res.length) throw new UserError("Savings goal not found");
    await syncSavingsReminders(ctx, i.id);
    await audit(ctx, "savings", "edited", "savings_goal", i.id, `Edited goal “${i.name}”`);
    return { id: i.id, message: "Goal updated" };
  },
});

const txnInput = z.object({ goalId: zId, amount: zAmount, onDate: zDate, notes: zOptText() });

export const savingsDeposit = defineOp({
  name: "savings.deposit", module: "savings", label: "Add savings", aiAllowed: true,
  schema: txnInput, draftable: ["amount", "goalId"],
  summarize: (i) => `Deposit ${i.amount} into savings goal on ${dmy(i.onDate)}`,
  async run(ctx, i) {
    const { goal } = await goalBalance(ctx, i.goalId);
    const [t] = await ctx.tx.insert(savingsTransactions).values({
      ownerId: ctx.ownerId, goalId: goal.id, type: "deposit", amountMinor: toMinor(i.amount, goal.currency),
      onDate: i.onDate, notes: i.notes, source: ctx.source,
    }).returning({ id: savingsTransactions.id });
    const msg = `Saved ${i.amount} ${goal.currency} → ${goal.name}`;
    await audit(ctx, "savings", "deposit", "savings_transaction", t.id, msg);
    return { id: t.id, message: msg };
  },
});

export const savingsWithdraw = defineOp({
  name: "savings.withdraw", module: "savings", label: "Withdraw savings", aiAllowed: true,
  schema: txnInput, draftable: ["amount", "goalId"],
  summarize: (i) => `Withdraw ${i.amount} from savings goal on ${dmy(i.onDate)}`,
  async run(ctx, i) {
    const { goal, balance } = await goalBalance(ctx, i.goalId);
    const amt = toMinor(i.amount, goal.currency);
    if (amt > balance) throw new UserError(`Withdrawal exceeds current balance (${formatMoney(balance, goal.currency)})`, "amount");
    const [t] = await ctx.tx.insert(savingsTransactions).values({
      ownerId: ctx.ownerId, goalId: goal.id, type: "withdrawal", amountMinor: amt, onDate: i.onDate, notes: i.notes, source: ctx.source,
    }).returning({ id: savingsTransactions.id });
    const msg = `Withdrew ${i.amount} ${goal.currency} from ${goal.name}`;
    await audit(ctx, "savings", "withdrawal", "savings_transaction", t.id, msg);
    return { id: t.id, message: msg };
  },
});

/* ───────────── Lent / borrowed ───────────── */

export async function debtOutstanding(ctx: Pick<Ctx, "tx" | "ownerId">, debtId: string) {
  const [d] = await ctx.tx.select().from(debts).where(and(eq(debts.id, debtId), eq(debts.ownerId, ctx.ownerId), isNull(debts.deletedAt)));
  if (!d) throw new UserError("Record not found");
  const [{ paid, adj }] = await ctx.tx.select({
    paid: sql<string>`coalesce(sum(case when ${debtRepayments.type}='repayment' then ${debtRepayments.amountMinor} else 0 end),0)`,
    adj: sql<string>`coalesce(sum(case when ${debtRepayments.type}='adjustment' then ${debtRepayments.amountMinor} else 0 end),0)`,
  }).from(debtRepayments).where(and(eq(debtRepayments.debtId, debtId), isNull(debtRepayments.voidedAt)));
  return { debt: d, outstanding: d.originalMinor + Number(adj) - Number(paid) };
}

export async function syncDebtReminders(ctx: Ctx, debtId: string) {
  const { debt: d, outstanding } = await debtOutstanding(ctx, debtId);
  if (d.status === "settled" || outstanding <= 0 || !d.remindersEnabled || !d.dueDate) {
    return cancelReminders(ctx.tx, ctx.ownerId, "debt", d.id);
  }
  const verb = d.direction === "lent" ? `from ${d.counterparty}` : `to ${d.counterparty}`;
  const amount = formatMoney(outstanding, d.currency);
  const desired: DesiredReminder[] = d.reminderOffsetsDays.map((off) => ({
    dedupeKey: `debt:${d.id}:${d.dueDate}:o${off}`,
    fireAt: localToInstant(addDays(d.dueDate!, off), d.reminderTime, ctx.tz),
    title: d.direction === "lent" ? "I need to collect" : "I need to repay",
    publicBody: `${verb} — ${amount}${off < 0 ? ` (due in ${-off} day${off === -1 ? "" : "s"})` : off === 0 ? " (due today)" : ""}`,
    link: "/finance/debts",
  }));
  if (d.overdueRepeatDays && d.overdueRepeatDays > 0) {
    for (let k = 1; k <= 4; k++) {
      const date = addDays(d.dueDate, k * d.overdueRepeatDays);
      desired.push({
        dedupeKey: `debt:${d.id}:${d.dueDate}:overdue${k}`,
        fireAt: localToInstant(date, d.reminderTime, ctx.tz),
        title: d.direction === "lent" ? "Overdue — I need to collect" : "Overdue — I need to repay",
        publicBody: `${verb} — ${amount} (overdue)`, link: "/finance/debts",
      });
    }
  }
  await syncReminders(ctx.tx, ctx.ownerId, "debt", d.id, desired, ctx.now);
}

const debtInput = z.object({
  direction: z.enum(["lent", "borrowed"]), counterparty: zText(120), amount: zAmount, currency: zCurrency,
  onDate: zDate, dueDate: zDate.optional().nullable(),
  reminderOffsetsDays: z.array(z.number().int().min(-60).max(0)).max(6).default([-1, 0]),
  overdueRepeatDays: z.number().int().min(0).max(60).default(3), reminderTime: zTime.default("09:00"),
  remindersEnabled: z.boolean().default(true), notes: zOptText(),
});

export const debtCreate = defineOp({
  name: "debt.create", module: "debts", label: "Record lent/borrowed", aiAllowed: true,
  schema: debtInput, draftable: ["amount", "counterparty", "dueDate"],
  summarize: (i) => `${i.direction === "lent" ? "I lent" : "I borrowed from"} ${i.counterparty} ${i.amount} ${i.currency} on ${dmy(i.onDate)}${i.dueDate ? `; due ${dmy(i.dueDate)} (reminders ${i.reminderOffsetsDays.map((o) => (o === 0 ? "on due date" : `${-o}d before`)).join(", ")})` : ""}`,
  async run(ctx, i) {
    const [d] = await ctx.tx.insert(debts).values({
      ownerId: ctx.ownerId, direction: i.direction, counterparty: i.counterparty,
      originalMinor: toMinor(i.amount, i.currency), currency: i.currency, onDate: i.onDate, dueDate: i.dueDate ?? null,
      reminderOffsetsDays: i.reminderOffsetsDays, overdueRepeatDays: i.overdueRepeatDays, reminderTime: i.reminderTime,
      remindersEnabled: i.remindersEnabled, notes: i.notes, source: ctx.source,
    }).returning({ id: debts.id });
    await syncDebtReminders(ctx, d.id);
    const msg = `${i.direction === "lent" ? "Lent" : "Borrowed"} ${i.amount} ${i.currency} — ${i.counterparty}`;
    await audit(ctx, "debts", "created", "debt", d.id, msg);
    return { id: d.id, message: msg };
  },
});

export const debtUpdate = defineOp({
  name: "debt.update", module: "debts", label: "Edit lent/borrowed", aiAllowed: false,
  // The amount is edited here too: type the correct amount and the outstanding balance follows (repayments are kept).
  schema: debtInput.omit({ amount: true, currency: true, direction: true }).extend({ id: zId, amount: zAmount.optional() }),
  summarize: (i) => `Update record for ${i.counterparty}${i.amount ? ` (amount ${i.amount})` : ""}`,
  async run(ctx, i) {
    let amountChange: { originalMinor: number; status: "open" | "settled" } | null = null;
    let amountNote = "";
    if (i.amount !== undefined) {
      const { debt: d, outstanding } = await debtOutstanding(ctx, i.id);
      const next = toMinor(i.amount, d.currency);
      if (next !== Number(d.originalMinor)) {
        const left = outstanding + (next - Number(d.originalMinor));
        if (left < 0) throw new UserError(`That's less than what's already been repaid (${formatMoney(Number(d.originalMinor) - outstanding, d.currency)}).`, "amount");
        amountChange = { originalMinor: next, status: left === 0 ? "settled" : "open" };
        amountNote = `; amount ${formatMoney(Number(d.originalMinor), d.currency)} → ${formatMoney(next, d.currency)}`;
      }
    }
    const res = await ctx.tx.update(debts).set({
      ...(amountChange ?? {}),
      counterparty: i.counterparty, onDate: i.onDate, dueDate: i.dueDate ?? null,
      reminderOffsetsDays: i.reminderOffsetsDays, overdueRepeatDays: i.overdueRepeatDays, reminderTime: i.reminderTime,
      remindersEnabled: i.remindersEnabled, notes: i.notes, updatedAt: ctx.now,
    }).where(and(eq(debts.id, i.id), eq(debts.ownerId, ctx.ownerId), isNull(debts.deletedAt))).returning({ id: debts.id });
    if (!res.length) throw new UserError("Record not found");
    await syncDebtReminders(ctx, i.id);
    await audit(ctx, "debts", "edited", "debt", i.id, `Edited record — ${i.counterparty}${amountNote}`);
    return { id: i.id, message: "Updated" };
  },
});

export const debtRepay = defineOp({
  name: "debt.repay", module: "debts", label: "Record repayment", aiAllowed: true,
  schema: z.object({ debtId: zId, amount: zAmount, onDate: zDate, notes: zOptText() }),
  draftable: ["amount"],
  summarize: (i) => `Record repayment of ${i.amount} on ${dmy(i.onDate)}`,
  async run(ctx, i) {
    const { debt: d, outstanding } = await debtOutstanding(ctx, i.debtId);
    const amt = toMinor(i.amount, d.currency);
    if (amt > outstanding) throw new UserError(`Repayment is more than the outstanding ${formatMoney(outstanding, d.currency)}. If the amount was wrong, edit the record and type the correct amount.`, "amount");
    const [r] = await ctx.tx.insert(debtRepayments).values({ ownerId: ctx.ownerId, debtId: d.id, type: "repayment", amountMinor: amt, onDate: i.onDate, notes: i.notes }).returning({ id: debtRepayments.id });
    const left = outstanding - amt;
    if (left === 0) await ctx.tx.update(debts).set({ status: "settled", updatedAt: ctx.now }).where(eq(debts.id, d.id));
    await syncDebtReminders(ctx, d.id);
    const msg = `${d.direction === "lent" ? `${d.counterparty} repaid` : `Repaid ${d.counterparty}`} ${i.amount} ${d.currency}${left === 0 ? " — settled" : ` — ${formatMoney(left, d.currency)} outstanding`}`;
    await audit(ctx, "debts", left === 0 ? "settled" : "repayment", "debt", d.id, msg);
    return { id: r.id, message: msg };
  },
});

export const debtAdjust = defineOp({
  name: "debt.adjust", module: "debts", label: "Correct amount (audited)", aiAllowed: false,
  schema: z.object({ debtId: zId, delta: z.string().regex(/^-?\d+(\.\d{1,3})?$/), onDate: zDate, notes: zOptText(500) }),
  summarize: (i) => `Adjust outstanding by ${i.delta}${i.notes ? `: ${i.notes}` : ""}`,
  async run(ctx, i) {
    const { debt: d, outstanding } = await debtOutstanding(ctx, i.debtId);
    const delta = toMinor(i.delta, d.currency);
    if (outstanding + delta < 0) throw new UserError("Adjustment would make the outstanding amount negative", "delta");
    const [r] = await ctx.tx.insert(debtRepayments).values({ ownerId: ctx.ownerId, debtId: d.id, type: "adjustment", amountMinor: delta, onDate: i.onDate, notes: i.notes }).returning({ id: debtRepayments.id });
    const left = outstanding + delta;
    await ctx.tx.update(debts).set({ status: left === 0 ? "settled" : "open", updatedAt: ctx.now }).where(eq(debts.id, d.id));
    await syncDebtReminders(ctx, d.id);
    await audit(ctx, "debts", "adjusted", "debt", d.id, `Adjusted ${d.counterparty} by ${i.delta} ${d.currency}${i.notes ? `: ${i.notes}` : ""}`);
    return { id: r.id, message: "Adjustment recorded" };
  },
});

export const debtDelete = defineOp({
  name: "debt.delete", module: "debts", label: "Delete lent/borrowed record", aiAllowed: true,
  schema: z.object({ id: zId }),
  summarize: () => "Delete record",
  async run(ctx, i) {
    const res = await ctx.tx.update(debts).set({ deletedAt: ctx.now }).where(and(eq(debts.id, i.id), eq(debts.ownerId, ctx.ownerId), isNull(debts.deletedAt))).returning({ c: debts.counterparty });
    if (!res.length) throw new UserError("Record not found");
    await cancelReminders(ctx.tx, ctx.ownerId, "debt", i.id);
    await audit(ctx, "debts", "deleted", "debt", i.id, `Deleted record — ${res[0].c}`);
    return { id: i.id, message: "Deleted" };
  },
});
