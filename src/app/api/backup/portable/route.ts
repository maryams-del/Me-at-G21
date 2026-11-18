import { NextResponse } from "next/server";
import { requireUser, hasFreshStepUp, AuthError, rateLimit } from "@/server/auth/core";
import { buildPortable } from "@/server/backup";
import { getDb } from "@/db";
import { auditEvents } from "@/db/schema";

export const maxDuration = 60;

/**
 * Records for a full backup, with sensitive fields unlocked so the browser can lock them with the
 * owner's own password. Requires a passkey check in the last 10 minutes. Never cached.
 */
export async function GET() {
  try {
    const s = await requireUser();
    if (!hasFreshStepUp(s)) throw new AuthError(403, "step_up_required");
    if (!(await rateLimit(`portable:${s.user.id}`, 10, 3600))) throw new AuthError(429, "Too many full backups this hour. Try again later.");
    const p = await buildPortable(s.user.id);
    await getDb().insert(auditEvents).values({ ownerId: s.user.id, category: "settings", action: "exported", entityType: "backup", summary: `Made a full backup (${p.files.length} files)`, sensitive: false });
    return NextResponse.json(p, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[backup] portable build failed:", (e as Error).message);
    return NextResponse.json({ error: "Couldn't prepare the backup. Nothing was changed." }, { status: 500 });
  }
}
