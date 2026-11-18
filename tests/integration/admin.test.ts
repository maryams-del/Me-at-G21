import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "@/db";
import { reminders, documents, protectedIdFields, captureDrafts, expiryItems } from "@/db/schema";
import { runOpInTx } from "@/server/ops";
import { uploadDocumentFile, readDocumentFile, revealProtectedId } from "@/server/documents";
import { interpret, confirm } from "@/server/ai/service";
import { resetDb, makeOwner, withCtx } from "../support/db";
import { localToInstant } from "@/lib/time";

let owner: Awaited<ReturnType<typeof makeOwner>>;
const at = (d: string) => localToInstant(d, "12:00");
const op = (now: Date, name: string, input: unknown, who = () => owner.id) =>
  withCtx(who(), now, (ctx) => runOpInTx(ctx.tx, { ownerId: ctx.ownerId, tz: ctx.tz, source: "manual", now }, name, input));
const PDF = Buffer.from("%PDF-1.7\nfake passport scan P1234567 for tests only\n%%EOF");

function allFiles(dir: string): string[] {
  try { return readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? allFiles(p) : [p]; }); } catch { return []; }
}

beforeEach(async () => { await resetDb(); owner = await makeOwner(); rmSync("/tmp/ld-test-blobs", { recursive: true, force: true }); });
afterAll(async () => { await closeDb(); });

describe("PRD 4.11 — expiries & renewals", () => {
  it("default reminders 90/30/7 days before, editable, renewal moves them", async () => {
    const r = await op(at("2026-11-18"), "expiry.create", { label: "Passport", kind: "passport", expiresOn: "2027-06-30" });
    let rem = await getDb().select().from(reminders).where(and(eq(reminders.sourceType, "expiry"), eq(reminders.status, "scheduled")));
    expect(rem.map((x) => x.fireAt.toISOString()).sort()).toEqual(["2027-04-01", "2027-05-31", "2027-06-23"].map((d) => localToInstant(d, "09:00").toISOString()));
    await expect(op(at("2026-11-18"), "expiry.renew", { itemId: r.id, renewedOn: "2026-11-18", newExpiresOn: "2027-01-01" })).rejects.toThrow(/later than/);
    await op(at("2026-11-18"), "expiry.renew", { itemId: r.id, renewedOn: "2026-11-18", newExpiresOn: "2036-11-17" });
    rem = await getDb().select().from(reminders).where(and(eq(reminders.sourceType, "expiry"), eq(reminders.status, "scheduled")));
    expect(rem).toHaveLength(3);
    expect(rem.every((x) => x.dedupeKey.includes("2036-11-17"))).toBe(true);
  });
  it("notification text never shows ID-like numbers", async () => {
    await op(at("2026-11-18"), "expiry.create", { label: "Visa card 4111 1111 1111 1234", kind: "bank_card", expiresOn: "2027-01-31" });
    const rem = await getDb().select().from(reminders).where(eq(reminders.sourceType, "expiry"));
    expect(rem.length).toBeGreaterThan(0);
    for (const x of rem) { expect(x.title).not.toMatch(/\d{4}/); expect(x.publicBody).not.toMatch(/\d{4}/); }
  });
});

describe("Test 10 — “Add passport expiry” with no date", () => {
  it("asks one question, offers a draft, and the confirmed draft lands in Needs Details", async () => {
    const res = await interpret({ id: owner.id, timezone: "Asia/Riyadh", defaultCurrency: "SAR" }, "Add passport expiry", "text");
    if (res.kind !== "proposal") throw new Error("expected proposal");
    const p = res.proposal;
    expect(p.operations).toHaveLength(1);
    expect(p.operations[0].op).toBe("expiry.create");
    expect(p.operations[0].valid).toBe(false);
    expect(p.operations[0].missing).toContain("expiresOn");
    expect(p.questions).toHaveLength(1);
    expect(p.questions[0]).toMatch(/When does your passport expire/);
    expect(await getDb().select().from(captureDrafts)).toHaveLength(0);
    await confirm({ id: owner.id, timezone: "Asia/Riyadh" }, p.id, p.version, [{ position: 0, mode: "draft" }]);
    const d = await getDb().select().from(captureDrafts);
    expect(d).toHaveLength(1);
    expect(d[0].missingFields).toContain("expiresOn");
    expect(await getDb().select().from(expiryItems)).toHaveLength(0);
  });
  it("with a date it is a complete proposal", async () => {
    const res = await interpret({ id: owner.id, timezone: "Asia/Riyadh", defaultCurrency: "SAR" }, "My passport expires on 3 March 2029", "text");
    if (res.kind !== "proposal") throw new Error("expected proposal");
    expect(res.proposal.operations[0]).toMatchObject({ op: "expiry.create", valid: true, input: { label: "Passport", kind: "passport", expiresOn: "2029-03-03" } });
  });
});

