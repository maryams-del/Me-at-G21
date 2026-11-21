import { z } from "zod";
import { and, eq, isNull, max } from "drizzle-orm";
import { isBuiltinDocKind, docTypesOf } from "@/lib/docTypes";
import { expiryItems, renewalEvents, documents, protectedIdFields, documentFiles, people, users } from "@/db/schema";
import { defineOp, zDate, zId, zOptText, zText, zTime } from "./registry";
import { audit, UserError, type Ctx } from "../audit";
import { addDays, localToInstant, todayLocal, dmy } from "@/lib/time";
import { syncReminders, cancelReminders } from "../reminders";
import { encryptField } from "@/lib/crypto";

export const EXPIRY_KINDS = ["passport", "national_id", "license", "bank_card", "membership", "custom"] as const;
export const DOC_KINDS = ["passport", "national_id", "transcript", "certificate", "cv", "application", "letter", "other"] as const;

/** Lock-screen safety: never show long digit runs (ID / card numbers) in notification text. */
export const redactDigits = (s: string) => s.replace(/\d[\d\s-]{4,}\d/g, "•••");

/* ───────────── Family members ───────────── */

export const RELATIONS = ["spouse", "child", "parent", "sibling", "other"] as const;

/** The title for an entry picked by person ("Whose is it?"): that person's name, or yours. */
async function labelFor(ctx: Pick<Ctx, "tx" | "ownerId">, label: string | undefined, personId: string | null | undefined) {
  if (label) return label;
  const p = await ownPerson(ctx, personId);
  if (p) return p.name;
  const [u] = await ctx.tx.select({ name: users.displayName }).from(users).where(eq(users.id, ctx.ownerId));
  return u?.name?.trim() || "Me";
}

/** A type you named yourself ("Car licence") is kept so you can pick it again next time. */
async function rememberDocType(ctx: Pick<Ctx, "tx" | "ownerId" | "now">, kind: string) {
  if (isBuiltinDocKind(kind)) return;
  const [u] = await ctx.tx.select({ settings: users.settings }).from(users).where(eq(users.id, ctx.ownerId));
  const settings = (u?.settings ?? {}) as Record<string, unknown>;
  const list = docTypesOf(settings);
  if (list.some((t) => t.toLowerCase() === kind.toLowerCase())) return;
  await ctx.tx.update(users).set({ settings: { ...settings, docTypes: [...list, kind] }, updatedAt: ctx.now }).where(eq(users.id, ctx.ownerId));
}

export async function ownPerson(ctx: Pick<Ctx, "tx" | "ownerId">, personId: string | null | undefined) {
  if (!personId) return null;
  const [p] = await ctx.tx.select().from(people).where(and(eq(people.id, personId), eq(people.ownerId, ctx.ownerId), isNull(people.deletedAt)));
  if (!p) throw new UserError("Person not found", "personId");
  return p;
}

/** "Ali's Passport" unless the label already names them. */
export function withOwnerName(label: string, personName: string | null | undefined) {
  if (!personName) return label;
  return label.toLowerCase().includes(personName.toLowerCase()) ? label : `${personName}'s ${label}`;
}

export const personCreate = defineOp({
  name: "person.create", module: "people", label: "Add family member", aiAllowed: false,
  schema: z.object({ name: zText(60), relation: z.enum(RELATIONS).default("other") }),
  summarize: (i) => `Add ${i.name} (${i.relation})`,
  async run(ctx, i) {
    const [p] = await ctx.tx.insert(people).values({ ownerId: ctx.ownerId, name: i.name, relation: i.relation }).returning({ id: people.id });
    await audit(ctx, "people", "created", "person", p.id, `Added ${i.name} (${i.relation})`);
    return { id: p.id, message: `${i.name} added` };
  },
});

