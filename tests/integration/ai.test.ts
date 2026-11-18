import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "@/db";
import { routines, charityPayments, captureDrafts } from "@/db/schema";
import { interpret, correct, confirm, cancel, runSearch } from "@/server/ai/service";
import { runOpInTx } from "@/server/ops";
import { resetDb, makeOwner, userDataCounts, withCtx } from "../support/db";

let owner: { id: string; timezone: string; defaultCurrency: string };

beforeEach(async () => {
  await resetDb();
  const u = await makeOwner();
  owner = { id: u.id, timezone: "Asia/Riyadh", defaultCurrency: "SAR" };
  await getDb().insert(routines).values([
    { ownerId: u.id, name: "Change bedsheets", kind: "bedsheets", intervalValue: 7, intervalUnit: "day" },
    { ownerId: u.id, name: "Clean makeup brushes", kind: "brushes", intervalValue: 7, intervalUnit: "day" },
  ]);
  await withCtx(u.id, new Date(), (ctx) => runOpInTx(ctx.tx, { ownerId: u.id, tz: ctx.tz, source: "manual", now: ctx.now }, "fasts.initial", { count: 5, asOf: "2026-01-01" }));
});
afterAll(async () => { await closeDb(); });

async function capture(text: string) {
  const r = await interpret(owner, text, "text");
  if (r.kind !== "proposal") throw new Error("expected proposal");
  return r.proposal;
}

describe("Test 8 — multi-action capture creates nothing until confirmed", () => {
  it("three previews, zero writes, then exactly three records after Confirm", async () => {
    const before = await userDataCounts();
    const p = await capture("Donated 100 SAR via Ehsan, changed bedsheets, and finished a fast");
    expect(p.operations.map((o) => o.op)).toEqual(["charity.create", "routine.log", "fasts.complete"]);
    expect(p.operations.every((o) => o.valid)).toBe(true);
    expect(await userDataCounts()).toEqual(before);

    const res = await confirm(owner, p.id, p.version, p.operations.map((o) => ({ position: o.position, mode: "apply" })));
    expect(res.outcomes.map((o) => o.status)).toEqual(["applied", "applied", "applied"]);
    const after = await userDataCounts();
    expect(after.charity_payments).toBe(before.charity_payments + 1);
    expect(after.routine_events).toBe(before.routine_events + 1);
    expect(after.fast_ledger_events).toBe(before.fast_ledger_events + 1);
    const [c] = await getDb().select().from(charityPayments);
    expect(c.amountMinor).toBe(10000);
    expect(c.source).toBe("ai");

    // Idempotent: a retried confirm doesn't write again.
    const again = await confirm(owner, p.id, p.version, p.operations.map((o) => ({ position: o.position, mode: "apply" })));
    expect(again.alreadyConfirmed).toBe(true);
    expect(await userDataCounts()).toEqual(after);
  });

  it("per-entry uncheck: skipped ops are not saved", async () => {
    const p = await capture("Donated 100 SAR via Ehsan, changed bedsheets, and finished a fast");
    await confirm(owner, p.id, p.version, [{ position: 0, mode: "apply" }, { position: 1, mode: "skip" }, { position: 2, mode: "skip" }]);
    const c = await userDataCounts();
    expect(c.charity_payments).toBe(1);
    expect(c.routine_events).toBe(0);
  });

  it("a failing op rolls back the whole batch", async () => {
    const p = await capture("Donated 100 SAR via Ehsan and I completed one fast tomorrow");
    const before = await userDataCounts();
    await expect(confirm(owner, p.id, p.version, p.operations.map((o) => ({ position: o.position, mode: "apply" })))).rejects.toThrow(/future/);
    expect(await userDataCounts()).toEqual(before);
  });
});

describe("Test 9 — natural-language correction changes the preview only", () => {
  it("“Actually, make the donation 150” updates the amount; nothing written", async () => {
    const p = await capture("Donated 100 SAR via Ehsan, changed bedsheets, and finished a fast");
    const before = await userDataCounts();
    const p2 = await correct(owner, p.id, "Actually, make the donation 150");
    expect(p2.version).toBe(2);
    expect(p2.operations[0].input.amount).toBe("150");
    expect(p2.operations).toHaveLength(3);
    expect(await userDataCounts()).toEqual(before);
    // Confirming the stale version is refused.
    await expect(confirm(owner, p.id, 1, [{ position: 0, mode: "apply" }])).rejects.toThrow(/changed/);
    await confirm(owner, p.id, 2, [{ position: 0, mode: "apply" }]);
    const [c] = await getDb().select().from(charityPayments);
    expect(c.amountMinor).toBe(15000);
  });

  it("“no, next Thursday” changes the due date", async () => {
    const p = await capture("I lent Sara 200 SAR yesterday, she will repay Friday");
    expect(p.operations[0].input).toMatchObject({ direction: "lent", counterparty: "Sara", amount: "200", dueDate: expect.any(String) });
    const p2 = await correct(owner, p.id, "no, due next Thursday");
    expect(p2.operations[0].input.dueDate).not.toBe(p.operations[0].input.dueDate);
  });
});

