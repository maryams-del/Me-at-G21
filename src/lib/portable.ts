/**
 * Full-backup file format, built and opened in the browser with WebCrypto. The password never
 * leaves the device. Works the same in Node (tests).
 *
 *   header : "LDP1" | version(1)=1 | salt(16) | PBKDF2 iterations (uint32 BE)
 *   chunks : len (uint32 BE) | iv(12) | AES-256-GCM ciphertext(len)     AAD = "LDP1:<chunk index>"
 *     #0      flag(1: 1 = gzip) + records JSON
 *     #1..n   file id (36 ascii) + file bytes
 *     last    "END:<number of file chunks>"   (detects truncated files)
 * Key = PBKDF2-SHA256(password, salt, iterations). Chunk AADs stop reordering or splicing.
 */

export const PORTABLE_MAGIC = "LDP1";
export const ITERATIONS = 600_000;
export const MIN_PASSWORD = 12;

const te = new TextEncoder();
const td = new TextDecoder();
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const readU32 = (b: Uint8Array, o = 0) => new DataView(b.buffer, b.byteOffset + o, 4).getUint32(0);
const concat = (parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey("raw", ab(te.encode(password)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: ab(salt), iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Blob([ab(data)]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function sha256Hex(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", ab(bytes)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Incrementally builds the encrypted file as a list of parts (turned into a Blob for download). */
export class PortableWriter {
  parts: Uint8Array[] = [];
  private index = 0;
  private files = 0;
  private constructor(private key: CryptoKey) {}

  static async create(password: string, iterations = ITERATIONS) {
    if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters`);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const w = new PortableWriter(await deriveKey(password, salt, iterations));
    w.parts.push(concat([te.encode(PORTABLE_MAGIC), new Uint8Array([1]), salt, u32(iterations)]));
    return w;
  }

  private async chunk(plain: Uint8Array) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: ab(te.encode(`${PORTABLE_MAGIC}:${this.index++}`)) }, this.key, ab(plain)));
    this.parts.push(concat([u32(ct.length), iv, ct]));
  }

  async records(json: string) {
    const raw = te.encode(json);
    const gz = typeof CompressionStream !== "undefined";
    await this.chunk(concat([new Uint8Array([gz ? 1 : 0]), gz ? await pipe(raw, new CompressionStream("gzip")) : raw]));
  }

  async file(id: string, bytes: Uint8Array) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("bad file id");
    await this.chunk(concat([te.encode(id), bytes]));
    this.files++;
  }

  async finish() { await this.chunk(te.encode(`END:${this.files}`)); return this.parts; }
}

/** Reads a backup sequentially from anything that can return byte ranges (a File/Blob in the browser). */
export type Source = { size: number; read: (start: number, end: number) => Promise<Uint8Array> };
export const blobSource = (b: Blob): Source => ({ size: b.size, read: async (s, e) => new Uint8Array(await b.slice(s, e).arrayBuffer()) });

export class PortableReader {
  private index = 0;
  private offset = 25;
  private constructor(private src: Source, private key: CryptoKey) {}

  /** Throws "wrong password" style errors before anything else is read. */
  static async open(src: Source, password: string) {
    const head = await src.read(0, 25);
    if (head.length < 25 || td.decode(head.subarray(0, 4)) !== PORTABLE_MAGIC) throw new Error("This isn't a Me @ G21 full backup file.");
    if (head[4] !== 1) throw new Error("Unsupported backup version.");
    const r = new PortableReader(src, await deriveKey(password, head.subarray(5, 21), readU32(head, 21)));
    return r;
  }

  private async next(): Promise<Uint8Array | null> {
    if (this.offset >= this.src.size) return null;
    const len = readU32(await this.src.read(this.offset, this.offset + 4));
    const iv = await this.src.read(this.offset + 4, this.offset + 16);
    const ct = await this.src.read(this.offset + 16, this.offset + 16 + len);
    if (ct.length !== len) throw new Error("The backup file is incomplete (cut off).");
    this.offset += 16 + len;
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: ab(iv), additionalData: ab(te.encode(`${PORTABLE_MAGIC}:${this.index++}`)) }, this.key, ab(ct)));
    } catch {
      throw new Error(this.index === 1 ? "Wrong password, or the file is damaged." : "The backup file is damaged.");
    }
  }

  async records(): Promise<string> {
    const c = await this.next();
    if (!c) throw new Error("The backup file is empty.");
    const body = c.subarray(1);
    return td.decode(c[0] === 1 ? await pipe(body, new DecompressionStream("gzip")) : body);
  }

  /** Yields each file; checks the END marker so a truncated file is noticed. */
  async *files(): AsyncGenerator<{ id: string; bytes: Uint8Array }> {
    let n = 0;
    for (;;) {
      const c = await this.next();
      if (!c) throw new Error("The backup file is incomplete (cut off).");
      const asText = c.length < 32 ? td.decode(c) : "";
      if (asText.startsWith("END:")) { if (Number(asText.slice(4)) !== n) throw new Error("The backup file is incomplete."); return; }
      yield { id: td.decode(c.subarray(0, 36)), bytes: c.subarray(36) };
      n++;
    }
  }
}
