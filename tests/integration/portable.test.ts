import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "@/db";
import * as t from "@/db/schema";
import { runOpInTx } from "@/server/ops";
import { buildPortable, restorePortable, restorePortableFile, type PortablePayload } from "@/server/backup";
import { uploadDocumentFile, readDocumentFile, revealProtectedId } from "@/server/documents";
import { periodState } from "@/server/queries";
import { PortableWriter, PortableReader, type Source } from "@/lib/portable";
import { resetDb, makeOwner, withCtx } from "../support/db";

const PDF = Buffer.from("%PDF-1.4\n% fake demo certificate\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
let owner: Awaited<ReturnType<typeof makeOwner>>;
const op = (name: string, input: unknown, who = owner.id) =>
  withCtx(who, new Date(), (ctx) => runOpInTx(ctx.tx, { ownerId: who, tz: ctx.tz, source: "manual", now: ctx.now }, name, input));
const mem = (parts: Uint8Array[]): Source => {
  const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return { size: all.length, read: async (s, e) => all.slice(s, e) };
};

beforeEach(async () => { await resetDb(); owner = await makeOwner(); });
afterAll(async () => { await closeDb(); });

async function makeFullBackup(password: string) {
  const p = await buildPortable(owner.id);
  const w = await PortableWriter.create(password, 1000); // low iterations keep tests fast; the app uses 600k
  await w.records(JSON.stringify(p));
  for (const f of p.files) await w.file(f.id, new Uint8Array((await readDocumentFile(owner.id, f.id)).bytes));
  return { p, parts: await w.finish() };
}

describe("Full backup (password-locked, documents included)", () => {
  it("restores everything — records, ID numbers, period notes and document files — into a brand-new installation's account", async () => {
    const d = await op("document.create", { title: "Demo certificate", kind: "certificate", idNumber: "DEMO-1234-5678" });
    await uploadDocumentFile(owner.id, d.id!, { name: "cert.pdf", bytes: PDF });
    await op("period.add", { startDate: "2026-10-01", endDate: "2026-10-05", notes: "demo private note" });
    await op("charity.create", { paidOn: "2026-11-01", recipient: "Demo charity", amount: "75" });
    const { p, parts } = await makeFullBackup("correct horse battery staple");
    // the unlocked payload holds plaintext only inside the encrypted file
    expect(JSON.stringify(p)).toContain("DEMO-1234-5678");
    const flat = Buffer.concat(parts.map((x) => Buffer.from(x))).toString("latin1");
    expect(flat).not.toContain("DEMO-1234-5678");
    expect(flat).not.toContain("demo private note");
    expect(flat).not.toContain("%PDF");

    // new installation: a different account id; restore with the password
    const fresh = await makeOwner("fresh@example.com");
    const r = await PortableReader.open(mem(parts), "correct horse battery staple");
    const payload = JSON.parse(await r.records()) as PortablePayload;
    await restorePortable(fresh.id, payload);
    for await (const f of r.files()) expect((await restorePortableFile(fresh.id, f.id, Buffer.from(f.bytes))).already).toBe(false);

    const [doc] = await getDb().select().from(t.documents).where(eq(t.documents.ownerId, fresh.id));
    expect(doc.title).toBe("Demo certificate");
    expect(await revealProtectedId(fresh.id, doc.id)).toBe("DEMO-1234-5678");
    const [file] = await getDb().select().from(t.documentFiles).where(eq(t.documentFiles.ownerId, fresh.id));
    expect((await readDocumentFile(fresh.id, file.id)).bytes.equals(PDF)).toBe(true);
    expect(doc.id).not.toBe(d.id); // new ids in another account; references rewritten
    expect(file.documentId).toBe(doc.id);
    expect((await periodState({ ...fresh, timezone: "Asia/Riyadh" }, { withDetails: true })).cycles[0].notes).toBe("demo private note");
    expect((await getDb().select().from(t.charityPayments).where(eq(t.charityPayments.ownerId, fresh.id)))[0].recipient).toBe("Demo charity");
    // uploading the same file again is a no-op
    expect((await restorePortableFile(fresh.id, file.id, PDF)).already).toBe(true);
    // the original account is untouched
    expect((await getDb().select().from(t.documents).where(eq(t.documents.ownerId, owner.id)))).toHaveLength(1);
  });

  it("wrong password, tampering, truncation and a swapped file are all refused", async () => {
    const d = await op("document.create", { title: "Demo", kind: "certificate" });
    await uploadDocumentFile(owner.id, d.id!, { name: "a.pdf", bytes: PDF });
    const { parts } = await makeFullBackup("correct horse battery staple");
    await expect(PortableReader.open(mem(parts), "wrong password!!").then((r) => r.records())).rejects.toThrow(/Wrong password/);

    const tampered = parts.map((x) => x.slice()); tampered[2][30] ^= 1;
    const r1 = await PortableReader.open(mem(tampered), "correct horse battery staple");
    await r1.records();
    await expect((async () => { for await (const _ of r1.files()) void _; })()).rejects.toThrow(/damaged/);

    const truncated = parts.slice(0, parts.length - 1); // END marker missing
    const r2 = await PortableReader.open(mem(truncated), "correct horse battery staple");
    await r2.records();
    await expect((async () => { for await (const _ of r2.files()) void _; })()).rejects.toThrow(/incomplete/);

    // a pending file only accepts bytes matching its recorded checksum
    const fresh = await makeOwner("fresh@example.com");
    const r3 = await PortableReader.open(mem(parts), "correct horse battery staple");
    await restorePortable(fresh.id, JSON.parse(await r3.records()));
    const [f] = await getDb().select().from(t.documentFiles).where(eq(t.documentFiles.ownerId, fresh.id));
    const originalId = f.storageKey.replace("pending:", "");
    await expect(restorePortableFile(fresh.id, originalId, Buffer.from("%PDF-1.4 something else"))).rejects.toThrow(/integrity/);
    await expect(readDocumentFile(fresh.id, f.id)).rejects.toThrow(/hasn't been restored yet/);
    const third = await makeOwner("third@example.com");
    await expect(restorePortableFile(third.id, originalId, PDF)).rejects.toThrow(/isn't part/); // nothing waiting in that account
  });

  it("passwords shorter than 12 characters are refused", async () => {
    await expect(PortableWriter.create("short")).rejects.toThrow(/12 characters/);
  });
});