describe("Test 10 / 22 — incomplete capture → confirmed draft in Needs Details", () => {
  it("missing amount offers a question and a draft only after confirmation", async () => {
    const p = await capture("I donated through Ehsan today");
    expect(p.operations[0].valid).toBe(false);
    expect(p.operations[0].missing).toContain("amount");
    expect(p.questions.join(" ")).toMatch(/how much/i);
    expect(await getDb().select().from(captureDrafts)).toHaveLength(0);
    await confirm(owner, p.id, p.version, [{ position: 0, mode: "draft" }]);
    const drafts = await getDb().select().from(captureDrafts);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].missingFields).toContain("amount");
    expect(await getDb().select().from(charityPayments)).toHaveLength(0);
  });
  it("an invalid op cannot be applied, only drafted", async () => {
    const p = await capture("I donated through Ehsan today");
    await expect(confirm(owner, p.id, p.version, [{ position: 0, mode: "apply" }])).rejects.toThrow();
    expect(await getDb().select().from(charityPayments)).toHaveLength(0);
  });
  it("cancelled or interrupted proposals never write", async () => {
    const before = await userDataCounts();
    const p = await capture("changed bedsheets");
    await cancel(owner.id, p.id);
    await expect(confirm(owner, p.id, p.version, [{ position: 0, mode: "apply" }])).rejects.toThrow(/cancelled/);
    expect(await userDataCounts()).toEqual(before);
  });
});

describe("Test 11 — grounded search, no fabrication", () => {
  it("answers from the stored log or says nothing is logged", async () => {
    const empty = await interpret(owner, "When did I last wax?", "text");
    expect(empty.kind).toBe("search");
    if (empty.kind === "search") { expect(empty.answer).toMatch(/couldn't find/); expect(empty.sources).toHaveLength(0); }

    const p = await capture("I waxed yesterday");
    await confirm(owner, p.id, p.version, [{ position: 0, mode: "apply" }]);
    const r = await interpret(owner, "When did I last wax?", "text");
    if (r.kind !== "search") throw new Error("expected search");
    expect(r.sources).toHaveLength(1);
    expect(r.answer).toMatch(/1 day ago/);
  });
  it("charity totals show the date range and exclude planned donations", async () => {
    const p = await capture("Donated 100 SAR via Ehsan today, and I plan to donate 40 SAR to Wafaa");
    await confirm(owner, p.id, p.version, p.operations.map((o) => ({ position: o.position, mode: "apply" })));
    const r = await runSearch(owner, { type: "charity_total", from: "2026-01-01", to: "2026-12-31" }, {});
    expect(r.answer).toContain("100 SAR");
    expect(r.answer).not.toContain("140");
    expect(r.calculation).toMatch(/planned donations excluded/);
  });
});

describe("Trust boundary", () => {
  it("non-AI ops (deletes) are rejected even if a provider proposes them", async () => {
    const mod = await import("@/server/ai/offline");
    const spy = vi.spyOn(mod.offlineProvider, "interpret").mockResolvedValueOnce({ intent: "capture", questions: [], operations: [{ op: "charity.delete", input: { id: "00000000-0000-0000-0000-000000000000" } }] });
    const p = await capture("delete everything");
    expect(p.operations[0].valid).toBe(false);
    await expect(confirm(owner, p.id, p.version, [{ position: 0, mode: "apply" }])).rejects.toThrow(/not allowed/);
    spy.mockRestore();
  });
  it("LLM-supplied raw IDs are not trusted across owners", async () => {
    const other = await makeOwner("x@example.com");
    const [r] = await getDb().insert(routines).values({ ownerId: other.id, name: "Theirs", intervalValue: 7, intervalUnit: "day" }).returning();
    const mod = await import("@/server/ai/offline");
    const spy = vi.spyOn(mod.offlineProvider, "interpret").mockResolvedValueOnce({ intent: "capture", questions: [], operations: [{ op: "routine.log", input: { routineId: r.id, type: "completed", onDate: "2026-11-01" } }] });
    const p = await capture("log their routine");
    await expect(confirm(owner, p.id, p.version, [{ position: 0, mode: "apply" }])).rejects.toThrow(/not found/);
    expect(await getDb().select().from(routines).where(eq(routines.ownerId, owner.id))).toHaveLength(2);
    spy.mockRestore();
  });
});
