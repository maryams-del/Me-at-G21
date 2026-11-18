import { requireUser, hasFreshStepUp, AuthError, rateLimit } from "@/server/auth/core";
import { restorePortable, BackupError, type PortablePayload } from "@/server/backup";
import { json } from "@/server/http";
import { UserError } from "@/server/audit";
import { gunzipSync } from "node:zlib";

export const maxDuration = 60;

/** Replace all records with a full backup's (already decrypted in the browser). Passkey check required. */
export async function POST(req: Request) {
  return json(async () => {
    const s = await requireUser();
    if (!hasFreshStepUp(s)) throw new AuthError(403, "step_up_required");
    if (!(await rateLimit(`portable-restore:${s.user.id}`, 5, 3600))) throw new AuthError(429, "Too many restores this hour. Try again later.");
    // the browser gzips the records to stay well under the request size limit
    let body: { payload?: PortablePayload } | null = null;
    try {
      const raw = Buffer.from(await req.arrayBuffer());
      body = JSON.parse((req.headers.get("content-type") ?? "").includes("gzip") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8"));
    } catch { body = null; }
    if (!body?.payload) throw new UserError("No backup received");
    try {
      const r = await restorePortable(s.user.id, body.payload);
      return { ok: true, files: body.payload.files.map((f) => f.id), ...r };
    } catch (e) {
      if (e instanceof BackupError) throw new UserError(e.message);
      throw e;
    }
  });
}
