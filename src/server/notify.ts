import "server-only";
import * as webpushNs from "web-push";

// web-push is CommonJS: depending on the bundler it arrives as a namespace or under `.default`.
const webpush = ((webpushNs as unknown as { default?: typeof webpushNs }).default ?? webpushNs) as typeof webpushNs;
import { and, eq, inArray, isNull, lte, or, desc } from "drizzle-orm";
import { getDb } from "@/db";
import {
  reminders, notificationDeliveries, pushSubscriptions, notificationPreferences, users,
  recurringEvents, jobRuns, aiProposals, routines,
} from "@/db/schema";
import { sendEmail } from "./email";
import { ensureOccurrences } from "./ops/planning";
import { applyAnnualFastRules, syncRoutine } from "./ops/care";
import { instantToLocal, localToInstant, addDays } from "@/lib/time";

function configurePush() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:owner@example.com", pub, priv);
  return true;
}

/** If `at` falls in quiet hours (local), return the instant quiet hours end; else null. */
export function quietUntil(at: Date, tz: string, start: string | null, end: string | null): Date | null {
  if (!start || !end || start === end) return null;
  const { date, time } = instantToLocal(at, tz);
  const inQuiet = start < end ? time >= start && time < end : time >= start || time < end;
  if (!inQuiet) return null;
  const endDate = start < end || time < end ? date : addDays(date, 1);
  return localToInstant(endDate, end, tz);
}

type PushResult = { delivered: number; failed: number; errors: string[] };

export async function sendPushToOwner(ownerId: string, payload: { title: string; body: string; url: string; tag?: string }, attemptPrefix: string, reminderId?: string): Promise<PushResult> {
  const db = getDb();
  const out: PushResult = { delivered: 0, failed: 0, errors: [] };
  if (!configurePush()) { out.errors.push("Push is not configured on the server (VAPID keys)"); return out; }
  const subs = await db.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.ownerId, ownerId), isNull(pushSubscriptions.revokedAt)));
  for (const s of subs) {
    const attemptKey = `${attemptPrefix}:push:${s.id}`;
    if (reminderId) {
      // Claim this attempt first: a concurrent dispatcher (or retry) can't send it twice.
      const claimed = await db.insert(notificationDeliveries).values({ reminderId, channel: "push", subscriptionId: s.id, attemptKey, status: "pending" }).onConflictDoNothing().returning({ id: notificationDeliveries.id });
      if (!claimed.length) continue;
    }
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: "normal" });
      out.delivered++;
      await db.update(pushSubscriptions).set({ lastSuccessAt: new Date(), failedAt: null }).where(eq(pushSubscriptions.id, s.id));
      if (reminderId) await db.update(notificationDeliveries).set({ status: "delivered" }).where(eq(notificationDeliveries.attemptKey, attemptKey));
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      out.failed++;
      out.errors.push(status ? `Push service returned ${status}` : "Push send failed");
      // 404/410 = subscription is gone (app removed, permission revoked): stop using it.
      await db.update(pushSubscriptions).set(status === 404 || status === 410 ? { revokedAt: new Date(), failedAt: new Date() } : { failedAt: new Date() }).where(eq(pushSubscriptions.id, s.id));
      if (reminderId) await db.update(notificationDeliveries).set({ status: "failed", error: status ? `HTTP ${status}` : "send failed" }).where(eq(notificationDeliveries.attemptKey, attemptKey));
    }
  }
  return out;
}

/**
 * Deliver due reminders. Safe to call concurrently and repeatedly:
 *  - each reminder is claimed with a conditional UPDATE (scheduled → sent) so only one run sends it;
 *  - each channel attempt has a unique attempt key.
 */
