import { eq, and, isNull, desc } from "drizzle-orm";
import { getDb } from "@/db";
import { notificationPreferences, pushSubscriptions, jobRuns } from "@/db/schema";
import { pageOwner } from "@/server/queries";
import { PageHeader } from "@/components/ui";
import { NotificationsClient } from "./NotificationsClient";

export default async function NotificationsPage() {
  const o = await pageOwner();
  const db = getDb();
  const [prefs] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.ownerId, o.id));
  const subs = await db.select({ id: pushSubscriptions.id, device: pushSubscriptions.deviceLabel, lastSuccessAt: pushSubscriptions.lastSuccessAt, failedAt: pushSubscriptions.failedAt, createdAt: pushSubscriptions.createdAt })
    .from(pushSubscriptions).where(and(eq(pushSubscriptions.ownerId, o.id), isNull(pushSubscriptions.revokedAt)));
  const [lastRun] = await db.select().from(jobRuns).where(eq(jobRuns.job, "dispatch")).orderBy(desc(jobRuns.startedAt)).limit(1);
  return (
    <>
      <PageHeader glyph="settings" title="Notifications" />
      <NotificationsClient
        vapidKey={process.env.VAPID_PUBLIC_KEY ?? ""}
        prefs={{ pushEnabled: prefs?.pushEnabled ?? false, emailFallback: prefs?.emailFallback ?? false, showSensitivePreviews: prefs?.showSensitivePreviews ?? false, quietStart: prefs?.quietStart ?? null, quietEnd: prefs?.quietEnd ?? null }}
        devices={subs.map((s) => ({ ...s, lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null, failedAt: s.failedAt?.toISOString() ?? null, createdAt: s.createdAt.toISOString() }))}
        scheduler={lastRun ? { at: lastRun.startedAt.toISOString(), ok: !lastRun.error } : null}
        emailConfigured={!!process.env.RESEND_API_KEY}
      />
    </>
  );
}
