import { z } from "zod";
import { and, eq, isNull, max } from "drizzle-orm";
import { expiryItems, renewalEvents, documents, protectedIdFields, documentFiles } from "@/db/schema";
import { defineOp, zDate, zId, zOptText, zText, zTime } from "./registry";
import { audit, UserError, type Ctx } from "../audit";
import { addDays, localToInstant, todayLocal } from "@/lib/time";
import { syncReminders, cancelReminders } from "../reminders";
import { encryptField } from "@/lib/crypto";
import { removeStored } from "../storage";

export const EXPIRY_KINDS = ["passport", "national_id", "license", "bank_card", "membership", "custom"] as const;
export const DOC_KINDS = ["passport", "national_id", "transcript", "certificate", "cv", "application", "letter", "other"] as const;

/** Lock-screen safety: never show long digit runs (ID / card numbers) in notification text. */
export const redactDigits = (s: string) => s.replace(/\d[\d\s-]{4,}\d/g, "•••");

/* ───────────── Expiries & renewals ───────────── */

async function syncExpiry(ctx: Ctx, itemId: string) {
  const [it] = await ctx.tx.select().from(expiryItems).where(eq(expiryItems.id, itemId));
  if (!it || it.deletedAt || it.status !== "active" || !it.remindersEnabled) return cancelReminders(ctx.tx, ctx.ownerId, "expiry", itemId);
  const label = redactDigits(it.label);
  await syncReminders(ctx.tx, ctx.ownerId, "expiry", it.id, it.reminderOffsetsDays.map((off) => ({
    dedupeKey: `expiry:${it.id}:${it.expiresOn}:o${off}`,
    fireAt: localToInstant(addDays(it.expiresOn, off), it.reminderTime, ctx.tz),
    title: off === 0 ? `${label} expires today` : `${label} expires in ${-off} day${off === -1 ? "" : "s"}`,
    publicBody: "Open the app to plan the renewal",
    link: "/admin/expiries",
  })), ctx.now);
}

const expiryInput = z.object({
  label: zText(120), kind: z.enum(EXPIRY_KINDS).default("custom"), expiresOn: zDate,
  issuer: zOptText(200), documentId: zId.optional().nullable(),
  reminderOffsetsDays: z.array(z.number().int().min(-365).max(0)).max(8).default([-90, -30, -7]),
  reminderTime: zTime.default("09:00"), remindersEnabled: z.boolean().default(true), notes: zOptText(),
});

export const expiryCreate = defineOp({
  name: "expiry.create", module: "expiries", label: "Track an expiry", aiAllowed: true,
  schema: expiryInput, draftable: ["expiresOn"],
  summarize: (i) => `Track “${i.label}” expiring ${i.expiresOn}; reminders ${i.reminderOffsetsDays.map((o) => (o === 0 ? "on the day" : `${-o} days before`)).join(", ")}`,
  async run(ctx, i) {
    if (i.documentId) await ownDocument(ctx, i.documentId);
    const [it] = await ctx.tx.insert(expiryItems).values({ ownerId: ctx.ownerId, ...i, documentId: i.documentId ?? null, source: ctx.source }).returning({ id: expiryItems.id });
    await syncExpiry(ctx, it.id);
    await audit(ctx, "expiries", "created", "expiry_item", it.id, `Tracking “${redactDigits(i.label)}”, expires ${i.expiresOn}`);
    return { id: it.id, message: `Tracking ${i.label}` };
  },
});

export const expiryUpdate = defineOp({
  name: "expiry.update", module: "expiries", label: "Edit expiry", aiAllowed: false,
  schema: expiryInput.extend({ id: zId, status: z.enum(["active", "archived"]).default("active") }),
  summarize: (i) => `Update “${i.label}”`,
  async run(ctx, i) {
    const { id: itemId, ...rest } = i;
    const res = await ctx.tx.update(expiryItems).set({ ...rest, documentId: rest.documentId ?? null, updatedAt: ctx.now })
      .where(and(eq(expiryItems.id, itemId), eq(expiryItems.ownerId, ctx.ownerId), isNull(expiryItems.deletedAt))).returning({ id: expiryItems.id });
    if (!res.length) throw new UserError("Item not found");
    await syncExpiry(ctx, itemId);
    await audit(ctx, "expiries", i.status === "archived" ? "archived" : "edited", "expiry_item", itemId, `Edited “${redactDigits(i.label)}”`);
    return { id: itemId, message: "Saved" };
  },
});

