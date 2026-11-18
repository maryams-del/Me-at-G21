/**
 * Server-side crypto helpers built only on Node's audited `crypto` primitives.
 * No custom algorithms. Envelope format is versioned: "v1.<iv>.<ciphertext>.<tag>" (base64url).
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function key(b64: string): Buffer {
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must decode to 32 bytes");
  return k;
}

export function encryptField(plaintext: string, keyB64: string, aad = ""): string {
  const iv = randomBytes(12); // unique per message
  const c = createCipheriv("aes-256-gcm", key(keyB64), iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), ct.toString("base64url"), c.getAuthTag().toString("base64url")].join(".");
}

export function decryptField(envelope: string, keyB64: string, aad = ""): string {
  const [v, iv, ct, tag] = envelope.split(".");
  if (v !== "v1" || !iv || !ct || !tag) throw new Error("Unsupported envelope");
  const d = createDecipheriv("aes-256-gcm", key(keyB64), Buffer.from(iv, "base64url"));
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

/** Keyed verifier for high-entropy secrets (session tokens, recovery codes, email codes). */
export function verifier(secret: string, pepper: string, context: string): string {
  return createHmac("sha256", Buffer.from(pepper, "base64")).update(`${context}:${secret}`).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
/** 16 chars from a 31-symbol alphabet ≈ 79 bits of entropy, shown as XXXX-XXXX-XXXX-XXXX. */
export function recoveryCode(): string {
  const out: string[] = [];
  while (out.length < 16) {
    const b = randomBytes(1)[0];
    if (b < 248) out.push(ALPHABET[b % 31]); // rejection sampling: no modulo bias
  }
  return out.join("").match(/.{4}/g)!.join("-");
}

export function normalizeRecoveryCode(input: string): string {
  const c = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 16 ? c.match(/.{4}/g)!.join("-") : c;
}

/** 6-digit numeric code for email verification (short-lived, attempt-limited). */
export function numericCode(): string {
  return (randomBytes(4).readUInt32BE() % 1_000_000).toString().padStart(6, "0");
}
