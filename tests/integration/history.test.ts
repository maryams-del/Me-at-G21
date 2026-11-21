import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "@/db";
import { auditEvents, charityPayments } from "@/db/schema";
import { runOpInTx } from "@/server/ops";
import { resetDb, makeOwner, withCtx } from "../support/db";
import { localToInstant } from "@/lib/time";

let owner: Awaited<ReturnType<typeof makeOwner>>;
let other: Awaited<ReturnType<typeof makeOwner>>;
const now = localToInstant("2026-11-21", "12:00");
const op = (ownerId: string, name: string, input: unknown) =>
  withCtx(ownerId, now, (ctx) => runOpInTx(ctx.tx, { ownerId: ctx.ownerId, tz: ctx.tz, source: "manual", now }, name, input));
const lines = (ownerId: string) => getDb().select().from(auditEvents).where(eq(auditEvents.ownerId, ownerId));

beforeEach(async () => { await resetDb(); owner = await makeOwner(); other = await makeOwner("other@example.com"); });
afterAll(async () => { await closeDb(); });

describe("Clear history", () => {
  it("removes only this owner's activity lines and keeps the entries themselves", async () => {
    await getDb().insert(auditEvents).values([
      { ownerId: owner.id, category: "charity", action: "created", entityType: "charity_payment", summary: "Gave 50" },
      { ownerId: owner.id, category: "routines", action: "completed", entityType: "routine", summary: "Done" },
      { ownerId: other.id, category: "charity", action: "created", entityType: "charity_payment", summary: "Someone else's" },
    ]);
    const before = await getDb().select().from(charityPayments).where(eq(charityPayments.ownerId, owner.id));
    expect((await lines(owner.id)).length).toBeGreaterThanOrEqual(2);

    await op(owner.id, "history.clear", {});

    expect(await lines(owner.id)).toHaveLength(0);
    expect(await lines(other.id)).toHaveLength(1);
    expect(await getDb().select().from(charityPayments).where(eq(charityPayments.ownerId, owner.id))).toHaveLength(before.length);
  });
});
