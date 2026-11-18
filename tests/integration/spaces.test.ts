import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { closeDb } from "@/db";
import { runOpInTx } from "@/server/ops";
import { customSpacesState, customSpaceDetail } from "@/server/queries";
import { listTrash } from "@/server/ops/trash";
import { resetDb, makeOwner, withCtx } from "../support/db";

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

    await op("space.update", { id: a.id, name: "Gifts", section: "You", glyph: "charity" });
    expect((await customSpacesState(owner)).find((x) => x.space.id === a.id)!.space.section).toBe("You");
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
});
