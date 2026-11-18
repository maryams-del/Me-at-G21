import { z } from "zod";
import { and, eq, gte, isNotNull, lt } from "drizzle-orm";
import * as t from "@/db/schema";
import { getDb } from "@/db";
import { defineOp, zId } from "./registry";
import { audit, UserError, type Ctx } from "../audit";
import { syncExpiry } from "./admin";
import { syncDebtReminders } from "./finance";
import { syncTaskReminders } from "./planning";
import { syncApplication } from "./education";
import { syncSubscription } from "./subscriptions";
import { formatMoney } from "@/lib/money";
import { removeStored } from "../storage";

/*
 * Recently deleted. Deleting anything keeps it for RETENTION_DAYS so it can be undone, then the
 * hourly housekeeping removes it for good (uploaded file contents included).
 * Exceptions: a document's full ID number is erased immediately on delete; routines and their
 * history are deleted immediately (with a confirmation).
 */
export const RETENTION_DAYS = 30;

type Any = Record<string, unknown> & { id: string; deletedAt: Date | null };
type Kind = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any; label: string; name: (r: Any) => string; href: string; resync?: (ctx: Ctx, id: string) => Promise<void>;
};

export const TRASH: Record<string, Kind> = {
  charity: { table: t.charityPayments, label: "Charity", name: (r) => `${formatMoney(r.amountMinor as number, r.currency as string)} to ${r.recipient}`, href: "/finance/charity" },
  debt: { table: t.debts, label: "Lent & borrowed", name: (r) => `${r.counterparty}`, href: "/finance/debts", resync: syncDebtReminders },
  task: { table: t.tasks, label: "Task", name: (r) => String(r.title), href: "/projects", resync: syncTaskReminders },
  person: { table: t.people, label: "Family member", name: (r) => String(r.name), href: "/admin" },
  expiry: { table: t.expiryItems, label: "Expiry", name: (r) => String(r.label), href: "/admin/expiries", resync: syncExpiry },
  document: { table: t.documents, label: "Document", name: (r) => String(r.title), href: "/admin/documents" },
  file: { table: t.documentFiles, label: "Document file", name: (r) => String(r.filename), href: "/admin/documents" },
  application: { table: t.mastersApplications, label: "Application", name: (r) => `${r.university}: ${r.program}`, href: "/education/applications", resync: syncApplication },
  period: { table: t.periodCycles, label: "Period log", name: () => "Period entry", href: "/care/period" },
  achievement: { table: t.achievements, label: "Achievement", name: (r) => String(r.title), href: "/education/achievements" },
  hobby: { table: t.hobbies, label: "Hobby", name: (r) => String(r.name), href: "/education/achievements" },
  subscription: { table: t.subscriptions, label: "Subscription", name: (r) => String(r.name), href: "/finance/subscriptions", resync: syncSubscription },
  zakatEstimate: { table: t.zakatCalculations, label: "Zakat estimate", name: (r) => `Estimate as of ${r.evaluationDate}`, href: "/finance/zakat" },
  zakatPayment: { table: t.zakatPayments, label: "Zakat payment", name: (r) => `${formatMoney(r.amountMinor as number, r.currency as string)} to ${r.recipient}`, href: "/finance/zakat" },
};

export async function listTrash(ownerId: string, now = new Date()) {
  const since = new Date(now.getTime() - RETENTION_DAYS * 86400_000);
  const out: { kind: string; id: string; label: string; name: string; href: string; deletedAt: Date; purgeOn: Date }[] = [];
  for (const [kind, k] of Object.entries(TRASH)) {
    const rows = (await getDb().select().from(k.table).where(and(eq(k.table.ownerId, ownerId), isNotNull(k.table.deletedAt), gte(k.table.deletedAt, since)))) as Any[];
    for (const r of rows) out.push({ kind, id: r.id, label: k.label, name: k.name(r), href: k.href, deletedAt: r.deletedAt!, purgeOn: new Date(r.deletedAt!.getTime() + RETENTION_DAYS * 86400_000) });
  }
  return out.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
}

export const trashRestore = defineOp({
  name: "trash.restore", module: "settings", label: "Undo delete", aiAllowed: false,
  schema: z.object({ kind: z.enum(Object.keys(TRASH) as [string, ...string[]]), id: zId }),
  summarize: () => "Restore a deleted item",
  async run(ctx, i) {
    const k = TRASH[i.kind];
    const since = new Date(ctx.now.getTime() - RETENTION_DAYS * 86400_000);
    const [r] = (await ctx.tx.select().from(k.table).where(and(eq(k.table.id, i.id), eq(k.table.ownerId, ctx.ownerId), isNotNull(k.table.deletedAt), gte(k.table.deletedAt, since)))) as Any[];
    if (!r) throw new UserError("That item is no longer in Recently deleted");
    if (i.kind === "file") {
      const [d] = await ctx.tx.select({ deletedAt: t.documents.deletedAt }).from(t.documents).where(eq(t.documents.id, r.documentId as string));
      if (d?.deletedAt) throw new UserError("Restore its document first");
    }
    await ctx.tx.update(k.table).set({ deletedAt: null }).where(eq(k.table.id, i.id));
    // a document comes back with the files that were deleted together with it
    if (i.kind === "document") await ctx.tx.update(t.documentFiles).set({ deletedAt: null }).where(and(eq(t.documentFiles.documentId, i.id), eq(t.documentFiles.deletedAt, r.deletedAt!)));
    if (k.resync) await k.resync(ctx, i.id);
    await audit(ctx, "settings", "restored", i.kind, i.id, i.kind === "period" ? "Restored a deleted private entry" : `Restored ${k.label.toLowerCase()} “${k.name(r)}”`, i.kind === "period");
    return { id: i.id, message: `${k.label} restored` };
  },
});

/** Permanently remove anything deleted more than RETENTION_DAYS ago (files first, so their storage is freed). */
export async function purgeDeleted(now = new Date()) {
  const db = getDb();
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86400_000);
  let purged = 0;
  const files = await db.select().from(t.documentFiles).where(and(isNotNull(t.documentFiles.deletedAt), lt(t.documentFiles.deletedAt, cutoff)));
  for (const f of files) { await removeStored(f.storageKey); await db.delete(t.documentFiles).where(eq(t.documentFiles.id, f.id)); purged++; }
  // files of documents deleted long ago (their own deletedAt may be older than the document's)
  const docs = await db.select({ id: t.documents.id }).from(t.documents).where(and(isNotNull(t.documents.deletedAt), lt(t.documents.deletedAt, cutoff)));
  for (const d of docs) {
    const fs = await db.select().from(t.documentFiles).where(eq(t.documentFiles.documentId, d.id));
    for (const f of fs) { await removeStored(f.storageKey); await db.delete(t.documentFiles).where(eq(t.documentFiles.id, f.id)); }
  }
  for (const [kind, k] of Object.entries(TRASH)) {
    if (kind === "file") continue;
    try {
      const res = await db.delete(k.table).where(and(isNotNull(k.table.deletedAt), lt(k.table.deletedAt, cutoff))).returning({ id: k.table.id });
      for (const r of res as { id: string }[]) await db.delete(t.reminders).where(eq(t.reminders.sourceId, r.id));
      purged += res.length;
    } catch (e) {
      console.error(`[purge] ${kind}:`, (e as Error).message); // e.g. still referenced; retried next hour
    }
  }
  return purged;
}
