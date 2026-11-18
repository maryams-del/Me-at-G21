import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { documentFiles, protectedIdFields, auditEvents } from "@/db/schema";
import { decryptField } from "@/lib/crypto";
import { UserError } from "./audit";
import { ownDocument, nextFileVersion } from "./ops/admin";
import { ALLOWED_TYPES, MAX_FILE_BYTES, readDecrypted, sniffType, storeEncrypted } from "./storage";

/** Store a new version of a document's file. Validates size and real content type (not just the name). */
export async function uploadDocumentFile(ownerId: string, documentId: string, file: { name: string; bytes: Buffer }) {
  if (file.bytes.length === 0) throw new UserError("The file is empty");
  if (file.bytes.length > MAX_FILE_BYTES) throw new UserError("Files must be 4 MB or smaller. Try a compressed PDF or a photo.");
  const type = sniffType(file.bytes);
  if (!type || !ALLOWED_TYPES[type]) throw new UserError("Only PDF, JPEG, PNG, HEIC or WebP files are allowed");
  const safeName = (file.name || "document").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "document";
  const db = getDb();
  const doc = await ownDocument({ tx: db, ownerId }, documentId);
  const stored = await storeEncrypted(ownerId, file.bytes);
  try {
    return await db.transaction(async (tx) => {
      const version = await nextFileVersion({ tx }, doc.id);
      const [f] = await tx.insert(documentFiles).values({
        ownerId, documentId: doc.id, version, storageKey: stored.storageKey, filename: safeName,
        contentType: type, sizeBytes: file.bytes.length, sha256: stored.sha256,
      }).returning({ id: documentFiles.id });
      await tx.insert(auditEvents).values({ ownerId, category: "documents", action: "uploaded", entityType: "document_file", entityId: f.id, summary: `Uploaded ${safeName} (v${version}) to “${doc.title}”` });
      return { id: f.id, version };
    });
  } catch (e) {
    const { removeStored } = await import("./storage");
    await removeStored(stored.storageKey);
    throw e;
  }
}

/** Owner-checked read. Another owner's file ID (or a guessed one) is indistinguishable from "not found". */
export async function readDocumentFile(ownerId: string, fileId: string) {
  const [f] = await getDb().select().from(documentFiles).where(and(eq(documentFiles.id, fileId), eq(documentFiles.ownerId, ownerId), isNull(documentFiles.deletedAt)));
  if (!f) throw new UserError("File not found");
  if (f.storageKey.startsWith("pending:")) throw new UserError("This file hasn't been restored yet. Finish restoring your full backup in Settings → Data & backups.");
  const bytes = await readDecrypted(f.storageKey, f.sha256);
  return { file: f, bytes };
}

/** Reveal a protected ID number. Callers must enforce a fresh passkey step-up first. */
export async function revealProtectedId(ownerId: string, documentId: string) {
  const db = getDb();
  const doc = await ownDocument({ tx: db, ownerId }, documentId);
  const [p] = await db.select().from(protectedIdFields).where(and(eq(protectedIdFields.documentId, doc.id), eq(protectedIdFields.ownerId, ownerId)));
  if (!p) throw new UserError("No ID number stored for this document");
  const value = decryptField(p.valueEnc, process.env.DATA_ENCRYPTION_KEY!, `docid:${ownerId}:${doc.id}`);
  await db.insert(auditEvents).values({ ownerId, category: "documents", action: "id_revealed", entityType: "document", entityId: doc.id, summary: `Revealed the ID number for “${doc.title}”`, sensitive: true });
  return value;
}
