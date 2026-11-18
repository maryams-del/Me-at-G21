import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { achievements, hobbies, projects, mastersApplications, documents, ACHIEVEMENT_KINDS, ACHIEVEMENT_AREAS } from "@/db/schema";
import { defineOp, zDate, zId, zOptText, zText } from "./registry";
import { audit, UserError, type Ctx } from "../audit";
import { parseLinks } from "./education";
import { dmy } from "@/lib/time";

const zTags = z.array(z.string().trim().min(1).max(40)).max(30).default([]);
/** "a, b; c" or newline separated → clean unique list. */
export const splitTags = (s: string | null | undefined) => [...new Set((s ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 30);

const achievementInput = z.object({
  title: zText(200),
  kind: z.enum(ACHIEVEMENT_KINDS).default("accomplishment"),
  area: z.enum(ACHIEVEMENT_AREAS).default("work"),
  organisation: zOptText(160),
  startDate: zDate.optional().nullable(),
  endDate: zDate.optional().nullable(),
  description: zOptText(4000),
  outcome: zOptText(1000),
  summary: zOptText(400),
  skills: zTags, tags: zTags,
  skillsText: z.string().max(2000).optional().nullable(),
  tagsText: z.string().max(2000).optional().nullable(),
  linksText: z.string().max(5000).optional().nullable(),
  documentIds: z.array(zId).max(30).default([]),
  projectId: zId.optional().nullable(),
  applicationId: zId.optional().nullable(),
  featured: z.boolean().default(false),
});
type AchievementInput = z.infer<typeof achievementInput>;

async function checkLinks(ctx: Ctx, i: AchievementInput) {
  if (i.startDate && i.endDate && i.endDate < i.startDate) throw new UserError("End date can't be before the start date", "endDate");
  if (i.projectId) {
    const [p] = await ctx.tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, i.projectId), eq(projects.ownerId, ctx.ownerId), isNull(projects.deletedAt)));
    if (!p) throw new UserError("Linked project not found", "projectId");
  }
  if (i.applicationId) {
    const [a] = await ctx.tx.select({ id: mastersApplications.id }).from(mastersApplications).where(and(eq(mastersApplications.id, i.applicationId), eq(mastersApplications.ownerId, ctx.ownerId), isNull(mastersApplications.deletedAt)));
    if (!a) throw new UserError("Linked application not found", "applicationId");
  }
  for (const d of i.documentIds) {
    const [doc] = await ctx.tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, d), eq(documents.ownerId, ctx.ownerId), isNull(documents.deletedAt)));
    if (!doc) throw new UserError("Linked document not found", "documentIds");
  }
}

const achievementValues = (i: AchievementInput) => ({
  title: i.title, kind: i.kind, area: i.area, organisation: i.organisation ?? null,
  startDate: i.startDate ?? null, endDate: i.endDate ?? null,
  description: i.description ?? null, outcome: i.outcome ?? null, summary: i.summary ?? null,
  skills: i.skillsText != null ? splitTags(i.skillsText) : i.skills,
  tags: i.tagsText != null ? splitTags(i.tagsText) : i.tags,
  ...(i.linksText !== undefined ? { links: parseLinks(i.linksText) } : {}),
  documentIds: i.documentIds, projectId: i.projectId ?? null, applicationId: i.applicationId ?? null, featured: i.featured,
});

export const achievementCreate = defineOp({
  name: "achievement.create", module: "achievements", label: "Add achievement", aiAllowed: true,
  schema: achievementInput,
  summarize: (i) => `Add ${i.kind}: “${i.title}”${i.endDate ? ` (${dmy(i.endDate)})` : ""}${i.outcome ? `. Outcome: ${i.outcome}` : ""}`,
  async run(ctx, i) {
    await checkLinks(ctx, i);
    // AI may only carry over what the owner said; it never marks a record as portfolio-featured.
    const v = achievementValues(i);
    const [a] = await ctx.tx.insert(achievements).values({ ownerId: ctx.ownerId, ...v, featured: ctx.source === "ai" ? false : v.featured, source: ctx.source }).returning({ id: achievements.id });
    await audit(ctx, "achievements", "created", "achievement", a.id, `Added “${i.title}”`);
    return { id: a.id, message: `Added “${i.title}”` };
  },
});

export const achievementUpdate = defineOp({
  name: "achievement.update", module: "achievements", label: "Edit achievement", aiAllowed: false,
  schema: achievementInput.extend({ id: zId }),
  summarize: (i) => `Update “${i.title}”`,
  async run(ctx, i) {
    await checkLinks(ctx, i);
    const res = await ctx.tx.update(achievements).set({ ...achievementValues(i), updatedAt: ctx.now })
      .where(and(eq(achievements.id, i.id), eq(achievements.ownerId, ctx.ownerId), isNull(achievements.deletedAt))).returning({ id: achievements.id });
    if (!res.length) throw new UserError("Achievement not found");
    await audit(ctx, "achievements", "edited", "achievement", i.id, `Edited “${i.title}”`);
    return { id: i.id, message: "Saved" };
  },
});