export const personUpdate = defineOp({
  name: "person.update", module: "people", label: "Edit family member", aiAllowed: false,
  schema: z.object({ id: zId, name: zText(60), relation: z.enum(RELATIONS) }),
  summarize: (i) => `Update ${i.name}`,
  async run(ctx, i) {
    await ownPerson(ctx, i.id);
    await ctx.tx.update(people).set({ name: i.name, relation: i.relation, updatedAt: ctx.now }).where(eq(people.id, i.id));
    const items = await ctx.tx.select({ id: expiryItems.id }).from(expiryItems).where(and(eq(expiryItems.personId, i.id), isNull(expiryItems.deletedAt)));
    for (const it of items) await syncExpiry(ctx, it.id); // reminder wording uses the name
    await audit(ctx, "people", "edited", "person", i.id, `Renamed/edited ${i.name}`);
    return { id: i.id, message: "Saved" };
  },
});

export const personDelete = defineOp({
  name: "person.delete", module: "people", label: "Remove family member", aiAllowed: false,
  schema: z.object({ id: zId }),
  summarize: () => "Remove person (their documents stay, marked as yours)",
  async run(ctx, i) {
    const p = await ownPerson(ctx, i.id);
    await ctx.tx.update(people).set({ deletedAt: ctx.now }).where(eq(people.id, p!.id));
    await ctx.tx.update(documents).set({ personId: null }).where(eq(documents.personId, p!.id));
    const items = await ctx.tx.update(expiryItems).set({ personId: null }).where(eq(expiryItems.personId, p!.id)).returning({ id: expiryItems.id });
    for (const it of items) await syncExpiry(ctx, it.id);
    await audit(ctx, "people", "deleted", "person", p!.id, `Removed ${p!.name}`);
    return { id: p!.id, message: `${p!.name} removed` };
  },
});

/* ───────────── Expiries & renewals ───────────── */

export async function syncExpiry(ctx: Ctx, itemId: string) {
  const [it] = await ctx.tx.select().from(expiryItems).where(eq(expiryItems.id, itemId));
  if (!it || it.deletedAt || it.status !== "active" || !it.remindersEnabled) return cancelReminders(ctx.tx, ctx.ownerId, "expiry", itemId);
  const person = it.personId ? await ownPerson(ctx, it.personId).catch(() => null) : null;
  const label = redactDigits(withOwnerName(it.label, person?.name));
  await syncReminders(ctx.tx, ctx.ownerId, "expiry", it.id, it.reminderOffsetsDays.map((off) => ({
    dedupeKey: `expiry:${it.id}:${it.expiresOn}:o${off}`,
    fireAt: localToInstant(addDays(it.expiresOn, off), it.reminderTime, ctx.tz),
    title: off === 0 ? `${label} expires today` : `${label} expires in ${-off} day${off === -1 ? "" : "s"}`,
    publicBody: "Open the app to plan the renewal",
    link: "/admin/expiries",
  })), ctx.now);
}

const expiryInput = z.object({
  label: zText(120).optional(), personId: zId.optional().nullable(), kind: z.enum(EXPIRY_KINDS).default("custom"), expiresOn: zDate,
  issuer: zOptText(200), documentId: zId.optional().nullable(),
  reminderOffsetsDays: z.array(z.number().int().min(-365).max(0)).max(8).default([-90, -30, -7]),
  reminderTime: zTime.default("09:00"), remindersEnabled: z.boolean().default(true), notes: zOptText(),
});

export const expiryCreate = defineOp({
  name: "expiry.create", module: "expiries", label: "Track an expiry", aiAllowed: true,
  schema: expiryInput, draftable: ["expiresOn"],
  summarize: (i) => `Track “${i.label ?? "an item"}” expiring ${dmy(i.expiresOn)}; reminders ${i.reminderOffsetsDays.map((o) => (o === 0 ? "on the day" : `${-o} days before`)).join(", ")}`,
  async run(ctx, i) {
    if (i.documentId) await ownDocument(ctx, i.documentId);
    await ownPerson(ctx, i.personId);
    const label = await labelFor(ctx, i.label, i.personId);
    const [it] = await ctx.tx.insert(expiryItems).values({ ownerId: ctx.ownerId, ...i, label, personId: i.personId ?? null, documentId: i.documentId ?? null, source: ctx.source }).returning({ id: expiryItems.id });
    await syncExpiry(ctx, it.id);
    await audit(ctx, "expiries", "created", "expiry_item", it.id, `Tracking “${redactDigits(label)}”, expires ${dmy(i.expiresOn)}`);
    return { id: it.id, message: `Tracking ${label}` };
  },
});

