import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { customSpaces, customSpaceItems, users } from "@/db/schema";
import { defineOp, zId, zOptText, zText } from "./registry";
import { audit, UserError, type Ctx } from "../audit";
import { MAX_PINS, NEW_SECTION, SPACE_GLYPHS } from "@/lib/spaces";

/* ───────────── Custom spaces: owner-made sections holding a simple list ───────────── */

const spaceInput = z.object({
  name: zText(80), description: zOptText(300),
  section: zText(60), newSection: zOptText(60),
  glyph: z.enum(SPACE_GLYPHS.map((g) => g.value) as [string, ...string[]]).default("projects"),
});
const sectionOf = (i: z.infer<typeof spaceInput>) => {
  if (i.section !== NEW_SECTION) return i.section;
  if (!i.newSection) throw new UserError("Name the new section", "newSection");
  return i.newSection;
};

async function ownSpace(ctx: Ctx, id: string) {
  const [s] = await ctx.tx.select().from(customSpaces).where(and(eq(customSpaces.id, id), eq(customSpaces.ownerId, ctx.ownerId), isNull(customSpaces.deletedAt)));
  if (!s) throw new UserError("Space not found");
  return s;
}

export const spaceCreate = defineOp({
  name: "space.create", module: "spaces", label: "Add space", aiAllowed: false,
  schema: spaceInput,
  summarize: (i) => `Add space “${i.name}”`,
  async run(ctx, i) {
    const section = sectionOf(i);
    const [s] = await ctx.tx.insert(customSpaces).values({ ownerId: ctx.ownerId, name: i.name, description: i.description, section, glyph: i.glyph }).returning({ id: customSpaces.id });
    await audit(ctx, "spaces", "created", "space", s.id, `Added space “${i.name}” under ${section}`);
    return { id: s.id, message: `Space “${i.name}” added under ${section}` };
  },
});

export const spaceUpdate = defineOp({
  name: "space.update", module: "spaces", label: "Edit space", aiAllowed: false,
  schema: spaceInput.extend({ id: zId }),
  summarize: (i) => `Update space “${i.name}”`,
  async run(ctx, i) {
    await ownSpace(ctx, i.id);
    const section = sectionOf(i);
    await ctx.tx.update(customSpaces).set({ name: i.name, description: i.description, section, glyph: i.glyph, updatedAt: ctx.now }).where(eq(customSpaces.id, i.id));
    await audit(ctx, "spaces", "edited", "space", i.id, `Edited space “${i.name}”`);
    return { id: i.id, message: "Space saved" };
  },
});

export const spaceDelete = defineOp({
  name: "space.delete", module: "spaces", label: "Delete space", aiAllowed: false,
  schema: z.object({ id: zId }),
  summarize: () => "Delete space",
  async run(ctx, i) {
    const s = await ownSpace(ctx, i.id);
    await ctx.tx.update(customSpaces).set({ deletedAt: ctx.now }).where(eq(customSpaces.id, i.id));
    await audit(ctx, "spaces", "deleted", "space", i.id, `Deleted space “${s.name}”`);
    return { id: i.id, message: "Space deleted. You can undo this from Settings › Data for 30 days." };
  },
});

export const spaceItemAdd = defineOp({
  name: "spaceItem.add", module: "spaces", label: "Add to space", aiAllowed: true,
  schema: z.object({ spaceId: zId, text: zText(500) }),
  summarize: (i) => `Add “${i.text}”`,
  async run(ctx, i) {
    const s = await ownSpace(ctx, i.spaceId);
    const [it] = await ctx.tx.insert(customSpaceItems).values({ ownerId: ctx.ownerId, spaceId: s.id, text: i.text }).returning({ id: customSpaceItems.id });
    await audit(ctx, "spaces", "created", "space_item", it.id, `Added “${i.text}” to ${s.name}`);
    return { id: it.id, message: "Added" };
  },
});

