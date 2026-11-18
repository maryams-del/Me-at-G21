import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { reminders } from "@/db/schema";
import { requireUser } from "@/server/auth/core";
import { json } from "@/server/http";

/** Reminder state only — never touches the underlying completed-event history. */
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const body = await req.json().catch(() => ({}));
  return json(async () => {
    const s = await requireUser();
    const { id, minutes } = z.object({ id: z.string().uuid(), minutes: z.number().int().min(5).max(7 * 24 * 60).optional() }).parse(body);
    const where = and(eq(reminders.id, id), eq(reminders.ownerId, s.user.id));
    const now = new Date();
    if (action === "dismiss") {
      await getDb().update(reminders).set({ status: "dismissed", updatedAt: now }).where(and(where, inArray(reminders.status, ["sent", "scheduled", "snoozed"])));
      return { ok: true };
    }
    if (action === "snooze") {
      await getDb().update(reminders).set({ status: "snoozed", snoozedUntil: new Date(now.getTime() + (minutes ?? 60) * 60_000), updatedAt: now }).where(and(where, inArray(reminders.status, ["sent", "scheduled", "snoozed"])));
      return { ok: true };
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  });
}