export const expiryUpdate = defineOp({
  name: "expiry.update", module: "expiries", label: "Edit expiry", aiAllowed: false,
  schema: expiryInput.extend({ id: zId, status: z.enum(["active", "archived"]).default("active") }),
  summarize: (i) => `Update “${i.label ?? "item"}”`,
  async run(ctx, i) {
    const { id: itemId, ...rest } = i;
    await ownPerson(ctx, rest.personId);
    rest.label = await labelFor(ctx, rest.label, rest.personId);
    const res = await ctx.tx.update(expiryItems).set({ ...rest, personId: rest.personId ?? null, documentId: rest.documentId ?? null, updatedAt: ctx.now })
      .where(and(eq(expiryItems.id, itemId), eq(expiryItems.ownerId, ctx.ownerId), isNull(expiryItems.deletedAt))).returning({ id: expiryItems.id });
    if (!res.length) throw new UserError("Item not found");
    if (rest.documentId) await ctx.tx.update(documents).set({ expiresOn: rest.expiresOn, updatedAt: ctx.now }).where(and(eq(documents.id, rest.documentId), eq(documents.ownerId, ctx.ownerId)));
    await syncExpiry(ctx, itemId);
    await audit(ctx, "expiries", i.status === "archived" ? "archived" : "edited", "expiry_item", itemId, `Edited “${redactDigits(rest.label)}”`);
    return { id: itemId, message: "Saved" };
  },
});

export const expiryRenew = defineOp({
  name: "expiry.renew", module: "expiries", label: "Record renewal", aiAllowed: true,
  schema: z.object({ itemId: zId, renewedOn: zDate, newExpiresOn: zDate, notes: zOptText() }),
  summarize: (i) => `Renewed on ${dmy(i.renewedOn)}; new expiry ${dmy(i.newExpiresOn)}`,
  async run(ctx, i) {
    const [it] = await ctx.tx.select().from(expiryItems).where(and(eq(expiryItems.id, i.itemId), eq(expiryItems.ownerId, ctx.ownerId), isNull(expiryItems.deletedAt)));
    if (!it) throw new UserError("Item not found");
    if (i.newExpiresOn <= it.expiresOn) throw new UserError("The new expiry date must be later than the current one", "newExpiresOn");
    if (i.renewedOn > todayLocal(ctx.tz, ctx.now)) throw new UserError("Renewal date can't be in the future", "renewedOn");
    await ctx.tx.insert(renewalEvents).values({ ownerId: ctx.ownerId, itemId: it.id, renewedOn: i.renewedOn, previousExpiresOn: it.expiresOn, newExpiresOn: i.newExpiresOn, notes: i.notes });
    await ctx.tx.update(expiryItems).set({ expiresOn: i.newExpiresOn, status: "active", updatedAt: ctx.now }).where(eq(expiryItems.id, it.id));
    if (it.documentId) await ctx.tx.update(documents).set({ expiresOn: i.newExpiresOn, updatedAt: ctx.now }).where(and(eq(documents.id, it.documentId), eq(documents.ownerId, ctx.ownerId)));
    await syncExpiry(ctx, it.id);
    await audit(ctx, "expiries", "renewed", "expiry_item", it.id, `Renewed “${redactDigits(it.label)}” — new expiry ${dmy(i.newExpiresOn)}`);
    return { id: it.id, message: `Renewed until ${dmy(i.newExpiresOn)}` };
  },
});