export const expiryRenew = defineOp({
  name: "expiry.renew", module: "expiries", label: "Record renewal", aiAllowed: true,
  schema: z.object({ itemId: zId, renewedOn: zDate, newExpiresOn: zDate, notes: zOptText() }),
  summarize: (i) => `Renewed on ${i.renewedOn}; new expiry ${i.newExpiresOn}`,
  async run(ctx, i) {
    const [it] = await ctx.tx.select().from(expiryItems).where(and(eq(expiryItems.id, i.itemId), eq(expiryItems.ownerId, ctx.ownerId), isNull(expiryItems.deletedAt)));
    if (!it) throw new UserError("Item not found");
    if (i.newExpiresOn <= it.expiresOn) throw new UserError("The new expiry date must be later than the current one", "newExpiresOn");
    if (i.renewedOn > todayLocal(ctx.tz, ctx.now)) throw new UserError("Renewal date can't be in the future", "renewedOn");
    await ctx.tx.insert(renewalEvents).values({ ownerId: ctx.ownerId, itemId: it.id, renewedOn: i.renewedOn, previousExpiresOn: it.expiresOn, newExpiresOn: i.newExpiresOn, notes: i.notes });
    await ctx.tx.update(expiryItems).set({ expiresOn: i.newExpiresOn, status: "active", updatedAt: ctx.now }).where(eq(expiryItems.id, it.id));
    await syncExpiry(ctx, it.id);
    await audit(ctx, "expiries", "renewed", "expiry_item", it.id, `Renewed “${redactDigits(it.label)}” — new expiry ${i.newExpiresOn}`);
    return { id: it.id, message: `Renewed until ${i.newExpiresOn}` };
  },
});

export const expiryDelete = defineOp({
  name: "expiry.delete", module: "expiries", label: "Delete expiry", aiAllowed: false,
  schema: z.object({ id: zId }),
  summarize: () => "Delete item",
  async run(ctx, i) {
    const res = await ctx.tx.update(expiryItems).set({ deletedAt: ctx.now }).where(and(eq(expiryItems.id, i.id), eq(expiryItems.ownerId, ctx.ownerId), isNull(expiryItems.deletedAt))).returning({ label: expiryItems.label });
    if (!res.length) throw new UserError("Item not found");
    await cancelReminders(ctx.tx, ctx.ownerId, "expiry", i.id);
    await audit(ctx, "expiries", "deleted", "expiry_item", i.id, `Stopped tracking “${redactDigits(res[0].label)}”`);
    return { id: i.id, message: "Deleted" };
  },
});

/* ───────────── Documents & protected ID numbers ───────────── */

export async function ownDocument(ctx: Pick<Ctx, "tx" | "ownerId">, documentId: string) {
  const [d] = await ctx.tx.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.ownerId, ctx.ownerId), isNull(documents.deletedAt)));
  if (!d) throw new UserError("Document not found");
  return d;
}

const maskId = (v: string) => {
  const clean = v.replace(/\s/g, "");
  return clean.length <= 4 ? "••••" : `••••${clean.slice(-4)}`;
};

async function setProtectedId(ctx: Ctx, documentId: string, idNumber: string | null | undefined) {
  if (idNumber === undefined) return; // untouched
  if (idNumber === null || idNumber === "") {
    await ctx.tx.delete(protectedIdFields).where(eq(protectedIdFields.documentId, documentId));
    await ctx.tx.update(documents).set({ idMasked: null }).where(eq(documents.id, documentId));
    return;
  }
  const enc = encryptField(idNumber.trim(), process.env.DATA_ENCRYPTION_KEY!, `docid:${ctx.ownerId}:${documentId}`);
  await ctx.tx.insert(protectedIdFields).values({ documentId, ownerId: ctx.ownerId, valueEnc: enc })
    .onConflictDoUpdate({ target: protectedIdFields.documentId, set: { valueEnc: enc, updatedAt: ctx.now } });
  await ctx.tx.update(documents).set({ idMasked: maskId(idNumber) }).where(eq(documents.id, documentId));
}

const docInput = z.object({
  title: zText(160), kind: z.enum(DOC_KINDS).default("other"), issuer: zOptText(200),
  issuedOn: zDate.optional().nullable(), expiresOn: zDate.optional().nullable(),
  /** Full ID number: encrypted server-side, never logged, never sent to AI. Omit to keep, "" to clear. */
  idNumber: z.string().trim().max(64).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  notes: zOptText(), trackExpiry: z.boolean().default(false),
});

