/**
 * Reminder engine.
 *
 * Each source (waxing activity, routine, debt, task, class occurrence…) declares the full set of
 * reminders it currently wants. `syncReminders` reconciles that with the table:
 *   - wanted + missing        → inserted (unique (owner_id, dedupe_key) prevents duplicates)
 *   - wanted + scheduled      → fire time / text updated
 *   - scheduled + not wanted  → cancelled (e.g. old waxing schedule after a new completion)
 *   - already sent/dismissed  → left alone (history is never rewritten)
 * Reminders whose time has already passed are not created, so back-dated entries never
 * produce a burst of stale notifications; overdue state is shown on the dashboard instead.
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { reminders } from "@/db/schema";

export type DesiredReminder = {
  dedupeKey: string;
  fireAt: Date;
  title: string;
  publicBody: string;
  detailBody?: string;
  sensitive?: boolean;
  link?: string;
};

export async function syncReminders(
  tx: Tx, ownerId: string, sourceType: string, sourceId: string,
  desired: DesiredReminder[], now: Date = new Date(),
) {
  const future = desired.filter((r) => r.fireAt.getTime() > now.getTime() - 60_000);
  const keys = future.map((r) => r.dedupeKey);

  // Cancel pending reminders for this source that are no longer wanted.
  await tx.update(reminders)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(
      eq(reminders.ownerId, ownerId),
      eq(reminders.sourceType, sourceType),
      eq(reminders.sourceId, sourceId),
      inArray(reminders.status, ["scheduled", "snoozed"]),
      keys.length ? notInArray(reminders.dedupeKey, keys) : sql`true`,
    ));

  for (const r of future) {
    await tx.insert(reminders).values({
      ownerId, sourceType, sourceId,
      dedupeKey: r.dedupeKey, fireAt: r.fireAt, title: r.title,
      publicBody: r.publicBody, detailBody: r.detailBody ?? null,
      sensitive: r.sensitive ?? false, link: r.link ?? null,
    }).onConflictDoUpdate({
      target: [reminders.ownerId, reminders.dedupeKey],
      set: {
        fireAt: r.fireAt, title: r.title, publicBody: r.publicBody,
        detailBody: r.detailBody ?? null, sensitive: r.sensitive ?? false, link: r.link ?? null,
        status: sql`case when ${reminders.status} in ('scheduled','cancelled') then 'scheduled' else ${reminders.status} end`,
        updatedAt: new Date(),
      },
    });
  }
}

/** Cancel every pending reminder for a source (e.g. task completed, debt settled, routine paused). */
export async function cancelReminders(tx: Tx, ownerId: string, sourceType: string, sourceId: string) {
  await syncReminders(tx, ownerId, sourceType, sourceId, []);
}
