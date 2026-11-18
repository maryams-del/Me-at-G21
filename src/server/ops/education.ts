import { z } from "zod";
import { and, asc, eq, isNull, max } from "drizzle-orm";
import { mastersApplications, applicationRequirements, applicationStatusEvents, documents, tasks, APPLICATION_STATUSES } from "@/db/schema";
import { defineOp, zDate, zId, zOptText, zText, zTime } from "./registry";
import { audit, UserError, type Ctx } from "../audit";
import { dmy, localToInstant, todayLocal } from "@/lib/time";
import { formatInstant } from "@/lib/time";
import { syncReminders, cancelReminders } from "../reminders";
import { toMinor } from "@/lib/money";

const OPEN = new Set(["researching", "preparing"]);
const validTz = (tz: string) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };
const zTz = z.string().max(64).refine(validTz, "Unknown timezone");

/** Deadline instant from the university's local date/time/timezone (time defaults to 23:59). */
export function deadlineInstant(date: string | null | undefined, time: string | null | undefined, tz: string | null | undefined, ownerTz: string): Date | null {
  if (!date) return null;
  return localToInstant(date, time || "23:59", tz || ownerTz);
}

export async function ownApplication(ctx: Pick<Ctx, "tx" | "ownerId">, id: string) {
  const [a] = await ctx.tx.select().from(mastersApplications).where(and(eq(mastersApplications.id, id), eq(mastersApplications.ownerId, ctx.ownerId), isNull(mastersApplications.deletedAt)));
  if (!a) throw new UserError("Application not found");
  return a;
}

/** Reminders N days before the deadline instant (same clock time as the deadline), only while not yet submitted. */
export async function syncApplication(ctx: Ctx, id: string) {
  const [a] = await ctx.tx.select().from(mastersApplications).where(eq(mastersApplications.id, id));
  if (!a || a.deletedAt || !a.deadlineAt || !a.remindersEnabled || !OPEN.has(a.status)) return cancelReminders(ctx.tx, ctx.ownerId, "application", id);
  const local = formatInstant(a.deadlineAt, ctx.tz, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  await syncReminders(ctx.tx, ctx.ownerId, "application", a.id, a.reminderOffsetsDays.map((off) => ({
    dedupeKey: `app:${a.id}:${a.deadlineAt!.toISOString()}:o${off}`,
    fireAt: new Date(a.deadlineAt!.getTime() + off * 86400_000),
    title: `${a.university}: deadline ${off === 0 ? "today" : off === -1 ? "tomorrow" : `in ${-off} days`}`,
    publicBody: `${a.program}. Due ${local} (your time)`,
    link: `/education/applications/${a.id}`,
  })), ctx.now);
}

async function checkDocs(ctx: Ctx, ids: string[]) {
  for (const d of ids) {
    const [doc] = await ctx.tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, d), eq(documents.ownerId, ctx.ownerId), isNull(documents.deletedAt)));
    if (!doc) throw new UserError("Linked document not found", "documentIds");
  }
}

const appInput = z.object({
  university: zText(160), program: zText(200), country: zOptText(80), intake: zOptText(60),
  url: z.string().trim().url().max(500).optional().nullable().or(z.literal("").transform(() => null)),
  deadlineDate: zDate.optional().nullable(), deadlineTime: zTime.optional().nullable(), deadlineTz: zTz.optional().nullable(),
  /** The owner confirms they checked the deadline on the official site (AI never sets this). */
  deadlineVerified: z.boolean().default(false),
  fee: z.string().regex(/^\d+(\.\d{1,3})?$/).optional().nullable(), feeCurrency: z.string().regex(/^[A-Z]{3}$/).optional().nullable(),
  funding: zOptText(500), contacts: zOptText(1000), notes: zOptText(4000),
  links: z.array(z.object({ label: z.string().trim().max(80), url: z.string().trim().url().max(500) })).max(20).default([]),
  documentIds: z.array(zId).max(30).default([]),
  reminderOffsetsDays: z.array(z.number().int().min(-120).max(0)).max(8).default([-30, -14, -7, -1]),
  remindersEnabled: z.boolean().default(true),
  requirements: z.array(zText(200)).max(40).default([]),
  linksText: z.string().max(5000).optional().nullable(),
});

/** "Label | https://…" or a bare URL per line. Invalid lines are rejected, not silently dropped. */
export function parseLinks(text: string | null | undefined): { label: string; url: string }[] {
  if (!text) return [];
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [a, b] = l.includes("|") ? l.split("|").map((x) => x.trim()) : ["", l];
    const url = b || a;
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw 0; return { label: (b ? a : "") || u.hostname, url: u.toString() }; }
    catch { throw new UserError(`Not a valid link: ${l}`, "linksText"); }
  });
}