export const documentCreate = defineOp({
  name: "document.create", module: "documents", label: "Add document", aiAllowed: false,
  schema: docInput,
  summarize: (i) => `Add document “${i.title}”`,
  async run(ctx, i) {
    const [d] = await ctx.tx.insert(documents).values({
      ownerId: ctx.ownerId, title: i.title, kind: i.kind, issuer: i.issuer, issuedOn: i.issuedOn ?? null, expiresOn: i.expiresOn ?? null, tags: i.tags, notes: i.notes,
    }).returning({ id: documents.id });
    await setProtectedId(ctx, d.id, i.idNumber || undefined);
    if (i.trackExpiry && i.expiresOn) {
      const kind = (EXPIRY_KINDS as readonly string[]).includes(i.kind) ? (i.kind as (typeof EXPIRY_KINDS)[number]) : "custom";
      const [it] = await ctx.tx.insert(expiryItems).values({ ownerId: ctx.ownerId, label: i.title, kind, expiresOn: i.expiresOn, issuer: i.issuer, documentId: d.id }).returning({ id: expiryItems.id });
      await syncExpiry(ctx, it.id);
    }
    await audit(ctx, "documents", "created", "document", d.id, `Added document “${i.title}”`);
    return { id: d.id, message: `Document “${i.title}” added` };
  },
});

export const documentUpdate = defineOp({
  name: "document.update", module: "documents", label: "Edit document", aiAllowed: false,
  schema: docInput.omit({ trackExpiry: true }).extend({ id: zId, clearId: z.boolean().default(false) }),
  summarize: (i) => `Update “${i.title}”`,
  async run(ctx, i) {
    await ownDocument(ctx, i.id);
    await ctx.tx.update(documents).set({ title: i.title, kind: i.kind, issuer: i.issuer, issuedOn: i.issuedOn ?? null, expiresOn: i.expiresOn ?? null, tags: i.tags, notes: i.notes, updatedAt: ctx.now }).where(eq(documents.id, i.id));
    await setProtectedId(ctx, i.id, i.clearId ? null : i.idNumber || undefined);
    await audit(ctx, "documents", "edited", "document", i.id, `Edited document “${i.title}”${i.idNumber || i.clearId ? " (ID number changed)" : ""}`);
    return { id: i.id, message: "Saved" };
  },
});

export const documentDelete = defineOp({
  name: "document.delete", module: "documents", label: "Delete document", aiAllowed: false,
  schema: z.object({ id: zId }),
  summarize: () => "Delete document and its files",
  async run(ctx, i) {
    const d = await ownDocument(ctx, i.id);
    const files = await ctx.tx.select().from(documentFiles).where(and(eq(documentFiles.documentId, d.id), isNull(documentFiles.deletedAt)));
    await ctx.tx.update(documentFiles).set({ deletedAt: ctx.now }).where(eq(documentFiles.documentId, d.id));
    await ctx.tx.delete(protectedIdFields).where(eq(protectedIdFields.documentId, d.id));
    await ctx.tx.update(documents).set({ deletedAt: ctx.now, idMasked: null }).where(eq(documents.id, d.id));
    for (const f of files) await removeStored(f.storageKey);
    await audit(ctx, "documents", "deleted", "document", d.id, `Deleted document “${d.title}” and ${files.length} file${files.length === 1 ? "" : "s"}`);
    return { id: d.id, message: "Document deleted" };
  },
});

export const documentFileDelete = defineOp({
  name: "document.file.delete", module: "documents", label: "Delete file", aiAllowed: false,
  schema: z.object({ fileId: zId }),
  summarize: () => "Delete file version",
  async run(ctx, i) {
    const [f] = await ctx.tx.select().from(documentFiles).where(and(eq(documentFiles.id, i.fileId), eq(documentFiles.ownerId, ctx.ownerId), isNull(documentFiles.deletedAt)));
    if (!f) throw new UserError("File not found");
    await ctx.tx.update(documentFiles).set({ deletedAt: ctx.now }).where(eq(documentFiles.id, f.id));
    await removeStored(f.storageKey);
    await audit(ctx, "documents", "file_deleted", "document_file", f.id, `Deleted file ${f.filename} (v${f.version})`);
    return { id: f.id, message: "File deleted" };
  },
});

export async function nextFileVersion(ctx: Pick<Ctx, "tx">, documentId: string) {
  const [{ v }] = await ctx.tx.select({ v: max(documentFiles.version) }).from(documentFiles).where(eq(documentFiles.documentId, documentId));
  return (v ?? 0) + 1;
}