describe("PRD 4.12 / Test 23 — documents and protected IDs", () => {
  it("ID numbers are encrypted at rest, masked for display, revealed only to the owner", async () => {
    const d = await op(at("2026-11-18"), "document.create", { title: "Passport", kind: "passport", idNumber: "P1234567", expiresOn: "2030-01-01", trackExpiry: true });
    const [doc] = await getDb().select().from(documents).where(eq(documents.id, d.id!));
    expect(doc.idMasked).toBe("••••4567");
    const [p] = await getDb().select().from(protectedIdFields);
    expect(p.valueEnc).not.toContain("P1234567");
    expect(await revealProtectedId(owner.id, d.id!)).toBe("P1234567");
    const other = await makeOwner("other@example.com");
    await expect(revealProtectedId(other.id, d.id!)).rejects.toThrow(/not found/);
    expect(await getDb().select().from(expiryItems)).toHaveLength(1); // tracked expiry created
  });

  it("files are encrypted before storage, integrity-checked, and owner-only", async () => {
    const d = await op(at("2026-11-18"), "document.create", { title: "Passport scan", kind: "passport" });
    const f = await uploadDocumentFile(owner.id, d.id!, { name: "passport.pdf", bytes: PDF });
    const stored = allFiles("/tmp/ld-test-blobs");
    expect(stored).toHaveLength(1);
    expect(readFileSync(stored[0]).includes(Buffer.from("P1234567"))).toBe(false); // ciphertext only
    const back = await readDocumentFile(owner.id, f.id);
    expect(back.bytes.equals(PDF)).toBe(true);
    expect(back.file.contentType).toBe("application/pdf");
    const other = await makeOwner("other@example.com");
    await expect(readDocumentFile(other.id, f.id)).rejects.toThrow(/not found/);
    await expect(uploadDocumentFile(other.id, d.id!, { name: "x.pdf", bytes: PDF })).rejects.toThrow(/not found/);
    const v2 = await uploadDocumentFile(owner.id, d.id!, { name: "passport-2.pdf", bytes: PDF });
    expect(v2.version).toBe(2);
  });

  it("rejects disguised or oversized files", async () => {
    const d = await op(at("2026-11-18"), "document.create", { title: "Letter", kind: "letter" });
    await expect(uploadDocumentFile(owner.id, d.id!, { name: "evil.pdf", bytes: Buffer.from("<html><script>alert(1)</script>") })).rejects.toThrow(/Only PDF/);
    await expect(uploadDocumentFile(owner.id, d.id!, { name: "big.pdf", bytes: Buffer.concat([PDF, Buffer.alloc(4 * 1024 * 1024)]) })).rejects.toThrow(/4 MB/);
  });

  it("deleting a document removes its files from storage and its ID", async () => {
    const d = await op(at("2026-11-18"), "document.create", { title: "ID", kind: "national_id", idNumber: "1098765432" });
    await uploadDocumentFile(owner.id, d.id!, { name: "id.pdf", bytes: PDF });
    await op(at("2026-11-18"), "document.delete", { id: d.id });
    expect(allFiles("/tmp/ld-test-blobs")).toHaveLength(0);
    expect(await getDb().select().from(protectedIdFields)).toHaveLength(0);
  });
});

describe("Belongs to (family members)", () => {
  it("assigns documents/expiries to a person, words reminders with their name, filters and searches by them", async () => {
    const ali = await op(at("2026-11-18"), "person.create", { name: "Ali", relation: "child" });
    await op(at("2026-11-18"), "expiry.create", { label: "Passport", kind: "passport", personId: ali.id, expiresOn: "2027-06-30" });
    const rem = await getDb().select().from(reminders).where(eq(reminders.sourceType, "expiry"));
    expect(rem.every((r) => r.title.startsWith("Ali's Passport"))).toBe(true);
    await op(at("2026-11-18"), "document.create", { title: "Passport", kind: "passport", personId: ali.id });
    await op(at("2026-11-18"), "document.create", { title: "Passport", kind: "passport" });
    const { documentsState, expiriesState } = await import("@/server/queries");
    const me = { ...owner, displayName: "Maryam" };
    expect((await documentsState(me, { person: ali.id! })).map((d) => d.doc.personId)).toEqual([ali.id]);
    expect((await documentsState(me, { person: "me" })).every((d) => d.doc.personId === null)).toBe(true);
    const ranked = await documentsState(me, { q: "ali passport" });
    expect(ranked[0].doc.personId).toBe(ali.id);
    const mine = await documentsState(me, { q: "maryam passport" });
    expect(mine[0].doc.personId).toBeNull();
    expect((await expiriesState(me, { person: ali.id! })).items).toHaveLength(1);
    // another owner can't attach their records to my family member
    const other = await makeOwner("other@example.com");
    await expect(op(at("2026-11-18"), "document.create", { title: "X", personId: ali.id }, () => other.id)).rejects.toThrow(/Person not found/);
  });
  it("Capture understands “Ali's passport expires on …”", async () => {
    await op(at("2026-11-18"), "person.create", { name: "Ali", relation: "child" });
    const res = await interpret({ id: owner.id, timezone: "Asia/Riyadh", defaultCurrency: "SAR" }, "Ali's passport expires on 1 June 2028", "text");
    if (res.kind !== "proposal") throw new Error("expected proposal");
    expect(res.proposal.operations[0].valid).toBe(true);
    expect(res.proposal.operations[0].display.personId).toBe("Ali");
  });
});
