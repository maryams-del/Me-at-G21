import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { pushSubscriptions, notificationPreferences } from "@/db/schema";
import { requireUser, deviceLabelFromUA } from "@/server/auth/core";
import { sendPushToOwner } from "@/server/notify";
import { json } from "@/server/http";

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const body = await req.json().catch(() => ({}));
  return json(async () => {
    const s = await requireUser();
    const db = getDb();
    if (action === "subscribe") {
      const sub = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }).parse(body);
      const ua = (await headers()).get("user-agent");
      await db.insert(pushSubscriptions).values({ ownerId: s.user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: ua?.slice(0, 300), deviceLabel: deviceLabelFromUA(ua) })
        .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { ownerId: s.user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth, revokedAt: null, failedAt: null } });
      await db.insert(notificationPreferences).values({ ownerId: s.user.id, pushEnabled: true }).onConflictDoUpdate({ target: notificationPreferences.ownerId, set: { pushEnabled: true } });
      return { ok: true };
    }
    if (action === "unsubscribe") {
      const { endpoint } = z.object({ endpoint: z.string().url() }).parse(body);
      await db.update(pushSubscriptions).set({ revokedAt: new Date() }).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.ownerId, s.user.id)));
      return { ok: true };
    }
    if (action === "test") {
      const res = await sendPushToOwner(s.user.id, { title: "Test reminder", body: "Push notifications are working on this device.", url: "/settings/notifications" }, `test:${Date.now()}`);
      return { ...res, message: res.delivered ? `Sent to ${res.delivered} device${res.delivered === 1 ? "" : "s"} — check that it arrived.` : res.errors[0] ?? "No subscribed devices" };
    }
    if (action === "prefs") {
      const p = z.object({
        pushEnabled: z.boolean(), emailFallback: z.boolean(), showSensitivePreviews: z.boolean(),
        quietStart: z.string().regex(/^\d{2}:\d{2}$/).nullable(), quietEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
      }).parse(body);
      await db.insert(notificationPreferences).values({ ownerId: s.user.id, ...p }).onConflictDoUpdate({ target: notificationPreferences.ownerId, set: { ...p, updatedAt: new Date() } });
      return { ok: true };
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  });
}
