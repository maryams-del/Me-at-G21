import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { routines, recurringEvents, notificationPreferences } from "@/db/schema";
import { ensureActivity } from "./ops/care";
import { ensureOccurrences } from "./ops/planning";
import { todayLocal } from "@/lib/time";

/**
 * Defaults from the PRD, created once when onboarding completes. Everything is editable.
 * Nothing here invents personal data: no dates are logged, no fast balance is set.
 */
export async function seedDefaultsForOwner(ownerId: string, tz: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const ctx = { tx, ownerId, tz, source: "manual" as const, now: new Date() };
    await ensureActivity(ctx, "waxing");
    await ensureActivity(ctx, "dental");

    const existing = await tx.select({ kind: routines.kind }).from(routines).where(eq(routines.ownerId, ownerId));
    const have = new Set(existing.map((r) => r.kind));
    const defs = [
      { kind: "toothbrush", name: "Replace toothbrush", anchor: "first_use", intervalValue: 3, intervalUnit: "month", reminderOffsetsDays: [-14, 0] },
      { kind: "brushes", name: "Clean makeup brushes", anchor: "completed", intervalValue: 7, intervalUnit: "day", reminderOffsetsDays: [-1, 0] },
      { kind: "bedsheets", name: "Change bedsheets", anchor: "completed", intervalValue: 7, intervalUnit: "day", reminderOffsetsDays: [0] },
    ] as const;
    for (const d of defs) {
      if (!have.has(d.kind)) await tx.insert(routines).values({ ownerId, ...d, reminderOffsetsDays: [...d.reminderOffsetsDays] });
    }

    const evs = await tx.select().from(recurringEvents).where(eq(recurringEvents.ownerId, ownerId));
    if (!evs.length) {
      const today = todayLocal(tz);
      const [cls] = await tx.insert(recurringEvents).values({
        ownerId, kind: "class", title: "Quran class", weekday: 7, localTime: "19:00", timezone: tz,
        startDate: today, reminderLeadMinutes: 60,
      }).returning();
      // Suggested, not active until the owner reviews it (PRD 4.16).
      await tx.insert(recurringEvents).values({
        ownerId, kind: "study", title: "Learn Quran translation", weekday: 6, localTime: "19:00", timezone: tz,
        startDate: today, reminderLeadMinutes: 0, paused: true, linkedEventId: cls.id,
        notes: "Suggested: Saturday 19:00, the day before class. Review and activate.",
      });
      await ensureOccurrences(ctx, cls.id);
    }
    await tx.insert(notificationPreferences).values({ ownerId }).onConflictDoNothing();
  });
}
