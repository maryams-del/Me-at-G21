import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { put, get, del } from "@vercel/blob";

/**
 * Private document storage.
 *  - Bytes are encrypted with AES-256-GCM *before* they leave the server. The key is derived
 *    (HKDF-SHA256) from DATA_ENCRYPTION_KEY, so a leaked storage bucket alone reveals nothing.
 *  - Storage keys are random and unguessable; files are only ever served through our
 *    authenticated route after an owner check. No public URLs exist.
 *  - Backend: Vercel Blob with access "private" when a token is configured; a local folder in
 *    development/tests. Production without a token refuses to store files.
 * Envelope: "LDF1" | iv(12) | tag(16) | ciphertext
 */

const MAGIC = Buffer.from("LDF1");
export const MAX_FILE_BYTES = 4 * 1024 * 1024; // Vercel function request bodies are limited to ~4.5 MB
export const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/webp": "webp",
};

function fileKey(): Buffer {
  const base = process.env.DATA_ENCRYPTION_KEY;
  if (!base) throw new Error("DATA_ENCRYPTION_KEY is not set");
  return Buffer.from(hkdfSync("sha256", Buffer.from(base, "base64"), Buffer.alloc(0), Buffer.from("me-at-g21/documents/v1"), 32));
}

export function encryptBytes(plain: Buffer, aad: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", fileKey(), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}

export function decryptBytes(env: Buffer, aad: string): Buffer {
  if (!env.subarray(0, 4).equals(MAGIC)) throw new Error("Unknown file envelope");
  const iv = env.subarray(4, 16), tag = env.subarray(16, 32), ct = env.subarray(32);
  const d = createDecipheriv("aes-256-gcm", fileKey(), iv);
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.ME_AT_G21_DOCUMENTS_READ_WRITE_TOKEN;
}
const localDir = () => path.resolve(process.env.LOCAL_BLOB_DIR ?? ".data/blobs");

export function storageConfigured() {
  return !!blobToken() || process.env.NODE_ENV !== "production";
}

/** Encrypt and store. Returns the opaque storage key and the plaintext SHA-256 (for integrity checks). */
export async function storeEncrypted(ownerId: string, plain: Buffer): Promise<{ storageKey: string; sha256: string }> {
  const storageKey = `${ownerId}/${randomBytes(24).toString("base64url")}.bin`;
  const sealed = encryptBytes(plain, storageKey);
  const token = blobToken();
  if (token) {
    await put(storageKey, sealed, { access: "private", token, contentType: "application/octet-stream", addRandomSuffix: false });
  } else {
    if (process.env.NODE_ENV === "production") throw new Error("File storage is not configured");
    const p = path.join(localDir(), storageKey);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, sealed);
  }
  return { storageKey, sha256: createHash("sha256").update(plain).digest("hex") };
}

export async function readDecrypted(storageKey: string, expectedSha256?: string): Promise<Buffer> {
  const token = blobToken();
  let sealed: Buffer;
  if (token) {
    const res = await get(storageKey, { access: "private", token, useCache: false });
    if (!res || !res.stream) throw new Error("File not found in storage");
    sealed = Buffer.from(await new Response(res.stream).arrayBuffer());
  } else {
    sealed = await readFile(path.join(localDir(), storageKey));
  }
  const plain = decryptBytes(sealed, storageKey);
  if (expectedSha256 && createHash("sha256").update(plain).digest("hex") !== expectedSha256) throw new Error("File integrity check failed");
  return plain;
}

export async function removeStored(storageKey: string) {
  const token = blobToken();
  if (token) await del(storageKey, { token }).catch(() => {});
  else await unlink(path.join(localDir(), storageKey)).catch(() => {});
}

/** Light content sniffing so a renamed executable can't be stored as "a PDF". */
export function sniffType(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (buf.subarray(4, 12).toString("latin1").startsWith("ftyphei") || buf.subarray(4, 12).toString("latin1").startsWith("ftypmif1")) return "image/heic";
  return null;
}
