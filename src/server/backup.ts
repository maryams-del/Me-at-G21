import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { and, desc, eq, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getDb, type Tx } from "@/db";
import { backups } from "@/db/schema";
import { storeEncrypted, readDecrypted, removeStored } from "./storage";
import { backupItems } from "@/lib/backup-labels";

/*
 * Backups of one owner's records.
 *
 * What's in it: every table with an owner_id column (discovered from the database, so new
 * features are covered automatically), plus notification delivery history, plus the owner's
 * app settings. What's NOT in it, on purpose: sign-in secrets (passkeys, TOTP seeds, recovery
 * codes, sessions), push-device registrations, pending AI proposals, the backups list itself,
 * and uploaded file *contents* (those stay in private storage; their metadata is included).
 * Encrypted fields (period notes, protected ID numbers) stay encrypted inside the backup.
 *
 * File format ("LDB1"): magic | iv(12) | tag(16) | AES-256-GCM( gzip( JSON ) )
 *   key  = HKDF(DATA_ENCRYPTION_KEY, "me-at-g21/backups/v1"), AAD = "backup:<ownerId>"
 *   JSON = { format, version, createdAt, ownerId, migration, counts, sha256, tables }
 *   sha256 covers the canonical JSON of `tables`. GCM + sha256 + counts = integrity check.
 * Only this app (with the same DATA_ENCRYPTION_KEY) can open a backup, and only for the same account.
 */

const MAGIC = Buffer.from("LDB1");
const EXCLUDED = new Set(["push_subscriptions", "ai_proposals", "backups"]);
export const KEEP_AUTOMATIC = 14;

function key(): Buffer {
  const base = process.env.DATA_ENCRYPTION_KEY;
  if (!base) throw new Error("DATA_ENCRYPTION_KEY is not set");
  return Buffer.from(hkdfSync("sha256", Buffer.from(base, "base64"), Buffer.alloc(0), Buffer.from("me-at-g21/backups/v1"), 32));
}

export type BackupPayload = {
  format: "me-at-g21-backup"; version: 1; createdAt: string; ownerId: string; migration: string | null;
  counts: Record<string, number>; sha256: string;
  tables: Record<string, Record<string, unknown>[]>;
  settings: { displayName: string | null; timezone: string; defaultCurrency: string; settings: unknown };
};

type Exec = Pick<Tx, "execute">;
const rows = async <T,>(db: Exec, q: ReturnType<typeof sql>) => (await db.execute(q)).rows as T[];
const ident = (s: string) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error("bad identifier"); return `"${s}"`; };

/** Owner-scoped tables, ordered so parents come before children (by foreign keys). */
export async function ownerTables(db: Exec): Promise<string[]> {
  const names = (await rows<{ t: string }>(db, sql`select table_name as t from information_schema.columns where table_schema = 'public' and column_name = 'owner_id' order by 1`))
    .map((r) => r.t).filter((t) => !EXCLUDED.has(t));
  const fks = await rows<{ child: string; parent: string }>(db, sql`
    select c.relname as child, p.relname as parent from pg_constraint k
    join pg_class c on c.oid = k.conrelid join pg_class p on p.oid = k.confrelid
    join pg_namespace n on n.oid = c.relnamespace
    where k.contype = 'f' and n.nspname = 'public'`);
  const set = new Set(names);
  const deps = new Map(names.map((n) => [n, new Set(fks.filter((f) => f.child === n && f.parent !== n && set.has(f.parent)).map((f) => f.parent))]));
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string, stack: Set<string>) => {
    if (seen.has(n)) return;
    if (stack.has(n)) throw new Error(`Foreign-key cycle at ${n}`);
    stack.add(n);
    for (const p of deps.get(n) ?? []) visit(p, stack);
    stack.delete(n); seen.add(n); out.push(n);
  };
  for (const n of names) visit(n, new Set());
  return out;
}

const canonical = (tables: BackupPayload["tables"]) => JSON.stringify(Object.keys(tables).sort().map((k) => [k, tables[k]]));

