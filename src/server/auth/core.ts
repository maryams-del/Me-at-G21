import "server-only";
import { cookies, headers } from "next/headers";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { authSessions, users, accountSecurityEvents, rateLimits } from "@/db/schema";
import { env } from "@/lib/env";
import { randomToken, verifier } from "@/lib/crypto";
import { sendEmail } from "../email";

export const SESSION_COOKIE = "ld_session";
const SESSION_DAYS = 30;
const IDLE_DAYS = 7;
export const STEP_UP_MINUTES = 10;
export const RECOVERY_LOCK_HOURS = 24;

export type SessionUser = {
  sessionId: string;
  method: "passkey" | "recovery" | "onboarding";
  stepUpAt: Date | null;
  createdAt: Date;
  user: typeof users.$inferSelect;
};

const tokenVerifier = (t: string) => verifier(t, env.pepper, "session");

export async function createSession(userId: string, method: SessionUser["method"]) {
  const token = randomToken(32);
  const h = await headers();
  const now = new Date();
  const ua = h.get("user-agent")?.slice(0, 300) ?? null;
  await getDb().insert(authSessions).values({
    userId, tokenHash: tokenVerifier(token), method, userAgent: ua, deviceLabel: deviceLabelFromUA(ua),
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 86400_000),
    stepUpAt: method === "passkey" ? now : null, // a fresh passkey sign-in counts as step-up
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: env.secureCookies, sameSite: "lax", path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const now = new Date();
  const rows = await getDb().select({ s: authSessions, u: users }).from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(and(eq(authSessions.tokenHash, tokenVerifier(token)), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, now)));
  const row = rows[0];
  if (!row) return null;
  if (now.getTime() - row.s.lastSeenAt.getTime() > IDLE_DAYS * 86400_000) {
    await getDb().update(authSessions).set({ revokedAt: now }).where(eq(authSessions.id, row.s.id));
    return null;
  }
  if (now.getTime() - row.s.lastSeenAt.getTime() > 5 * 60_000) {
    await getDb().update(authSessions).set({ lastSeenAt: now }).where(eq(authSessions.id, row.s.id));
  }
  return { sessionId: row.s.id, method: row.s.method as SessionUser["method"], stepUpAt: row.s.stepUpAt, createdAt: row.s.createdAt, user: row.u };
}

/** Full app access requires a completed onboarding and a non-onboarding session. */
export async function requireUser(): Promise<SessionUser> {
  const s = await getSession();
  if (!s || s.method === "onboarding" || s.user.onboardingStep !== "complete") throw new AuthError(401, "Sign in required");
  return s;
}

export function hasFreshStepUp(s: SessionUser) {
  return !!s.stepUpAt && Date.now() - s.stepUpAt.getTime() < STEP_UP_MINUTES * 60_000;
}

/** Sensitive credential changes: need fresh passkey verification and are locked for a while after recovery. */
export function assertSensitiveAllowed(s: SessionUser) {
  if (s.method === "recovery" && Date.now() - s.createdAt.getTime() < RECOVERY_LOCK_HOURS * 3600_000) {
    throw new AuthError(403, `For your safety, removing sign-in methods is locked for ${RECOVERY_LOCK_HOURS} hours after account recovery. You can add a new passkey and sign out other devices now.`);
  }
  if (!hasFreshStepUp(s)) throw new AuthError(403, "step_up_required");
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export class AuthError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function securityEvent(userId: string | null, type: string, detail: Record<string, unknown> = {}, notify = false) {
  const h = await headers();
  await getDb().insert(accountSecurityEvents).values({
    userId, type, detail, ip: clientIp(h), userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  });
  if (notify && userId) {
    const [u] = await getDb().select().from(users).where(eq(users.id, userId));
    if (u) {
      await sendEmail(u.email, `Security alert: ${humanEvent(type)}`,
        `This is an automatic security notice from your Me @ G21.\n\nEvent: ${humanEvent(type)}\nTime: ${new Date().toISOString()}\nDevice: ${deviceLabelFromUA(h.get("user-agent"))}\n\nIf this wasn't you, sign in with a passkey, review Settings → Security, revoke unknown devices and rotate your recovery codes.`)
        .catch((e) => console.error("security email failed", (e as Error).message));
    }
  }
}

const EVENT_LABELS: Record<string, string> = {
  passkey_added: "A new passkey was added", passkey_removed: "A passkey was removed",
  totp_added: "An authenticator app was set up", totp_removed: "Your authenticator app was removed",
  recovery_codes_rotated: "Your recovery codes were replaced", account_recovered: "Your account was recovered on a device",
  recovery_code_used: "A recovery code was used", sessions_revoked: "Devices were signed out",
};
const humanEvent = (t: string) => EVENT_LABELS[t] ?? t.replace(/_/g, " ");

function clientIp(h: Headers) {
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
}

export function deviceLabelFromUA(ua: string | null | undefined) {
  if (!ua) return "Unknown device";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}

/**
 * Fixed-window rate limit stored in Postgres (works across serverless instances).
 * Returns false when the limit is exceeded.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await getDb().insert(rateLimits).values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} = ${windowStart.toISOString()}::timestamptz then ${rateLimits.count} + 1 else 1 end`,
        windowStart,
      },
    }).returning({ count: rateLimits.count });
  return row.count <= limit;
}

export async function ipKey() {
  return clientIp(await headers()) ?? "unknown";
}

/** CSRF defence for JSON mutations: same-origin check on top of SameSite=Lax cookies. */
export async function assertSameOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  if (!origin || origin !== env.origin) throw new AuthError(403, "Cross-origin request refused");
}
