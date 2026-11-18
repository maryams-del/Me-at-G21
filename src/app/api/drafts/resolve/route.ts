import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { captureDrafts } from "@/db/schema";
import { requireUser } from "@/server/auth/core";
import { runOpInTx } from "@/server/ops";
import { audit } from "@/server/audit";
import { json } from "@/server/http";
import { UserError } from "@/server/audit";

/** Finish a Needs-Details draft: the owner submits the completed form → op runs → draft resolved, atomically. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return json(async () => {
    const s = await requireUser();
    const { id, input } = z.object({ id: z.string().uuid(), input: z.record(z.string(), z.unknown()) }).parse(body);
    return getDb().transaction(async (tx) => {
      const [d] = await tx.select().from(captureDrafts).where(and(eq(captureDrafts.id, id), eq(captureDrafts.ownerId, s.user.id), eq(captureDrafts.status, "open"))).for("update");
      if (!d) throw new UserError("Draft not found or already finished");
      const base = { ownerId: s.user.id, tz: s.user.timezone, source: "manual" as const, now: new Date() };
      const res = await runOpInTx(tx, base, d.action, input);
      await tx.update(captureDrafts).set({ status: "resolved", resolvedEntityId: res.id, updatedAt: new Date() }).where(eq(captureDrafts.id, d.id));
      await audit({ ...base, tx }, "inbox", "resolved", "capture_draft", d.id, `Finished draft: ${res.message}`);
      return { ok: true, message: res.message };
    });
  });
}