export async function buildPayload(ownerId: string, db: Exec = getDb()): Promise<BackupPayload> {
  const tables: BackupPayload["tables"] = {};
  for (const t of await ownerTables(db)) {
    // row_to_json keeps exact Postgres values (dates stay "YYYY-MM-DD", bigints exact) — no JS Date conversion.
    const [r] = await rows<{ j: Record<string, unknown>[] }>(db, sql.raw(`select coalesce(json_agg(row_to_json(x) order by x::text), '[]'::json) as j from ${ident(t)} x where x.owner_id = '${ownerId.replace(/[^0-9a-f-]/g, "")}'`));
    tables[t] = r.j;
  }
  const [d] = await rows<{ j: Record<string, unknown>[] }>(db, sql`select coalesce(json_agg(row_to_json(d) order by d::text), '[]'::json) as j from notification_deliveries d join reminders r on r.id = d.reminder_id where r.owner_id = ${ownerId}`);
  tables["notification_deliveries"] = d.j;
  const [u] = await rows<{ display_name: string | null; timezone: string; default_currency: string; settings: unknown }>(db, sql`select display_name, timezone, default_currency, settings from users where id = ${ownerId}`);
  let migration: string | null = null;
  try { const [m] = await rows<{ hash: string }>(db, sql`select hash from drizzle.__drizzle_migrations order by created_at desc limit 1`); migration = m?.hash ?? null; } catch { migration = null; }
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  return {
    format: "me-at-g21-backup", version: 1, createdAt: new Date().toISOString(), ownerId, migration, counts,
    sha256: createHash("sha256").update(canonical(tables)).digest("hex"), tables,
    settings: { displayName: u?.display_name ?? null, timezone: u?.timezone ?? "Asia/Riyadh", defaultCurrency: u?.default_currency ?? "SAR", settings: u?.settings ?? {} },
  };
}

export function sealBackup(p: BackupPayload): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  c.setAAD(Buffer.from(`backup:${p.ownerId}`));
  const ct = Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(p)))), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}

export class BackupError extends Error {}

/** Decrypt and verify. Throws BackupError with a plain explanation on any problem. */
export function openBackup(buf: Buffer, ownerId: string): BackupPayload {
  if (buf.length < 40 || !buf.subarray(0, 4).equals(MAGIC)) throw new BackupError("This isn't a Me @ G21 backup file.");
  let json: string;
  try {
    const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(4, 16));
    d.setAAD(Buffer.from(`backup:${ownerId}`));
    d.setAuthTag(buf.subarray(16, 32));
    json = gunzipSync(Buffer.concat([d.update(buf.subarray(32)), d.final()])).toString("utf8");
  } catch {
    throw new BackupError("This backup can't be opened: it belongs to a different account, was made by a different installation, or the file is damaged.");
  }
  const p = JSON.parse(json) as BackupPayload;
  if (p.format !== "me-at-g21-backup" || p.version !== 1) throw new BackupError("Unsupported backup version.");
  if (p.ownerId !== ownerId) throw new BackupError("This backup belongs to a different account.");
  if (createHash("sha256").update(canonical(p.tables)).digest("hex") !== p.sha256) throw new BackupError("Integrity check failed: the contents don't match their checksum.");
  for (const [k, v] of Object.entries(p.tables)) if (p.counts[k] !== v.length) throw new BackupError(`Integrity check failed: ${k} count mismatch.`);
  return p;
}

/** Create, encrypt and store a backup; prune old automatic ones. */
export async function createStoredBackup(ownerId: string, kind: "automatic" | "manual" | "pre-restore") {
  const db = getDb();
  const p = await buildPayload(ownerId, db);
  const sealed = sealBackup(p);
  const { storageKey, sha256 } = await storeEncrypted(ownerId, sealed);
  const [b] = await db.insert(backups).values({ ownerId, kind, storageKey, sha256, sizeBytes: sealed.length, counts: p.counts, payloadSha256: p.sha256 }).returning();
  if (kind === "automatic") {
    const old = await db.select().from(backups).where(and(eq(backups.ownerId, ownerId), eq(backups.kind, "automatic"))).orderBy(desc(backups.createdAt)).offset(KEEP_AUTOMATIC);
    for (const o of old) { await removeStored(o.storageKey); await db.delete(backups).where(eq(backups.id, o.id)); }
  }
  // pre-restore safety copies are kept for 30 days
  const stale = await db.select().from(backups).where(and(eq(backups.ownerId, ownerId), eq(backups.kind, "pre-restore"), lt(backups.createdAt, new Date(Date.now() - 30 * 86400_000))));
  for (const o of stale) { await removeStored(o.storageKey); await db.delete(backups).where(eq(backups.id, o.id)); }
  return b;
}

export async function readStoredBackup(ownerId: string, id: string): Promise<Buffer> {
  const [b] = await getDb().select().from(backups).where(and(eq(backups.id, id), eq(backups.ownerId, ownerId)));
  if (!b) throw new BackupError("Backup not found");
  return readDecrypted(b.storageKey, b.sha256);
}

/** Human summary for the confirm screen. */
export function summarize(p: BackupPayload) {
  return { createdAt: p.createdAt, items: backupItems(p.counts) };
}

