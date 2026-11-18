import { z } from "zod";
import { requireUser, hasFreshStepUp, AuthError, rateLimit } from "@/server/auth/core";
import { openBackup, readStoredBackup, restoreBackup, summarize, BackupError } from "@/server/backup";
import { json } from "@/server/http";
import { UserError } from "@/server/audit";

export const maxDuration = 60;

/**
 * multipart: mode=preview|restore, and either file=<.mebackup> or id=<stored backup id>.
 * preview: decrypts + verifies integrity, returns a summary, changes nothing.
 * restore: requires a passkey check in the last 10 minutes; replaces everything in one transaction
 *          after saving a safety backup of the current state.
 */
export async function POST(req: Request) {
  return json(async () => {
    const s = await requireUser();
    const form = await req.formData().catch(() => null);
    if (!form) throw new UserError("No backup received");
    const mode = z.enum(["preview", "restore"]).parse(form.get("mode"));
    if (mode === "restore" && !hasFreshStepUp(s)) throw new AuthError(403, "step_up_required");
    if (!(await rateLimit(`restore:${s.user.id}:${mode}`, mode === "restore" ? 5 : 30, 3600))) throw new AuthError(429, "Too many attempts. Try again later.");
    const file = form.get("file");
    const id = form.get("id");
    let buf: Buffer;
    try {
      if (file instanceof File) {
        if (file.size > 4 * 1024 * 1024) throw new BackupError("That file is too large to be a Me @ G21 backup.");
        buf = Buffer.from(await file.arrayBuffer());
      } else if (typeof id === "string" && z.string().uuid().safeParse(id).success) buf = await readStoredBackup(s.user.id, id);
      else throw new BackupError("Choose a backup file or a saved backup.");
      const payload = openBackup(buf, s.user.id);
      if (mode === "preview") return { ok: true, summary: summarize(payload) };
      const r = await restoreBackup(s.user.id, payload);
      return { ok: true, message: `Restored the backup from ${payload.createdAt.slice(8, 10)}/${payload.createdAt.slice(5, 7)}/${payload.createdAt.slice(0, 4)}. Your previous data was saved as a safety backup.`, ...r };
    } catch (e) {
      if (e instanceof BackupError) throw new UserError(e.message);
      throw e;
    }
  });
}
