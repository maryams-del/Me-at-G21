import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError, rateLimit } from "@/server/auth/core";
import { createStoredBackup, readStoredBackup, BackupError } from "@/server/backup";

export const maxDuration = 60;

/** GET ?id=<backup id> downloads a stored backup; ?id=new makes a fresh one first. Files are encrypted. */
export async function GET(req: Request) {
  try {
    const s = await requireUser();
    const id = z.union([z.literal("new"), z.string().uuid()]).parse(new URL(req.url).searchParams.get("id"));
    if (id === "new" && !(await rateLimit(`backup:${s.user.id}`, 20, 3600))) throw new AuthError(429, "Too many backups this hour. Try again later.");
    const backupId = id === "new" ? (await createStoredBackup(s.user.id, "manual")).id : id;
    const buf = await readStoredBackup(s.user.id, backupId);
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="me-at-g21-backup-${stamp}.mebackup"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof BackupError || e instanceof z.ZodError) return NextResponse.json({ error: e instanceof BackupError ? e.message : "Invalid request" }, { status: 400 });
    console.error("[backup] download failed:", (e as Error).message);
    return NextResponse.json({ error: "Backup failed. Nothing was changed." }, { status: 500 });
  }
}