async function ownItem(ctx: Ctx, id: string) {
  const [r] = await ctx.tx.select({ it: customSpaceItems, s: customSpaces }).from(customSpaceItems)
    .innerJoin(customSpaces, eq(customSpaces.id, customSpaceItems.spaceId))
    .where(and(eq(customSpaceItems.id, id), eq(customSpaceItems.ownerId, ctx.ownerId), isNull(customSpaces.deletedAt)));
  if (!r) throw new UserError("Item not found");
  return r;
}

export const spaceItemToggle = defineOp({
  name: "spaceItem.toggle", module: "spaces", label: "Tick item", aiAllowed: true,
  schema: z.object({ id: zId, done: z.boolean() }),
  summarize: (i) => (i.done ? "Tick item" : "Untick item"),
  async run(ctx, i) {
    const { it, s } = await ownItem(ctx, i.id);
    await ctx.tx.update(customSpaceItems).set({ done: i.done, doneAt: i.done ? ctx.now : null, updatedAt: ctx.now }).where(eq(customSpaceItems.id, i.id));
    await audit(ctx, "spaces", i.done ? "completed" : "reopened", "space_item", i.id, `${i.done ? "Ticked" : "Unticked"} “${it.text}” in ${s.name}`);
    return { id: i.id, message: i.done ? "Done" : "Reopened" };
  },
});

export const spaceItemDelete = defineOp({
  name: "spaceItem.delete", module: "spaces", label: "Remove item", aiAllowed: true,
  schema: z.object({ id: zId }),
  summarize: () => "Remove item",
  async run(ctx, i) {
    const { it, s } = await ownItem(ctx, i.id);
    await ctx.tx.delete(customSpaceItems).where(eq(customSpaceItems.id, i.id));
    await audit(ctx, "spaces", "deleted", "space_item", i.id, `Removed “${it.text}” from ${s.name}`);
    return { id: i.id, message: "Removed" };
  },
});

/** The owner's order for the Spaces page: sections top to bottom, and cards within each section. */
export const spacesOrder = defineOp({
  name: "spaces.order", module: "spaces", label: "Reorder spaces", aiAllowed: false,
  schema: z.object({
    sections: z.array(z.string().trim().min(1).max(60)).max(60),
    cards: z.record(z.string().max(60), z.array(z.string().max(200)).max(100)),
  }),
  summarize: () => "Reorder spaces",
  async run(ctx, i) {
    const [u] = await ctx.tx.select({ settings: users.settings }).from(users).where(eq(users.id, ctx.ownerId));
    await ctx.tx.update(users).set({ settings: { ...(u?.settings ?? {}), spacesOrder: i }, updatedAt: ctx.now }).where(eq(users.id, ctx.ownerId));
    await audit(ctx, "spaces", "edited", "settings", ctx.ownerId, "Reordered spaces");
    return { id: null, message: "Order saved" };
  },
});

/** The owner's pinned spaces (up to three, left to right), shown at the top of the Spaces page. */
export const spacesPins = defineOp({
  name: "spaces.pins", module: "spaces", label: "Pin spaces", aiAllowed: false,
  schema: z.object({ hrefs: z.array(z.string().trim().min(1).max(200)).max(MAX_PINS) }),
  summarize: () => "Pin spaces",
  async run(ctx, i) {
    const hrefs = [...new Set(i.hrefs)].slice(0, MAX_PINS);
    const [u] = await ctx.tx.select({ settings: users.settings }).from(users).where(eq(users.id, ctx.ownerId));
    await ctx.tx.update(users).set({ settings: { ...(u?.settings ?? {}), spacesPins: hrefs }, updatedAt: ctx.now }).where(eq(users.id, ctx.ownerId));
    await audit(ctx, "spaces", "edited", "settings", ctx.ownerId, "Changed pinned spaces");
    return { id: null, message: "Pins saved" };
  },
});