/**
 * Replace all of the owner's records with the backup's, in one transaction (all or nothing).
 * A safety backup of the current state is stored first.
 */
export async function restoreBackup(ownerId: string, p: BackupPayload) {
  if (p.ownerId !== ownerId) throw new BackupError("This backup belongs to a different account.");
  return replaceAll(ownerId, p.tables, p.settings, `Restored a backup from ${p.createdAt.slice(0, 10)}`);
}

async function replaceAll(ownerId: string, tables: BackupPayload["tables"], settings: BackupPayload["settings"], auditSummary: string) {
  const safety = await createStoredBackup(ownerId, "pre-restore");
  const db = getDb();
  await db.transaction(async (tx) => {
    const order = await ownerTables(tx);
    const unknown = Object.keys(tables).filter((t) => t !== "notification_deliveries" && !order.includes(t));
    if (unknown.length) throw new BackupError(`This backup has data this version of the app doesn't know (${unknown.join(", ")}).`);
    // children first when deleting; deliveries cascade with reminders
    for (const t of [...order].reverse()) await tx.execute(sql.raw(`delete from ${ident(t)} where owner_id = '${ownerId.replace(/[^0-9a-f-]/g, "")}'`));
    for (const t of [...order, "notification_deliveries"]) {
      const data = tables[t];
      if (!data?.length) continue;
      if (t !== "notification_deliveries" && data.some((r) => r.owner_id !== ownerId)) throw new BackupError("Backup contains records for another account.");
      // Only columns present in the backup; columns added since then fall back to their defaults.
      const cols = (await rows<{ c: string }>(tx, sql`select column_name as c from information_schema.columns where table_schema = 'public' and table_name = ${t}`)).map((r) => r.c);
      const present = cols.filter((c) => c in data[0]).map(ident).join(", ");
      for (let i = 0; i < data.length; i += 500) {
        // jsonb_populate_recordset lets Postgres convert every value back to its column type exactly.
        await tx.execute(sql`insert into ${sql.raw(ident(t))} (${sql.raw(present)}) select ${sql.raw(present)} from jsonb_populate_recordset(null::${sql.raw(ident(t))}, ${JSON.stringify(data.slice(i, i + 500))}::jsonb)`);
      }
    }
    await tx.execute(sql`insert into audit_events (owner_id, category, action, entity_type, entity_id, summary, source, sensitive, occurred_at) values (${ownerId}, 'settings', 'restored', 'backup', ${safety.id}, ${auditSummary}, 'manual', false, now())`);
    await tx.execute(sql`update users set display_name = ${settings.displayName}, timezone = ${settings.timezone}, default_currency = ${settings.defaultCurrency}, settings = ${JSON.stringify(settings.settings ?? {})}::jsonb, updated_at = now() where id = ${ownerId}`);
  });
  return { safetyBackupId: safety.id };
}

/* ───────────── Portable (full) backups ─────────────
 * The browser builds these: it fetches the records below plus every document file, and encrypts
 * everything with the owner's own backup password (the server never sees it). So the server must
 * hand over records with sensitive fields UNLOCKED (only after a fresh passkey check), and accept
 * them back, locking them again with this installation's key — possibly on a fresh installation
 * with a different account id.
 */
export type PortablePayload = Omit<BackupPayload, "format"> & {
  format: "me-at-g21-portable";
  files: { id: string; documentId: string; filename: string; contentType: string; sizeBytes: number; sha256: string }[];
};

export async function buildPortable(ownerId: string): Promise<PortablePayload> {
  const { decryptField } = await import("@/lib/crypto");
  const key = process.env.DATA_ENCRYPTION_KEY!;
  const p = await buildPayload(ownerId);
  const tables = { ...p.tables };
  // unlock protected ID numbers
  tables.protected_id_fields = (tables.protected_id_fields ?? []).map((r) => {
    const { value_enc, ...rest } = r as { value_enc: string } & Record<string, unknown>;
    return { ...rest, __value: decryptField(value_enc, key, `docid:${ownerId}:${rest.document_id}`) };
  });
  // unlock period notes/symptoms
  const { decPeriodField } = await import("./ops/period");
  tables.period_cycles = (tables.period_cycles ?? []).map((r) => {
    const { notes_enc, symptoms_enc, ...rest } = r as { notes_enc: string | null; symptoms_enc: string | null } & Record<string, unknown>;
    return { ...rest, __notes: decPeriodField(ownerId, String(rest.id), "notes", notes_enc), __symptoms: decPeriodField(ownerId, String(rest.id), "symptoms", symptoms_enc) };
  });
  // files: storage locations are installation-specific; only live files travel (their bytes come separately)
  const live = (tables.document_files ?? []).filter((f) => !f.deleted_at);
  tables.document_files = live.map(({ storage_key: _k, ...rest }) => { void _k; return rest; });
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  return {
    ...p, format: "me-at-g21-portable", tables, counts,
    sha256: createHash("sha256").update(canonical(tables)).digest("hex"),
    files: live.map((f) => ({ id: String(f.id), documentId: String(f.document_id), filename: String(f.filename), contentType: String(f.content_type), sizeBytes: Number(f.size_bytes), sha256: String(f.sha256) })),
  };
}

