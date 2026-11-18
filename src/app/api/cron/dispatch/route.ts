import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { jobRuns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { dispatchDue, housekeeping } from "@/server/notify";
import { safeEqual } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called every minute by a scheduler (Vercel Cron on Pro, or any external cron on Hobby) with
 * `Authorization: Bearer <CRON_SECRET>`. Idempotent: overlapping or repeated calls never double-send.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const [run] = await db.insert(jobRuns).values({ job: "dispatch" }).returning({ id: jobRuns.id });
  try {
    const hk = await housekeeping();
    const stats = await dispatchDue();
    await db.update(jobRuns).set({ finishedAt: new Date(), stats: { ...stats, housekeeping: hk } }).where(eq(jobRuns.id, run.id));
    return NextResponse.json({ ok: true, ...stats });
  } catch (e) {
    await db.update(jobRuns).set({ finishedAt: new Date(), error: (e as Error).message.slice(0, 500) }).where(eq(jobRuns.id, run.id));
    console.error("[cron] dispatch failed", (e as Error).message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
export const GET = handle;
export const POST = handle;
