import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { recurringEvents, notificationPreferences } from "@/db/schema";
import { ensureOccurrences } from "./ops/planning";
import { todayLocal } from "@/lib/time";

/**
 * Defaults from the PRD, created once when onboarding completes. Everything is editable.
 * Routines are not pre-created: the owner adds the ones she wants (templates make it one tap).
 * Nothing here invents personal data: no dates are logged, no fast balance is set.
 */
export async function seedDefaultsForOwner(ownerId: string, tz: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const ctx = { tx, ownerId, tz, source: "manual" as const, now: new Date() };
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
