import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { closeDb } from "@/db";
import { runOpInTx } from "@/server/ops";
import { customSpacesState, customSpaceDetail } from "@/server/queries";
import { listTrash } from "@/server/ops/trash";
import { resetDb, makeOwner, withCtx } from "../support/db";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { spacesOrderOf, spacesPinsOf, bySavedOrder } from "@/lib/spaces";

let owner: Awaited<ReturnType<typeof makeOwner>>;
const now = new Date("2026-11-19T09:00:00Z");
const op = (name: string, input: unknown, who = owner.id) =>
  withCtx(who, now, (ctx) => runOpInTx(ctx.tx, { ownerId: who, tz: ctx.tz, source: "manual", now }, name, input));

beforeEach(async () => { await resetDb(); owner = await makeOwner(); });
afterAll(async () => { await closeDb(); });

describe("Custom spaces", () => {
  it("adds a space under a built-in section or a new one, with a tickable list", async () => {
    const a = await op("space.create", { name: "Gift ideas", section: "Money", glyph: "charity" });
    const b = await op("space.create", { name: "Reading list", section: "__new", newSection: "Home", glyph: "documents", description: "Books" });
    await expect(op("space.create", { name: "Nope", section: "__new" })).rejects.toThrow(/Name the new section/);

    const i1 = await op("spaceItem.add", { spaceId: b.id, text: "Atomic Habits" });
    await op("spaceItem.add", { spaceId: b.id, text: "The Alchemist" });
    await op("spaceItem.toggle", { id: i1.id, done: true });

    const all = await customSpacesState(owner);
    expect(all.map((x) => [x.space.name, x.space.section, x.open, x.done])).toEqual([["Gift ideas", "Money", 0, 0], ["Reading list", "Home", 1, 1]]);
    const d = await customSpaceDetail(owner, b.id!);
    expect(d!.items.map((x) => [x.text, x.done])).toEqual([["The Alchemist", false], ["Atomic Habits", true]]);

    await op("space.update", { id: a.id, name: "Gifts", section: "Faith", glyph: "charity" });
    expect((await customSpacesState(owner)).find((x) => x.space.id === a.id)!.space.section).toBe("Faith");
  });

  it("delete goes to Recently deleted and can be undone; other owners can't touch it", async () => {
    const s = await op("space.create", { name: "Trips", section: "__new", newSection: "Travel", glyph: "home" });
    const other = await makeOwner("other@example.com");
    await expect(op("spaceItem.add", { spaceId: s.id, text: "x" }, other.id)).rejects.toThrow(/not found/);
    await op("space.delete", { id: s.id });
    expect(await customSpacesState(owner)).toEqual([]);
    expect((await listTrash(owner.id, now)).map((x) => x.kind)).toContain("space");
    await op("trash.restore", { kind: "space", id: s.id });
    expect((await customSpacesState(owner)).map((x) => x.space.name)).toEqual(["Trips"]);
  });

  it("saves the owner's order of sections and cards", async () => {
    await op("spaces.order", { sections: ["Faith", "Money"], cards: { Money: ["/finance/zakat", "/finance/charity"] } });
    const [u] = await getDb().select().from(users).where(eq(users.id, owner.id));
    const order = spacesOrderOf(u.settings);
    expect(bySavedOrder(["Money", "Care", "Faith"], (x) => x, order.sections)).toEqual(["Faith", "Money", "Care"]);
    expect(bySavedOrder(["/finance/charity", "/finance/savings", "/finance/zakat"], (x) => x, order.cards.Money)).toEqual(["/finance/zakat", "/finance/charity", "/finance/savings"]);
  });

  it("keeps up to three pinned spaces alongside the saved order", async () => {
    const pinsNow = async () => spacesPinsOf((await getDb().select().from(users).where(eq(users.id, owner.id)))[0].settings);
    expect(await pinsNow()).toBeNull(); // never pinned: the page picks for them
    await op("spaces.order", { sections: ["Money"], cards: {} });
    await op("spaces.pins", { hrefs: ["/quran", "/finance/charity", "/quran"] });
    expect(await pinsNow()).toEqual(["/quran", "/finance/charity"]);
    await expect(op("spaces.pins", { hrefs: ["/a", "/b", "/c", "/d"] })).rejects.toThrow();
    await op("spaces.pins", { hrefs: [] });
    expect(await pinsNow()).toEqual([]);
    const [u] = await getDb().select().from(users).where(eq(users.id, owner.id));
    expect(spacesOrderOf(u.settings).sections).toEqual(["Money"]); // pins don't wipe the order
  });
});