export const expiryDelete = defineOp({
  name: "expiry.delete", module: "expiries", label: "Delete expiry", aiAllowed: true,
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
  title: zText(160), personId: zId.optional().nullable(), kind: z.union([z.enum(DOC_KINDS), z.string().trim().min(1).max(60)]).default("other"), issuer: zOptText(200),
  issuedOn: zDate.optional().nullable(), expiresOn: zDate.optional().nullable(),
  /** Full ID number: encrypted server-side, never logged, never sent to AI. Omit to keep, "" to clear. */
  idNumber: z.string().trim().max(64).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  notes: zOptText(), trackExpiry: z.boolean().default(false),
  reminderOffsetsDays: z.array(z.number().int().min(-365).max(0)).max(8).optional(),
  reminderTime: zTime.optional(),
});

export const documentCreate = defineOp({
  name: "document.create", module: "documents", label: "Add document", aiAllowed: false,
  schema: docInput,
  summarize: (i) => `Add document “${i.title}”`,
  async run(ctx, i) {
    await ownPerson(ctx, i.personId);
    const [d] = await ctx.tx.insert(documents).values({
      ownerId: ctx.ownerId, title: i.title, personId: i.personId ?? null, kind: i.kind, issuer: i.issuer, issuedOn: i.issuedOn ?? null, expiresOn: i.expiresOn ?? null, tags: i.tags, notes: i.notes,
    }).returning({ id: documents.id });
    await setProtectedId(ctx, d.id, i.idNumber || undefined);
    await rememberDocType(ctx, i.kind);
    if (i.trackExpiry && i.expiresOn) {
      const kind = (EXPIRY_KINDS as readonly string[]).includes(i.kind) ? (i.kind as (typeof EXPIRY_KINDS)[number]) : "custom";
      const [it] = await ctx.tx.insert(expiryItems).values({ ownerId: ctx.ownerId, label: i.title, personId: i.personId ?? null, kind, expiresOn: i.expiresOn, issuer: i.issuer, documentId: d.id,
        ...(i.reminderOffsetsDays?.length ? { reminderOffsetsDays: i.reminderOffsetsDays } : {}), ...(i.reminderTime ? { reminderTime: i.reminderTime } : {}) }).returning({ id: expiryItems.id });
      await syncExpiry(ctx, it.id);
    }
    await audit(ctx, "documents", "created", "document", d.id, `Added document “${i.title}”`);
    return { id: d.id, message: `Document “${i.title}” added` };
  },
});

export const documentUpdate = defineOp({
  name: "document.update", module: "documents", label: "Edit document", aiAllowed: false,
  schema: docInput.omit({ trackExpiry: true, reminderOffsetsDays: true, reminderTime: true }).extend({ id: zId, clearId: z.boolean().default(false) }),
  summarize: (i) => `Update “${i.title}”`,
  async run(ctx, i) {
    await ownDocument(ctx, i.id);
    await ownPerson(ctx, i.personId);
    await ctx.tx.update(documents).set({ title: i.title, personId: i.personId ?? null, kind: i.kind, issuer: i.issuer, issuedOn: i.issuedOn ?? null, expiresOn: i.expiresOn ?? null, tags: i.tags, notes: i.notes, updatedAt: ctx.now }).where(eq(documents.id, i.id));
    await setProtectedId(ctx, i.id, i.clearId ? null : i.idNumber || undefined);
    await rememberDocType(ctx, i.kind);
    // Keep the linked Expiries entry in step (name and date).
    const linked = await ctx.tx.select({ id: expiryItems.id }).from(expiryItems).where(and(eq(expiryItems.documentId, i.id), eq(expiryItems.ownerId, ctx.ownerId), isNull(expiryItems.deletedAt)));
    for (const it of linked) {
      await ctx.tx.update(expiryItems).set({ label: i.title, ...(i.expiresOn ? { expiresOn: i.expiresOn } : {}), updatedAt: ctx.now }).where(eq(expiryItems.id, it.id));
      await syncExpiry(ctx, it.id);
    }
    await audit(ctx, "documents", "edited", "document", i.id, `Edited document “${i.title}”${i.idNumber || i.clearId ? " (ID number changed)" : ""}`);
    return { id: i.id, message: "Saved" };
  },
});