export async function dispatchDue(now = new Date()) {
  const db = getDb();
  const due = await db.select({ r: reminders, u: users }).from(reminders)
    .innerJoin(users, eq(users.id, reminders.ownerId))
    .where(or(
      and(eq(reminders.status, "scheduled"), lte(reminders.fireAt, now)),
      and(eq(reminders.status, "snoozed"), lte(reminders.snoozedUntil, now)),
    ))
    .limit(200);
  const stats = { due: due.length, sent: 0, postponed: 0, push: 0, pushFailed: 0, email: 0, stale: 0 };
  for (const { r, u } of due) {
    const [prefs] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.ownerId, u.id));
    const effective = r.status === "snoozed" && r.snoozedUntil ? r.snoozedUntil : r.fireAt;
    // Very old reminders (e.g. scheduler was down for days) are shown in-app but not pushed.
    const stale = now.getTime() - effective.getTime() > 12 * 3600_000;
    const q = quietUntil(now, u.timezone, prefs?.quietStart ?? null, prefs?.quietEnd ?? null);
    if (q && !stale) {
      await db.update(reminders).set({ status: "snoozed", snoozedUntil: q, updatedAt: now }).where(and(eq(reminders.id, r.id), inArray(reminders.status, ["scheduled", "snoozed"])));
      stats.postponed++;
      continue;
    }
    const claimed = await db.update(reminders).set({ status: "sent", sentAt: now, updatedAt: now })
      .where(and(eq(reminders.id, r.id), inArray(reminders.status, ["scheduled", "snoozed"]))).returning({ id: reminders.id });
    if (!claimed.length) continue;
    stats.sent++;
    const prefix = `${r.id}:${effective.toISOString()}`;
    await db.insert(notificationDeliveries).values({ reminderId: r.id, channel: "in_app", attemptKey: `${prefix}:in_app`, status: "delivered" }).onConflictDoNothing();
    if (stale) { stats.stale++; continue; }
    const showDetail = !r.sensitive || prefs?.showSensitivePreviews;
    let pushOk = 0;
    if (prefs?.pushEnabled) {
      const res = await sendPushToOwner(u.id, {
        title: showDetail ? r.title : "Personal reminder",
        body: showDetail ? r.publicBody : "Open the app to see details",
        url: r.link ?? "/", tag: r.id,
      }, prefix, r.id);
      pushOk = res.delivered; stats.push += res.delivered; stats.pushFailed += res.failed;
    }
    if (prefs?.emailFallback && pushOk === 0) {
      const key = `${prefix}:email`;
      const claim = await db.insert(notificationDeliveries).values({ reminderId: r.id, channel: "email", attemptKey: key, status: "pending" }).onConflictDoNothing().returning({ id: notificationDeliveries.id });
      if (claim.length) {
        try {
          await sendEmail(u.email, showDetail ? `Reminder: ${r.title}` : "Personal reminder", `${showDetail ? r.publicBody : "You have a personal reminder."}\n\nOpen your dashboard: ${process.env.APP_ORIGIN ?? ""}${r.link ?? "/"}`);
          await db.update(notificationDeliveries).set({ status: "delivered" }).where(eq(notificationDeliveries.attemptKey, key));
          stats.email++;
        } catch (e) {
          await db.update(notificationDeliveries).set({ status: "failed", error: (e as Error).message.slice(0, 200) }).where(eq(notificationDeliveries.attemptKey, key));
        }
      }
    }
  }
  return stats;
}

/** Hourly-ish upkeep: materialise class occurrences, annual fast additions, overdue repeats, proposal expiry. */
export async function housekeeping(now = new Date(), force = false) {
  const db = getDb();
  const [last] = await db.select().from(jobRuns).where(eq(jobRuns.job, "housekeeping")).orderBy(desc(jobRuns.startedAt)).limit(1);
  if (!force && last && now.getTime() - last.startedAt.getTime() < 55 * 60_000) return { skipped: true };
  const [run] = await db.insert(jobRuns).values({ job: "housekeeping", startedAt: now }).returning({ id: jobRuns.id });
  const stats = { events: 0, fastAdditions: 0, expired: 0, routines: 0 };
  try {
    const owners = await db.select().from(users).where(eq(users.onboardingStep, "complete"));
    for (const u of owners) {
      await db.transaction(async (tx) => {
        const ctx = { tx, ownerId: u.id, tz: u.timezone, source: "manual" as const, now };
        const evs = await tx.select({ id: recurringEvents.id }).from(recurringEvents).where(eq(recurringEvents.ownerId, u.id));
        for (const e of evs) { await ensureOccurrences(ctx, e.id); stats.events++; }
        stats.fastAdditions += await applyAnnualFastRules(ctx);
        // idempotent: keeps every routine's reminders in step (also picks up routines migrated from the old waxing/dental pages)
        const rs = await tx.select({ id: routines.id }).from(routines).where(eq(routines.ownerId, u.id));
        for (const r of rs) { await syncRoutine(ctx, r.id); stats.routines++; }
      });
    }
    const exp = await db.update(aiProposals).set({ status: "expired" }).where(and(eq(aiProposals.status, "pending"), lte(aiProposals.expiresAt, now))).returning({ id: aiProposals.id });
    stats.expired = exp.length;
    await db.update(jobRuns).set({ finishedAt: new Date(), stats }).where(eq(jobRuns.id, run.id));
  } catch (e) {
    await db.update(jobRuns).set({ finishedAt: new Date(), error: (e as Error).message.slice(0, 500) }).where(eq(jobRuns.id, run.id));
    throw e;
  }
  return stats;
}

export async function lastDispatch() {
  const [r] = await getDb().select().from(jobRuns).where(eq(jobRuns.job, "dispatch")).orderBy(desc(jobRuns.startedAt)).limit(1);
  return r ?? null;
}