export const PENDING = "pending:";

/** Restore a portable payload into this account: remap the owner, lock sensitive fields with this installation's key. */
export async function restorePortable(ownerId: string, p: PortablePayload) {
  if (p.format !== "me-at-g21-portable" || p.version !== 1) throw new BackupError("This isn't a Me @ G21 full backup.");
  if (createHash("sha256").update(canonical(p.tables)).digest("hex") !== p.sha256) throw new BackupError("Integrity check failed: the contents don't match their checksum.");
  const { encryptField } = await import("@/lib/crypto");
  const key = process.env.DATA_ENCRYPTION_KEY!;
  // Restoring into a different account (e.g. a fresh installation, or the same server after starting
  // over): give every record a new id and rewrite every reference to it, so nothing can clash.
  const map = new Map<string, string>([[p.ownerId, ownerId]]);
  const originalFileId = new Map<string, string>();
  if (p.ownerId !== ownerId) {
    for (const data of Object.values(p.tables)) for (const r of data) if (typeof r.id === "string") map.set(r.id, randomUUID());
  }
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  const remap = (v: unknown): unknown =>
    typeof v === "string" ? v.replace(UUID, (m) => map.get(m) ?? m)
      : Array.isArray(v) ? v.map(remap)
      : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x)]))
      : v;
  for (const f of p.tables.document_files ?? []) originalFileId.set(map.get(String(f.id)) ?? String(f.id), String(f.id));
  const tables: BackupPayload["tables"] = {};
  for (const [t, data] of Object.entries(p.tables)) tables[t] = data.map((r) => remap(r) as Record<string, unknown>);
  tables.protected_id_fields = (tables.protected_id_fields ?? []).map((r) => {
    const { __value, ...rest } = r as { __value: string } & Record<string, unknown>;
    return { ...rest, value_enc: encryptField(String(__value), key, `docid:${ownerId}:${rest.document_id}`) };
  });
  const aadP = (id: unknown, f: string) => `period:${ownerId}:${id}:${f}`;
  tables.period_cycles = (tables.period_cycles ?? []).map((r) => {
    const { __notes, __symptoms, ...rest } = r as { __notes: string | null; __symptoms: string | null } & Record<string, unknown>;
    return { ...rest, notes_enc: __notes ? encryptField(__notes, key, aadP(rest.id, "notes")) : null, symptoms_enc: __symptoms ? encryptField(__symptoms, key, aadP(rest.id, "symptoms")) : null };
  });
  // file rows wait for their bytes, uploaded one by one afterwards (keyed by the id inside the backup file)
  tables.document_files = (tables.document_files ?? []).map((r) => ({ ...r, storage_key: `${PENDING}${originalFileId.get(String(r.id))}` }));
  return replaceAll(ownerId, tables, p.settings, `Restored a full backup from ${p.createdAt.slice(0, 10)}`);
}

/** Store one restored file's bytes, verified against the checksum recorded in the backup. */
export async function restorePortableFile(ownerId: string, fileId: string, bytes: Buffer) {
  const { documentFiles } = await import("@/db/schema");
  const { storeEncrypted } = await import("./storage");
  const db = getDb();
  // fileId is the id inside the backup file; the row may have a new id after restoring into another account
  const [f] = await db.select().from(documentFiles).where(and(eq(documentFiles.ownerId, ownerId), eq(documentFiles.storageKey, `${PENDING}${fileId}`)));
  if (!f) {
    const [done] = await db.select({ id: documentFiles.id }).from(documentFiles).where(and(eq(documentFiles.ownerId, ownerId), eq(documentFiles.id, fileId)));
    if (done) return { already: true };
    throw new BackupError("That file isn't part of the restored backup, or it's already been restored.");
  }
  if (createHash("sha256").update(bytes).digest("hex") !== f.sha256) throw new BackupError(`“${f.filename}” failed its integrity check.`);
  const { storageKey } = await storeEncrypted(ownerId, bytes);
  await db.update(documentFiles).set({ storageKey }).where(eq(documentFiles.id, f.id));
  return { already: false };
}
