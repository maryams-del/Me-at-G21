import { z } from "zod";
import { and, eq, like } from "drizzle-orm";
import { requireUser } from "@/server/auth/core";
import { restorePortableFile, BackupError, PENDING } from "@/server/backup";
import { json } from "@/server/http";
import { UserError } from "@/server/audit";
import { getDb } from "@/db";
import { documentFiles } from "@/db/schema";

export const maxDuration = 30;

/** Files from a full backup still waiting for their contents (to resume an interrupted restore). */
export async function GET() {
  return json(async () => {
    const s = await requireUser();
    const rows = await getDb().select({ filename: documentFiles.filename, storageKey: documentFiles.storageKey }).from(documentFiles).where(and(eq(documentFiles.ownerId, s.user.id), like(documentFiles.storageKey, `${PENDING}%`)));
    return { pending: rows.map((r) => ({ id: r.storageKey.slice(PENDING.length), filename: r.filename })) };
  }, { mutation: false });
}

/** Upload one file's contents; accepted only for a waiting file and only if its checksum matches. */
export async function POST(req: Request) {
  return json(async () => {
    const s = await requireUser();
    const form = await req.formData().catch(() => null);
    const fileId = z.string().uuid().parse(form?.get("fileId"));
    const file = form?.get("file");
    if (!(file instanceof File)) throw new UserError("No file received");
    try {
      return { ok: true, ...(await restorePortableFile(s.user.id, fileId, Buffer.from(await file.arrayBuffer()))) };
    } catch (e) {
      if (e instanceof BackupError) throw new UserError(e.message);
      throw e;
    }
  });
}
