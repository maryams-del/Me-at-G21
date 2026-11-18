import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, closeDb } from "@/db";
import * as t from "@/db/schema";
import { interpret, choose, confirm } from "@/server/ai/service";
import { runOpInTx } from "@/server/ops";
import { resetDb, makeOwner, withCtx, userDataCounts } from "../support/db";

let owner: { id: string; timezone: string; defaultCurrency: string };
const op = (name: string, input: unknown) => withCtx(owner.id, new Date(), (ctx) => runOpInTx(ctx.tx, { ownerId: owner.id, tz: ctx.tz, source: "manual", now: ctx.now }, name, input));

beforeEach(async () => {
  await resetDb();
  const u = await makeOwner();
  owner = { id: u.id, timezone: "Asia/Riyadh", defaultCurrency: "SAR" };
  const ali = await op("person.create", { name: "Ali", relation: "child" });
  await op("expiry.create", { label: "Passport", kind: "passport", expiresOn: "2030-05-01" });
  await op("expiry.create", { label: "Passport", kind: "passport", personId: ali.id, expiresOn: "2029-01-01" });
});
afterAll(async () => { await closeDb(); });

describe("Ask AI (offline parser through the real service)", () => {
  it("“delete the expiry reminder” asks whose, then deletes only after Confirm", async () => {
    const before = await userDataCounts();
    const r = await interpret(owner, "delete the expiry reminder", "voice");
    if (r.kind !== "proposal") throw new Error("expected proposal");
    const o = r.proposal.operations[0];
    expect(o.op).toBe("expiry.delete");
    expect(o.valid).toBe(false);
    expect(o.choices[0].question).toBe("Delete the passport expiry for whom?");
    expect(o.choices[0].options.map((x) => x.label).sort()).toEqual(["Ali's Passport", "Yours: Passport"]);
    expect(await userDataCounts()).toEqual(before); // nothing changed yet

    const ali = o.choices[0].options.find((x) => x.label === "Ali's Passport")!;
    const p2 = await choose(owner, r.proposal.id, o.position, "id", ali.value);
    expect(p2.version).toBe(2);
    expect(p2.operations[0].valid).toBe(true);
    expect(p2.operations[0].summary).toMatch(/Delete/i);

    await confirm(owner, r.proposal.id, 2, [{ position: 0, mode: "apply" }]);
    const left = await getDb().select().from(t.expiryItems).where(and(eq(t.expiryItems.ownerId, owner.id), isNull(t.expiryItems.deletedAt)));
    expect(left.map((x) => x.personId)).toEqual([null]); // only Ali's was deleted (recoverable for 30 days)
  });

  it("choices can't be used to point at something outside the proposal", async () => {
    const r = await interpret(owner, "delete the expiry reminder", "text");
    if (r.kind !== "proposal") throw new Error("expected proposal");
    await expect(choose(owner, r.proposal.id, 0, "id", "@z99")).rejects.toThrow(/isn't available/);
    await expect(choose(owner, r.proposal.id, 0, "id", "11111111-1111-4111-8111-111111111111")).rejects.toThrow(/isn't available/);
  });

  it("“open the passport” → asks whose and gives links; “save a backup” → asks which kind; nothing is written", async () => {
    const [ali] = await getDb().select().from(t.people).where(eq(t.people.ownerId, owner.id));
    await op("document.create", { title: "Passport", kind: "passport" });
    await op("document.create", { title: "Passport", kind: "passport", personId: ali.id });
    const before = await userDataCounts();
    const n = await interpret(owner, "open the passport", "voice");
    expect(n.kind).toBe("navigate");
    if (n.kind !== "navigate") return;
    expect(n.question).toBe("Whose passport?");
    expect(n.suggestions.map((s) => s.href)).toEqual(["/admin/documents?kind=passport&person=me", `/admin/documents?kind=passport&person=${ali.id}`, "/admin/documents?kind=passport"]);
    const c = await interpret(owner, "save a backup of example example", "voice");
    expect(c.kind).toBe("command");
    if (c.kind === "command") expect(c.options.map((o) => o.label)).toEqual(["Make a full backup", "Download a quick backup"]);
    expect(await getDb().select().from(t.aiProposals)).toHaveLength(0);
    expect(await userDataCounts()).toEqual(before);
  });

  it("period navigation stays local", async () => {
    const r = await interpret(owner, "open my period log", "text");
    expect(r).toEqual({ kind: "navigate", suggestions: [{ label: "Go to Period log", href: "/care/period" }] });
  });
});