const values = (ctx: Ctx, i: z.infer<typeof appInput>) => ({
  university: i.university, program: i.program, country: i.country, intake: i.intake, url: i.url ?? null,
  deadlineDate: i.deadlineDate ?? null, deadlineTime: i.deadlineTime ?? null, deadlineTz: i.deadlineTz ?? null,
  deadlineAt: deadlineInstant(i.deadlineDate, i.deadlineTime, i.deadlineTz, ctx.tz),
  deadlineVerified: ctx.source === "ai" ? false : i.deadlineVerified,
  feeMinor: i.fee ? toMinor(i.fee, i.feeCurrency ?? "SAR") : null, feeCurrency: i.fee ? i.feeCurrency ?? "SAR" : null,
  funding: i.funding, contacts: i.contacts, notes: i.notes, links: i.linksText !== undefined ? parseLinks(i.linksText) : i.links, documentIds: i.documentIds,
  reminderOffsetsDays: i.reminderOffsetsDays, remindersEnabled: i.remindersEnabled,
});

export const applicationCreate = defineOp({
  name: "application.create", module: "applications", label: "Add master's application", aiAllowed: true,
  schema: appInput.extend({ status: z.enum(APPLICATION_STATUSES).default("researching") }),
  draftable: ["deadlineDate"],
  summarize: (i) => `Add application: ${i.program} at ${i.university}${i.deadlineDate ? `, deadline ${dmy(i.deadlineDate)}${i.deadlineTime ? ` ${i.deadlineTime}` : ""}${i.deadlineTz ? ` (${i.deadlineTz})` : ""}` : ", no deadline yet"}`,
  async run(ctx, i) {
    await checkDocs(ctx, i.documentIds);
    const [a] = await ctx.tx.insert(mastersApplications).values({ ownerId: ctx.ownerId, ...values(ctx, i), status: i.status, source: ctx.source }).returning({ id: mastersApplications.id });
    if (i.requirements.length) await ctx.tx.insert(applicationRequirements).values(i.requirements.map((title, n) => ({ ownerId: ctx.ownerId, applicationId: a.id, title, position: n })));
    await ctx.tx.insert(applicationStatusEvents).values({ ownerId: ctx.ownerId, applicationId: a.id, fromStatus: null, toStatus: i.status, onDate: todayLocal(ctx.tz, ctx.now) });
    await syncApplication(ctx, a.id);
    await audit(ctx, "applications", "created", "application", a.id, `Added ${i.program} at ${i.university}`);
    return { id: a.id, message: `Added ${i.university}` };
  },
});

export const applicationUpdate = defineOp({
  name: "application.update", module: "applications", label: "Edit application", aiAllowed: false,
  schema: appInput.omit({ requirements: true }).extend({ id: zId }),
  summarize: (i) => `Update ${i.university}`,
  async run(ctx, i) {
    const cur = await ownApplication(ctx, i.id);
    await checkDocs(ctx, i.documentIds);
    const v = values(ctx, { ...i, requirements: [] });
    const changed = cur.deadlineDate !== (i.deadlineDate ?? null) || cur.deadlineTime !== (i.deadlineTime ?? null) || cur.deadlineTz !== (i.deadlineTz ?? null);
    await ctx.tx.update(mastersApplications).set({ ...v, updatedAt: ctx.now }).where(eq(mastersApplications.id, i.id));
    await syncApplication(ctx, i.id);
    await audit(ctx, "applications", "edited", "application", i.id, `Edited ${i.university}${changed ? ` (deadline now ${i.deadlineDate ? dmy(i.deadlineDate) : "unset"})` : ""}`);
    return { id: i.id, message: "Saved" };
  },
});

export const applicationStatus = defineOp({
  name: "application.status", module: "applications", label: "Change application status", aiAllowed: true,
  schema: z.object({ id: zId, status: z.enum(APPLICATION_STATUSES), onDate: zDate, note: zOptText(500) }),
  summarize: (i) => `Mark application ${i.status} on ${dmy(i.onDate)}`,
  async run(ctx, i) {
    const a = await ownApplication(ctx, i.id);
    if (i.onDate > todayLocal(ctx.tz, ctx.now)) throw new UserError("Date can't be in the future", "onDate");
    if (a.status === i.status) throw new UserError(`Already ${i.status}`);
    await ctx.tx.insert(applicationStatusEvents).values({ ownerId: ctx.ownerId, applicationId: a.id, fromStatus: a.status, toStatus: i.status, onDate: i.onDate, note: i.note });
    const submittedOn = i.status === "submitted" ? i.onDate : a.submittedOn;
    await ctx.tx.update(mastersApplications).set({ status: i.status, submittedOn, updatedAt: ctx.now }).where(eq(mastersApplications.id, a.id));
    await syncApplication(ctx, a.id);
    await audit(ctx, "applications", i.status, "application", a.id, `${a.university}: ${a.status} → ${i.status} on ${dmy(i.onDate)}`);
    return { id: a.id, message: `${a.university}: ${i.status}` };
  },
});