export const documentDelete = defineOp({
  name: "document.delete", module: "documents", label: "Delete document", aiAllowed: false,
  schema: z.object({ id: zId }),
  summarize: () => "Delete document and its files (recoverable for 30 days; the full ID number is erased now)",
  async run(ctx, i) {
    const d = await ownDocument(ctx, i.id);
    const files = await ctx.tx.select().from(documentFiles).where(and(eq(documentFiles.documentId, d.id), isNull(documentFiles.deletedAt)));
    await ctx.tx.update(documentFiles).set({ deletedAt: ctx.now }).where(and(eq(documentFiles.documentId, d.id), isNull(documentFiles.deletedAt)));
    await ctx.tx.delete(protectedIdFields).where(eq(protectedIdFields.documentId, d.id));
    await ctx.tx.update(documents).set({ deletedAt: ctx.now, idMasked: null }).where(eq(documents.id, d.id));
    void files; // file contents are kept for 30 days (undo from Recently deleted), then purged
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
    await ctx.tx.update(documentFiles).set({ deletedAt: ctx.now }).where(eq(documentFiles.id, f.id)); // contents purged after 30 days
    await audit(ctx, "documents", "file_deleted", "document_file", f.id, `Deleted file ${f.filename} (v${f.version})`);
    return { id: f.id, message: "File deleted" };
  },
});

export async function nextFileVersion(ctx: Pick<Ctx, "tx">, documentId: string) {
  const [{ v }] = await ctx.tx.select({ v: max(documentFiles.version) }).from(documentFiles).where(eq(documentFiles.documentId, documentId));
  return (v ?? 0) + 1;
}

/** Reminders for a document's expiry, from the Documents page. Same entry as on Expiries, so both stay in sync. */
export const documentReminders = defineOp({
  name: "document.reminders", module: "documents", label: "Document reminders", aiAllowed: false,
  schema: z.object({
    documentId: zId, remindersEnabled: z.boolean().default(false),
    reminderOffsetsDays: z.array(z.number().int().min(-365).max(0)).max(8).default([-90, -30, -7]),
    reminderTime: zTime.default("09:00"),
  }),
  summarize: (i) => (i.remindersEnabled ? "Turn on expiry reminders" : "Turn off expiry reminders"),
  async run(ctx, i) {
    const d = await ownDocument(ctx, i.documentId);
    const offs = i.reminderOffsetsDays.length ? i.reminderOffsetsDays : [-90, -30, -7];
    const [it] = await ctx.tx.select().from(expiryItems).where(and(eq(expiryItems.documentId, d.id), eq(expiryItems.ownerId, ctx.ownerId), isNull(expiryItems.deletedAt))).limit(1);
    let id = it?.id;
    if (it) {
      await ctx.tx.update(expiryItems).set({ remindersEnabled: i.remindersEnabled, reminderOffsetsDays: offs, reminderTime: i.reminderTime, updatedAt: ctx.now }).where(eq(expiryItems.id, it.id));
    } else if (i.remindersEnabled) {
      if (!d.expiresOn) throw new UserError("Add an expiry date first, then turn reminders on", "remindersEnabled");
      const kind = (EXPIRY_KINDS as readonly string[]).includes(d.kind) ? (d.kind as (typeof EXPIRY_KINDS)[number]) : "custom";
      [{ id }] = await ctx.tx.insert(expiryItems).values({ ownerId: ctx.ownerId, label: d.title, personId: d.personId, kind, expiresOn: d.expiresOn, documentId: d.id,
        reminderOffsetsDays: offs, reminderTime: i.reminderTime, remindersEnabled: true }).returning({ id: expiryItems.id });
    }
    if (id) await syncExpiry(ctx, id);
    await audit(ctx, "documents", "edited", "document", d.id, `Reminders ${i.remindersEnabled ? "on" : "off"} for “${d.title}”`);
    return { id: d.id, message: i.remindersEnabled ? "Reminders on" : "Reminders off" };
  },
});
