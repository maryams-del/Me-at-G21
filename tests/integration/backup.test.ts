import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, closeDb } from "@/db";
import * as t from "@/db/schema";
import { runOpInTx } from "@/server/ops";
import { buildPayload, sealBackup, openBackup, restoreBackup, createStoredBackup, readStoredBackup, ownerTables, summarize, BackupError } from "@/server/backup";
import { listTrash, purgeDeleted } from "@/server/ops/trash";
import { periodState } from "@/server/queries";
import { CSV_MODULES, toCsv } from "@/server/csv";
import { resetDb, makeOwner, withCtx } from "../support/db";
import { localToInstant } from "@/lib/time";

const at = (d: string) => localToInstant(d, "12:00");
let owner: Awaited<ReturnType<typeof makeOwner>>;
const op = (now: Date, name: string, input: unknown, who = owner.id) =>
  withCtx(who, now, (ctx) => runOpInTx(ctx.tx, { ownerId: who, tz: ctx.tz, source: "manual", now }, name, input));
const count = async (table: typeof t.charityPayments | typeof t.subscriptions) => (await getDb().select().from(table).where(eq(table.ownerId, owner.id))).length;

beforeEach(async () => { await resetDb(); owner = await makeOwner(); });
afterAll(async () => { await closeDb(); });

async function seed() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  await op(now, "charity.create", { paidOn: today, recipient: "Ehsan", amount: "150.50", currency: "SAR" });
  await op(now, "period.add", { startDate: "2026-10-01", endDate: "2026-10-05", notes: "private-note", symptoms: ["Cramps"] });
  await op(now, "subscription.create", { name: "Music", amount: "21.99", nextBillingDate: "2027-01-05" });
  await op(now, "routine.template", { template: "bedsheets" });
}

describe("Backups", () => {
  it("covers every owner table except sign-in secrets and device registrations", async () => {
    const tables = await ownerTables(getDb());
    for (const x of ["charity_payments", "period_cycles", "subscriptions", "routines", "routine_events", "documents", "protected_id_fields", "reminders", "audit_events", "zakat_payments"]) expect(tables).toContain(x);
    for (const x of ["passkey_credentials", "totp_authenticators", "auth_sessions", "account_recovery_code_verifiers", "push_subscriptions", "backups"]) expect(tables).not.toContain(x);
    expect(tables.indexOf("routines")).toBeLessThan(tables.indexOf("routine_events")); // parents first
  });

  it("round-trips: change things, restore, and everything is back exactly (encrypted fields still decrypt)", async () => {
    await seed();
    const before = await buildPayload(owner.id);
    const file = sealBackup(before);
    expect(file.toString("latin1")).not.toContain("Ehsan"); // encrypted
    expect(summarize(openBackup(file, owner.id)).items).toEqual(expect.arrayContaining([{ label: "charity entries", count: 1 }, { label: "period entries", count: 1 }]));

    await op(new Date(), "charity.create", { paidOn: new Date().toISOString().slice(0, 10), recipient: "Extra", amount: "1" });
    const [sub] = await getDb().select().from(t.subscriptions).where(eq(t.subscriptions.ownerId, owner.id));
    await op(new Date(), "subscription.delete", { id: sub.id });

    const r = await restoreBackup(owner.id, openBackup(file, owner.id));
    const after = await buildPayload(owner.id);
    for (const k of ["charity_payments", "period_cycles", "subscriptions", "routines", "reminders"]) expect(after.tables[k]).toEqual(before.tables[k]);
    const p = await periodState(owner, { withDetails: true });
    expect(p.cycles[0].notes).toBe("private-note");
    const [safety] = await getDb().select().from(t.backups).where(eq(t.backups.id, r.safetyBackupId));
    expect(safety.kind).toBe("pre-restore");
    // the safety copy holds the pre-restore state (2 charity entries)
    expect(openBackup(await readStoredBackup(owner.id, safety.id), owner.id).counts.charity_payments).toBe(2);
  });

  it("refuses damaged files and other accounts' backups", async () => {
    await seed();
    const file = sealBackup(await buildPayload(owner.id));
    const bad = Buffer.from(file); bad[bad.length - 5] ^= 0xff;
    expect(() => openBackup(bad, owner.id)).toThrow(BackupError);
    const other = await makeOwner("other@example.com");
    expect(() => openBackup(file, other.id)).toThrow(/different account|can't be opened/);
    expect(() => openBackup(Buffer.from("hello world, not a backup at all......"), owner.id)).toThrow(/isn't a Me @ G21 backup/);
  });

  it("stored nightly backups keep only the last 14", async () => {
    for (let n = 0; n < 16; n++) await createStoredBackup(owner.id, "automatic");
    expect((await getDb().select().from(t.backups).where(and(eq(t.backups.ownerId, owner.id), eq(t.backups.kind, "automatic")))).length).toBe(14);
  });
});

describe("Recently deleted", () => {
  it("undo within 30 days brings reminders back; after 30 days it's purged", async () => {
    await seed();
    const [sub] = await getDb().select().from(t.subscriptions).where(eq(t.subscriptions.ownerId, owner.id));
    await op(new Date(), "subscription.delete", { id: sub.id });
    const trash = await listTrash(owner.id);
    expect(trash.map((x) => [x.kind, x.name])).toEqual([["subscription", "Music"]]);
    await op(new Date(), "trash.restore", { kind: "subscription", id: sub.id });
    const rem = await getDb().select().from(t.reminders).where(and(eq(t.reminders.sourceId, sub.id), eq(t.reminders.status, "scheduled")));
    expect(rem.length).toBeGreaterThan(0);

    await op(new Date(), "subscription.delete", { id: sub.id });
    expect(await purgeDeleted(new Date(Date.now() + 29 * 86400_000))).toBe(0);
    expect(await purgeDeleted(new Date(Date.now() + 31 * 86400_000))).toBe(1);
    expect(await count(t.subscriptions)).toBe(0);
    await expect(op(new Date(), "trash.restore", { kind: "subscription", id: sub.id })).rejects.toThrow(/no longer/);
  });

  it("can't undo another owner's deletes", async () => {
    const other = await makeOwner("other@example.com");
    const c = await op(new Date(), "charity.create", { paidOn: new Date().toISOString().slice(0, 10), recipient: "X", amount: "5" }, other.id);
    await op(new Date(), "charity.delete", { id: c.id }, other.id);
    await expect(op(new Date(), "trash.restore", { kind: "charity", id: c.id })).rejects.toThrow(/no longer/);
  });
});

describe("Spreadsheet export", () => {
  it("BOM, dd/mm/yyyy, plain amounts, and formula-injection guard", async () => {
    await op(at("2026-11-18"), "charity.create", { paidOn: "2026-11-18", recipient: "=HYPERLINK(\"x\")", amount: "1500.5", notes: "line1\nline2, \"quoted\"" });
    const mod = CSV_MODULES.find((m) => m.key === "charity")!;
    const { header, rows } = await mod.build(owner.id, "Asia/Riyadh");
    const csv = toCsv(header, rows);
    expect(csv.startsWith("﻿Date,Recipient")).toBe(true);
    expect(csv).toContain("18/11/2026,\"'=HYPERLINK(\"\"x\"\")\",,1500.50,SAR,completed,No,\"line1\nline2, \"\"quoted\"\"\"");
  });
  it("every section builds", async () => {
    await seed();
    for (const m of CSV_MODULES) { const r = await m.build(owner.id, "Asia/Riyadh"); expect(r.header.length).toBeGreaterThan(2); }
  });
});