export const applicationDelete = defineOp({
  name: "application.delete", module: "applications", label: "Delete application", aiAllowed: true,
  schema: z.object({ id: zId }),
  summarize: () => "Delete application",
  async run(ctx, i) {
    const a = await ownApplication(ctx, i.id);
    await ctx.tx.update(mastersApplications).set({ deletedAt: ctx.now }).where(eq(mastersApplications.id, a.id));
    await cancelReminders(ctx.tx, ctx.ownerId, "application", a.id);
    await audit(ctx, "applications", "deleted", "application", a.id, `Deleted ${a.program} at ${a.university}`);
    return { id: a.id, message: "Deleted" };
  },
});

export const applicationLinkDocument = defineOp({
  name: "application.document", module: "applications", label: "Link document", aiAllowed: false,
  schema: z.object({ id: zId, documentId: zId, linked: z.boolean() }),
  summarize: (i) => (i.linked ? "Link document" : "Unlink document"),
  async run(ctx, i) {
    const a = await ownApplication(ctx, i.id);
    if (i.linked) await checkDocs(ctx, [i.documentId]);
    const ids = new Set(a.documentIds);
    if (i.linked) ids.add(i.documentId); else ids.delete(i.documentId);
    await ctx.tx.update(mastersApplications).set({ documentIds: [...ids], updatedAt: ctx.now }).where(eq(mastersApplications.id, a.id));
    await audit(ctx, "applications", "edited", "application", a.id, `${a.university}: ${i.linked ? "linked" : "unlinked"} a document`);
    return { id: a.id, message: i.linked ? "Document linked" : "Document unlinked" };
  },
});

export const requirementAdd = defineOp({
  name: "requirement.add", module: "applications", label: "Add requirement", aiAllowed: true,
  schema: z.object({ applicationId: zId, title: zText(200) }),
  summarize: (i) => `Add requirement “${i.title}”`,
  async run(ctx, i) {
    const a = await ownApplication(ctx, i.applicationId);
    const [{ m }] = await ctx.tx.select({ m: max(applicationRequirements.position) }).from(applicationRequirements).where(eq(applicationRequirements.applicationId, a.id));
    const [r] = await ctx.tx.insert(applicationRequirements).values({ ownerId: ctx.ownerId, applicationId: a.id, title: i.title, position: (m ?? -1) + 1 }).returning({ id: applicationRequirements.id });
    await audit(ctx, "applications", "edited", "application_requirement", r.id, `${a.university}: added requirement “${i.title}”`);
    return { id: r.id, message: "Requirement added" };
  },
});

export const requirementToggle = defineOp({
  name: "requirement.toggle", module: "applications", label: "Tick requirement", aiAllowed: false,
  schema: z.object({ id: zId, done: z.boolean() }),
  summarize: (i) => (i.done ? "Mark requirement done" : "Mark requirement not done"),
  async run(ctx, i) {
    const res = await ctx.tx.update(applicationRequirements).set({ doneAt: i.done ? ctx.now : null })
      .where(and(eq(applicationRequirements.id, i.id), eq(applicationRequirements.ownerId, ctx.ownerId))).returning({ title: applicationRequirements.title });
    if (!res.length) throw new UserError("Requirement not found");
    await audit(ctx, "applications", i.done ? "completed" : "reopened", "application_requirement", i.id, `${i.done ? "Done" : "Reopened"}: ${res[0].title}`);
    return { id: i.id, message: i.done ? "Done" : "Reopened" };
  },
});

export const requirementDelete = defineOp({
  name: "requirement.delete", module: "applications", label: "Remove requirement", aiAllowed: false,
  schema: z.object({ id: zId }),
  summarize: () => "Remove requirement",
  async run(ctx, i) {
    const res = await ctx.tx.delete(applicationRequirements).where(and(eq(applicationRequirements.id, i.id), eq(applicationRequirements.ownerId, ctx.ownerId))).returning({ title: applicationRequirements.title });
    if (!res.length) throw new UserError("Requirement not found");
    await audit(ctx, "applications", "edited", "application_requirement", i.id, `Removed requirement “${res[0].title}”`);
    return { id: i.id, message: "Removed" };
  },
});

/** Follow-up tasks for an application reuse the task module; this verifies the link. */
export async function applicationTasks(ctx: Pick<Ctx, "tx" | "ownerId">, applicationId: string) {
  return ctx.tx.select().from(tasks).where(and(eq(tasks.ownerId, ctx.ownerId), eq(tasks.applicationId, applicationId), isNull(tasks.deletedAt))).orderBy(asc(tasks.dueOn));
}