export const achievementDelete = defineOp({
  name: "achievement.delete", module: "achievements", label: "Delete achievement", aiAllowed: true,
  schema: z.object({ id: zId }),
  summarize: () => "Delete achievement",
  async run(ctx, i) {
    const res = await ctx.tx.update(achievements).set({ deletedAt: ctx.now })
      .where(and(eq(achievements.id, i.id), eq(achievements.ownerId, ctx.ownerId), isNull(achievements.deletedAt))).returning({ title: achievements.title });
    if (!res.length) throw new UserError("Achievement not found");
    await audit(ctx, "achievements", "deleted", "achievement", i.id, `Deleted “${res[0].title}”`);
    return { id: i.id, message: "Deleted" };
  },
});

const hobbyInput = z.object({
  name: zText(120), level: zOptText(60), since: zDate.optional().nullable(), active: z.boolean().default(true),
  notes: zOptText(2000), tags: zTags, tagsText: z.string().max(1000).optional().nullable(), linksText: z.string().max(3000).optional().nullable(),
});
const hobbyValues = (i: z.infer<typeof hobbyInput>) => ({
  name: i.name, level: i.level ?? null, since: i.since ?? null, active: i.active, notes: i.notes ?? null,
  tags: i.tagsText != null ? splitTags(i.tagsText) : i.tags,
  ...(i.linksText !== undefined ? { links: parseLinks(i.linksText) } : {}),
});

export const hobbyCreate = defineOp({
  name: "hobby.create", module: "achievements", label: "Add hobby", aiAllowed: true,
  schema: hobbyInput,
  summarize: (i) => `Add hobby “${i.name}”${i.since ? ` since ${dmy(i.since)}` : ""}`,
  async run(ctx, i) {
    const [h] = await ctx.tx.insert(hobbies).values({ ownerId: ctx.ownerId, ...hobbyValues(i), source: ctx.source }).returning({ id: hobbies.id });
    await audit(ctx, "achievements", "created", "hobby", h.id, `Added hobby “${i.name}”`);
    return { id: h.id, message: `Added “${i.name}”` };
  },
});

export const hobbyUpdate = defineOp({
  name: "hobby.update", module: "achievements", label: "Edit hobby", aiAllowed: false,
  schema: hobbyInput.extend({ id: zId }),
  summarize: (i) => `Update hobby “${i.name}”`,
  async run(ctx, i) {
    const res = await ctx.tx.update(hobbies).set({ ...hobbyValues(i), updatedAt: ctx.now })
      .where(and(eq(hobbies.id, i.id), eq(hobbies.ownerId, ctx.ownerId), isNull(hobbies.deletedAt))).returning({ id: hobbies.id });
    if (!res.length) throw new UserError("Hobby not found");
    await audit(ctx, "achievements", "edited", "hobby", i.id, `Edited hobby “${i.name}”`);
    return { id: i.id, message: "Saved" };
  },
});

export const hobbyDelete = defineOp({
  name: "hobby.delete", module: "achievements", label: "Delete hobby", aiAllowed: true,
  schema: z.object({ id: zId }),
  summarize: () => "Delete hobby",
  async run(ctx, i) {
    const res = await ctx.tx.update(hobbies).set({ deletedAt: ctx.now })
      .where(and(eq(hobbies.id, i.id), eq(hobbies.ownerId, ctx.ownerId), isNull(hobbies.deletedAt))).returning({ name: hobbies.name });
    if (!res.length) throw new UserError("Hobby not found");
    await audit(ctx, "achievements", "deleted", "hobby", i.id, `Deleted hobby “${res[0].name}”`);
    return { id: i.id, message: "Deleted" };
  },
});

/* ── CV / portfolio bullets: deterministic, built only from stored fields (nothing invented) ── */

const monthYear = (d: string | null) => {
  if (!d) return null;
  const [y, m] = d.split("-");
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y}`;
};
export function datesLabel(a: { startDate: string | null; endDate: string | null }) {
  const s = monthYear(a.startDate), e = monthYear(a.endDate);
  if (s && e) return s === e ? s : `${s} – ${e}`;
  if (s) return `${s} – present`;
  return e;
}
export function cvBullet(a: { title: string; organisation: string | null; summary: string | null; outcome: string | null; startDate: string | null; endDate: string | null; skills: string[] }) {
  const body = a.summary?.trim() || [a.title + (a.organisation ? `, ${a.organisation}` : ""), a.outcome?.trim()].filter(Boolean).join(": ");
  const tail = [datesLabel(a), a.skills.length ? a.skills.slice(0, 5).join(", ") : null].filter(Boolean).join(". ");
  return `• ${body.replace(/[.\s]+$/, "")}${tail ? ` (${tail})` : ""}`;
}
