import "server-only";
import { starterSettings } from "@/lib/starter";
import { inviteTokensOf } from "@/lib/invites";
import { z } from "zod";
import { and, desc, eq, gt, lt, isNull, ne, sql, count } from "drizzle-orm";
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import {
  users, notificationPreferences, authSessions, passkeyCredentials, webauthnChallenges, totpAuthenticators,
  accountRecoveryCodeVerifiers, emailVerifications, accountSecurityEvents,
} from "@/db/schema";
import { env } from "@/lib/env";
import { decryptField, encryptField, normalizeRecoveryCode, numericCode, randomToken, recoveryCode, safeEqual, verifier } from "@/lib/crypto";
import { sendEmail } from "../email";
import {
  AuthError, assertSensitiveAllowed, clearSessionCookie, createSession, getSession, ipKey,
  rateLimit, requireUser, securityEvent, type SessionUser,
} from "./core";
import { seedDefaultsForOwner } from "../defaults";
import { mayEnroll } from "./invites";

const CHALLENGE_COOKIE = "ld_chal";
const RP_NAME = "Me @ G21";
const GENERIC_SENT = { ok: true, message: "If this address is allowed, we've sent a 6-digit code. It expires in 10 minutes." };

type Handler = (body: unknown) => Promise<unknown>;

/* ───────────── helpers ───────────── */

async function issueEmailCode(email: string, purpose: "enroll" | "recovery") {
  const code = numericCode();
  await getDb().insert(emailVerifications).values({
    email, purpose, codeHash: verifier(code, env.pepper, `email:${purpose}:${email}`),
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  await sendEmail(email, purpose === "enroll" ? "Your Me @ G21 verification code" : "Your account recovery code",
    `Your one-time code is ${code}\n\nIt expires in 10 minutes and can be used once. ${purpose === "recovery"
      ? "This code alone cannot sign you in — you'll also need your authenticator app or one of your offline recovery codes. If you didn't request this, someone may know your email; your account is still protected."
      : "You requested this to set up your private Me @ G21."}`);
}

async function consumeEmailCode(email: string, purpose: "enroll" | "recovery", code: string) {
  const [row] = await getDb().select().from(emailVerifications)
    .where(and(eq(emailVerifications.email, email), eq(emailVerifications.purpose, purpose), isNull(emailVerifications.consumedAt), gt(emailVerifications.expiresAt, new Date())))
    .orderBy(desc(emailVerifications.createdAt)).limit(1);
  if (!row || row.attempts >= 5) return false;
  await getDb().update(emailVerifications).set({ attempts: row.attempts + 1 }).where(eq(emailVerifications.id, row.id));
  if (!safeEqual(row.codeHash, verifier(code.trim(), env.pepper, `email:${purpose}:${email}`))) return false;
  await getDb().update(emailVerifications).set({ consumedAt: new Date() }).where(eq(emailVerifications.id, row.id));
  return true;
}

async function storeChallenge(userId: string | null, purpose: string, challenge: string) {
  const [row] = await getDb().insert(webauthnChallenges).values({ userId, purpose, challenge, expiresAt: new Date(Date.now() + 5 * 60_000) }).returning({ id: webauthnChallenges.id });
  (await cookies()).set(CHALLENGE_COOKIE, row.id, { httpOnly: true, secure: env.secureCookies, sameSite: "strict", path: "/api/auth", maxAge: 300 });
}

async function takeChallenge(purpose: string) {
  const jar = await cookies();
  const id = jar.get(CHALLENGE_COOKIE)?.value;
  jar.delete(CHALLENGE_COOKIE);
  if (!id || !z.string().uuid().safeParse(id).success) throw new AuthError(400, "Challenge expired, please try again");
  const [row] = await getDb().update(webauthnChallenges).set({ usedAt: new Date() })
    .where(and(eq(webauthnChallenges.id, id), eq(webauthnChallenges.purpose, purpose), isNull(webauthnChallenges.usedAt), gt(webauthnChallenges.expiresAt, new Date())))
    .returning();
  if (!row) throw new AuthError(400, "Challenge expired, please try again");
  return row;
}

async function activePasskeys(userId: string) {
  return getDb().select().from(passkeyCredentials).where(and(eq(passkeyCredentials.userId, userId), isNull(passkeyCredentials.revokedAt)));
}

async function activeTotp(userId: string) {
  const [t] = await getDb().select().from(totpAuthenticators)
    .where(and(eq(totpAuthenticators.userId, userId), isNull(totpAuthenticators.revokedAt), sql`${totpAuthenticators.verifiedAt} is not null`));
  return t ?? null;
}

/** Verify a TOTP code with ±1 step drift tolerance and replay protection. */
async function checkTotp(t: typeof totpAuthenticators.$inferSelect, code: string) {
  const secret = decryptField(t.secretEnc, env.dataKey, `totp:${t.userId}`);
  const res = verifySync({ secret, token: code.replace(/\s/g, ""), epochTolerance: 30, ...(t.lastTimeStep ? { afterTimeStep: t.lastTimeStep } : {}) });
  if (!res.valid) return false;
  const step = (res as { timeStep?: number }).timeStep;
  if (step) await getDb().update(totpAuthenticators).set({ lastTimeStep: step }).where(eq(totpAuthenticators.id, t.id));
  return true;
}

async function sessionFor(allowOnboarding: boolean): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new AuthError(401, "Sign in required");
  if (!allowOnboarding && (s.method === "onboarding" || s.user.onboardingStep !== "complete")) throw new AuthError(401, "Finish setup first");
  return s;
}

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

/* ───────────── enrollment ───────────── */

const enrollStart: Handler = async (body) => {
  const { email } = emailSchema.parse(body);
  if (!(await rateLimit(`enroll:${await ipKey()}`, 5, 3600))) throw new AuthError(429, "Too many attempts. Try again later.");
  const [existing] = await getDb().select().from(users).where(eq(users.email, email));
  // The owner (OWNER_EMAIL) and people the owner has invited may create an account, once each.
  if ((await mayEnroll(email)) && (!existing || existing.onboardingStep !== "complete")) {
    await issueEmailCode(email, "enroll");
  }
  return GENERIC_SENT;
};

const enrollVerify: Handler = async (body) => {
  const { email, code } = emailSchema.extend({ code: z.string().regex(/^\d{6}$/) }).parse(body);
  if (!(await rateLimit(`enroll-verify:${await ipKey()}`, 10, 3600))) throw new AuthError(429, "Too many attempts. Try again later.");
  if (!(await mayEnroll(email)) || !(await consumeEmailCode(email, "enroll", code))) throw new AuthError(400, "That code is invalid or expired");
  let [u] = await getDb().select().from(users).where(eq(users.email, email));
  if (u?.onboardingStep === "complete") throw new AuthError(400, "This account is already set up. Sign in instead.");
  if (!u) {
    // Invited people start with the basic spaces; the site owner gets everything.
    const settings = email.trim().toLowerCase() === env.ownerEmail ? undefined : starterSettings();
    [u] = await getDb().insert(users).values({ email, emailVerifiedAt: new Date(), onboardingStep: "passkey", ...(settings ? { settings } : {}) }).returning();
  } else {
    await getDb().update(users).set({ emailVerifiedAt: new Date(), onboardingStep: u.onboardingStep === "email" ? "passkey" : u.onboardingStep }).where(eq(users.id, u.id));
  }
  await createSession(u.id, "onboarding");
  await securityEvent(u.id, "email_verified");
  return { ok: true };
};

/** Opening a one-time invite link: proves the invite came from the owner, so no email code is needed. */
const inviteRedeem: Handler = async (body) => {
  const { invite } = z.object({ invite: z.string().min(10).max(400) }).parse(body);
  if (!(await rateLimit(`invite-redeem:${await ipKey()}`, 20, 3600))) throw new AuthError(429, "Too many attempts. Try again later.");
  const bad = () => new AuthError(400, "This invite link isn't valid any more. Ask for a new one.");
  const dot = invite.indexOf(".");
  if (dot < 1) throw bad();
  let email: string;
  try { email = Buffer.from(invite.slice(0, dot), "base64url").toString("utf8").trim().toLowerCase(); } catch { throw bad(); }
  const token = invite.slice(dot + 1);
  const [owner] = await getDb().select({ id: users.id, settings: users.settings }).from(users).where(eq(users.email, env.ownerEmail));
  const settings = (owner?.settings ?? {}) as Record<string, unknown>;
  const entry = inviteTokensOf(settings)[email];
  if (!owner || !entry || entry.exp < Date.now() || !(await mayEnroll(email)) || !safeEqual(entry.h, verifier(token, env.pepper, `invite:${email}`))) throw bad();
  let [u] = await getDb().select().from(users).where(eq(users.email, email));
  if (u?.onboardingStep === "complete") throw new AuthError(400, "This account is already set up. Sign in instead.");
  // Single use.
  const rest = Object.fromEntries(Object.entries(inviteTokensOf(settings)).filter(([e]) => e !== email));
  await getDb().update(users).set({ settings: { ...settings, inviteTokens: rest } }).where(eq(users.id, owner.id));
  if (!u) [u] = await getDb().insert(users).values({ email, emailVerifiedAt: new Date(), onboardingStep: "passkey", settings: starterSettings() }).returning();
  else await getDb().update(users).set({ emailVerifiedAt: new Date(), onboardingStep: u.onboardingStep === "email" ? "passkey" : u.onboardingStep }).where(eq(users.id, u.id));
  await createSession(u.id, "onboarding");
  await securityEvent(u.id, "email_verified");
  return { ok: true, email };
};

const enrollProfile: Handler = async (body) => {
  const s = await sessionFor(true);
  const { displayName } = z.object({ displayName: z.string().trim().min(1).max(60) }).parse(body);
  await getDb().update(users).set({ displayName, updatedAt: new Date() }).where(eq(users.id, s.user.id));
  return { ok: true };
};

/* ───────────── passkeys ───────────── */

const passkeyRegisterOptions: Handler = async () => {
  const s = await sessionFor(true);
  if (s.method !== "onboarding" && s.method !== "recovery") {
    // Adding a passkey from a normal session needs a fresh step-up.
    if (!s.stepUpAt || Date.now() - s.stepUpAt.getTime() > 10 * 60_000) throw new AuthError(403, "step_up_required");
  }
  const existing = await activePasskeys(s.user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID: env.rpId, userName: s.user.email, userDisplayName: s.user.displayName ?? s.user.email,
    userID: new TextEncoder().encode(s.user.id),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports ?? undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  await storeChallenge(s.user.id, "register", options.challenge);
  return options;
};

const passkeyRegisterVerify: Handler = async (body) => {
  const s = await sessionFor(true);
  const { response, nickname } = z.object({ response: z.any(), nickname: z.string().trim().max(60).optional() }).parse(body);
  const chal = await takeChallenge("register");
  if (chal.userId !== s.user.id) throw new AuthError(400, "Challenge mismatch");
  const v = await verifyRegistrationResponse({
    response, expectedChallenge: chal.challenge, expectedOrigin: env.origin, expectedRPID: env.rpId, requireUserVerification: true,
  });
  if (!v.verified) throw new AuthError(400, "Passkey could not be verified");
  const { credential, credentialDeviceType, credentialBackedUp, aaguid } = v.registrationInfo;
  await getDb().insert(passkeyCredentials).values({
    userId: s.user.id, credentialId: credential.id, publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter, transports: credential.transports ?? null, deviceType: credentialDeviceType,
    backedUp: credentialBackedUp, aaguid, nickname: nickname || defaultNickname(credentialDeviceType, credentialBackedUp),
  });
  if (s.user.onboardingStep === "passkey") await getDb().update(users).set({ onboardingStep: "totp" }).where(eq(users.id, s.user.id));
  await securityEvent(s.user.id, "passkey_added", { deviceType: credentialDeviceType, backedUp: credentialBackedUp }, s.user.onboardingStep === "complete");
  return { ok: true, synced: credentialBackedUp };
};

function defaultNickname(deviceType: string, backedUp: boolean) {
  return backedUp ? "Synced passkey" : deviceType === "singleDevice" ? "Device-bound passkey" : "Passkey";
}

const loginOptions: Handler = async () => {
  if (!(await rateLimit(`login-opt:${await ipKey()}`, 30, 600))) throw new AuthError(429, "Too many attempts");
  const options = await generateAuthenticationOptions({ rpID: env.rpId, userVerification: "required" });
  await storeChallenge(null, "login", options.challenge);
  return options;
};

async function verifyAssertion(response: { id: string } & Record<string, unknown>, purpose: "login" | "stepup", expectedUserId?: string) {
  const chal = await takeChallenge(purpose);
  const [cred] = await getDb().select().from(passkeyCredentials).where(and(eq(passkeyCredentials.credentialId, String(response.id)), isNull(passkeyCredentials.revokedAt)));
  if (!cred || (expectedUserId && cred.userId !== expectedUserId)) throw new AuthError(400, "This passkey isn't registered for this account");
  const v = await verifyAuthenticationResponse({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response: response as any, expectedChallenge: chal.challenge, expectedOrigin: env.origin, expectedRPID: env.rpId,
    requireUserVerification: true,
    credential: { id: cred.credentialId, publicKey: Buffer.from(cred.publicKey, "base64url"), counter: cred.counter, transports: cred.transports ?? undefined },
  });
  if (!v.verified) throw new AuthError(400, "Passkey verification failed");
  await getDb().update(passkeyCredentials).set({ counter: v.authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(passkeyCredentials.id, cred.id));
  return cred;
}

const loginVerify: Handler = async (body) => {
  const { response } = z.object({ response: z.object({ id: z.string().max(1024) }).passthrough() }).parse(body);
  if (!(await rateLimit(`login:${await ipKey()}`, 20, 600))) throw new AuthError(429, "Too many attempts");
  const cred = await verifyAssertion(response, "login");
  const [u] = await getDb().select().from(users).where(eq(users.id, cred.userId));
  await createSession(u.id, u.onboardingStep === "complete" ? "passkey" : "onboarding");
  await securityEvent(u.id, "signed_in", { method: "passkey" });
  return { ok: true, next: u.onboardingStep === "complete" ? "/" : "/onboarding" };
};

const stepUpOptions: Handler = async () => {
  const s = await sessionFor(true);
  const creds = await activePasskeys(s.user.id);
  const options = await generateAuthenticationOptions({
    rpID: env.rpId, userVerification: "required",
    allowCredentials: creds.map((c) => ({ id: c.credentialId, transports: c.transports ?? undefined })),
  });
  await storeChallenge(s.user.id, "stepup", options.challenge);
  return options;
};

const stepUpVerify: Handler = async (body) => {
  const s = await sessionFor(true);
  const { response } = z.object({ response: z.object({ id: z.string().max(1024) }).passthrough() }).parse(body);
  await verifyAssertion(response, "stepup", s.user.id);
  await getDb().update(authSessions).set({ stepUpAt: new Date() }).where(eq(authSessions.id, s.sessionId));
  return { ok: true };
};

const passkeyRemove: Handler = async (body) => {
  const s = await requireUser();
  assertSensitiveAllowed(s);
  const { id } = z.object({ id: z.string().uuid() }).parse(body);
  const creds = await activePasskeys(s.user.id);
  if (!creds.some((c) => c.id === id)) throw new AuthError(404, "Passkey not found");
  if (creds.length <= 1) throw new AuthError(400, "You can't remove your only passkey. Add another first.");
  await getDb().update(passkeyCredentials).set({ revokedAt: new Date() }).where(and(eq(passkeyCredentials.id, id), eq(passkeyCredentials.userId, s.user.id)));
  await securityEvent(s.user.id, "passkey_removed", { id }, true);
  return { ok: true };
};

const passkeyRename: Handler = async (body) => {
  const s = await requireUser();
  const { id, nickname } = z.object({ id: z.string().uuid(), nickname: z.string().trim().min(1).max(60) }).parse(body);
  await getDb().update(passkeyCredentials).set({ nickname }).where(and(eq(passkeyCredentials.id, id), eq(passkeyCredentials.userId, s.user.id)));
  return { ok: true };
};

/* ───────────── TOTP ───────────── */

const totpSetup: Handler = async () => {
  const s = await sessionFor(true);
  if (s.user.onboardingStep === "complete") assertSensitiveAllowed(s);
  else if (s.user.onboardingStep !== "totp") throw new AuthError(400, "Register a passkey first");
  const secret = generateSecret({ length: 20 });
  // Clean up only stale, never-verified setups. Concurrent setups each keep their own pending row.
  await getDb().delete(totpAuthenticators).where(and(eq(totpAuthenticators.userId, s.user.id), isNull(totpAuthenticators.verifiedAt), lt(totpAuthenticators.createdAt, new Date(Date.now() - 3600_000))));
  const [row] = await getDb().insert(totpAuthenticators).values({ userId: s.user.id, secretEnc: encryptField(secret, env.dataKey, `totp:${s.user.id}`) }).returning({ id: totpAuthenticators.id });
  const uri = generateURI({ issuer: RP_NAME, label: s.user.email, secret });
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  // The secret is returned once for manual entry; it is never logged or stored in plaintext.
  return { id: row.id, qr, secret: secret.match(/.{1,4}/g)!.join(" ") };
};

const totpVerify: Handler = async (body) => {
  const s = await sessionFor(true);
  const { id, code } = z.object({ id: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).parse(body);
  if (!(await rateLimit(`totp-verify:${s.user.id}`, 10, 600))) throw new AuthError(429, "Too many attempts");
  const [t] = await getDb().select().from(totpAuthenticators).where(and(eq(totpAuthenticators.id, id), eq(totpAuthenticators.userId, s.user.id), isNull(totpAuthenticators.verifiedAt)));
  if (!t || !(await checkTotp(t, code))) throw new AuthError(400, "That code didn't match. Check the time on your phone and try the newest code.");
  // Replace any previous authenticator only after the new one is proven.
  await getDb().update(totpAuthenticators).set({ revokedAt: new Date() }).where(and(eq(totpAuthenticators.userId, s.user.id), ne(totpAuthenticators.id, t.id), isNull(totpAuthenticators.revokedAt)));
  await getDb().update(totpAuthenticators).set({ verifiedAt: new Date() }).where(eq(totpAuthenticators.id, t.id));
  await getDb().delete(totpAuthenticators).where(and(eq(totpAuthenticators.userId, s.user.id), isNull(totpAuthenticators.verifiedAt)));
  if (s.user.onboardingStep === "totp") await getDb().update(users).set({ onboardingStep: "recovery_codes" }).where(eq(users.id, s.user.id));
  await securityEvent(s.user.id, "totp_added", {}, s.user.onboardingStep === "complete");
  return { ok: true };
};

const totpRemove: Handler = async () => {
  const s = await requireUser();
  assertSensitiveAllowed(s);
  await getDb().update(totpAuthenticators).set({ revokedAt: new Date() }).where(and(eq(totpAuthenticators.userId, s.user.id), isNull(totpAuthenticators.revokedAt)));
  await securityEvent(s.user.id, "totp_removed", {}, true);
  return { ok: true };
};

/* ───────────── recovery codes ───────────── */

const recoveryCodesGenerate: Handler = async () => {
  const s = await sessionFor(true);
  if (s.user.onboardingStep === "complete") assertSensitiveAllowed(s);
  else if (s.user.onboardingStep !== "recovery_codes") throw new AuthError(400, "Finish the earlier setup steps first");
  const codes = Array.from({ length: 10 }, recoveryCode);
  const batchId = crypto.randomUUID();
  await getDb().transaction(async (tx) => {
    await tx.update(accountRecoveryCodeVerifiers).set({ invalidatedAt: new Date() })
      .where(and(eq(accountRecoveryCodeVerifiers.userId, s.user.id), isNull(accountRecoveryCodeVerifiers.invalidatedAt)));
    await tx.insert(accountRecoveryCodeVerifiers).values(codes.map((c, i) => ({
      userId: s.user.id, batchId, position: i + 1, verifier: verifier(c, env.pepper, `recovery:${s.user.id}`),
    })));
  });
  if (s.user.onboardingStep === "complete") await securityEvent(s.user.id, "recovery_codes_rotated", {}, true);
  // Shown exactly once. Never emailed, texted, logged or stored in plaintext.
  return { codes, generatedAt: new Date().toISOString() };
};

const onboardingComplete: Handler = async (body) => {
  const s = await sessionFor(true);
  z.object({ savedCodes: z.literal(true) }).parse(body);
  if (s.user.onboardingStep !== "recovery_codes") throw new AuthError(400, "Finish the earlier setup steps first");
  const [{ n }] = await getDb().select({ n: count() }).from(accountRecoveryCodeVerifiers).where(and(eq(accountRecoveryCodeVerifiers.userId, s.user.id), isNull(accountRecoveryCodeVerifiers.invalidatedAt)));
  if (!n) throw new AuthError(400, "Generate your recovery codes first");
  await getDb().update(users).set({ onboardingStep: "complete" }).where(eq(users.id, s.user.id));
  const isSiteOwner = s.user.email.trim().toLowerCase() === env.ownerEmail;
  // The Quran class schedule is the site owner's own; invited people start without it.
  if (isSiteOwner) await seedDefaultsForOwner(s.user.id, s.user.timezone);
  else {
    await getDb().insert(notificationPreferences).values({ ownerId: s.user.id }).onConflictDoNothing();
    // Let the site owner know someone they invited has finished signing up.
    try {
      const [{ n: total }] = await getDb().select({ n: count() }).from(users).where(and(eq(users.onboardingStep, "complete"), ne(users.email, env.ownerEmail)));
      await sendEmail(env.ownerEmail, `${s.user.email} signed up to Me @ G21`,
        `${s.user.email} has finished setting up their account.\n\n${total} ${total === 1 ? "person has" : "people have"} signed up so far. See everyone in Settings › People: ${env.origin}/settings`);
    } catch { /* the sign-up still counts even if the email doesn't send */ }
  }
  // Replace the onboarding session with a full one (passkey was just proven during setup).
  await getDb().update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.id, s.sessionId));
  await createSession(s.user.id, "passkey");
  await securityEvent(s.user.id, "onboarding_complete");
  return { ok: true };
};

/* ───────────── lost-device recovery: verified email + one independent factor ───────────── */

const recoveryStart: Handler = async (body) => {
  const { email } = emailSchema.parse(body);
  if (!(await rateLimit(`recovery-start:${await ipKey()}`, 5, 3600)) || !(await rateLimit(`recovery-start:${email}`, 5, 3600))) {
    throw new AuthError(429, "Too many attempts. Try again in an hour.");
  }
  const [u] = await getDb().select().from(users).where(eq(users.email, email));
  if (u?.onboardingStep === "complete") await issueEmailCode(email, "recovery");
  return GENERIC_SENT;
};

const recoveryVerify: Handler = async (body) => {
  const { email, emailCode, factor, value } = emailSchema.extend({
    emailCode: z.string().regex(/^\d{6}$/), factor: z.enum(["totp", "recovery_code"]), value: z.string().trim().min(6).max(40),
  }).parse(body);
  if (!(await rateLimit(`recovery-verify:${await ipKey()}`, 10, 3600)) || !(await rateLimit(`recovery-verify:${email}`, 10, 86400))) {
    throw new AuthError(429, "Too many attempts. Recovery is temporarily locked; try again later.");
  }
  const fail = async (reason: string) => {
    await securityEvent(null, "recovery_failed", { reason });
    return new AuthError(400, "Recovery details didn't match. Check the email code and your second factor.");
  };
  const [u] = await getDb().select().from(users).where(eq(users.email, email));
  if (!u || u.onboardingStep !== "complete") throw await fail("no_user");
  if (!(await consumeEmailCode(email, "recovery", emailCode))) throw await fail("email_code");

  let usedCodeId: string | null = null;
  if (factor === "totp") {
    const t = await activeTotp(u.id);
    if (!t || !(await checkTotp(t, value))) throw await fail("totp");
  } else {
    const v = verifier(normalizeRecoveryCode(value), env.pepper, `recovery:${u.id}`);
    const [row] = await getDb().update(accountRecoveryCodeVerifiers).set({ usedAt: new Date() })
      .where(and(eq(accountRecoveryCodeVerifiers.userId, u.id), eq(accountRecoveryCodeVerifiers.verifier, v), isNull(accountRecoveryCodeVerifiers.usedAt), isNull(accountRecoveryCodeVerifiers.invalidatedAt)))
      .returning({ id: accountRecoveryCodeVerifiers.id });
    if (!row) throw await fail("recovery_code");
    usedCodeId = row.id;
  }
  await createSession(u.id, "recovery");
  if (usedCodeId) await securityEvent(u.id, "recovery_code_used", {}, false);
  await securityEvent(u.id, "account_recovered", { factor }, true);
  return { ok: true, next: "/settings/security?recovered=1" };
};

/* ───────────── sessions & inventory ───────────── */

const securityOverview: Handler = async () => {
  const s = await requireUser();
  const db = getDb();
  const [passkeys, totp, codes, sessions, events] = await Promise.all([
    activePasskeys(s.user.id),
    activeTotp(s.user.id),
    db.select({ used: accountRecoveryCodeVerifiers.usedAt, pos: accountRecoveryCodeVerifiers.position, at: accountRecoveryCodeVerifiers.createdAt })
      .from(accountRecoveryCodeVerifiers).where(and(eq(accountRecoveryCodeVerifiers.userId, s.user.id), isNull(accountRecoveryCodeVerifiers.invalidatedAt))),
    db.select().from(authSessions).where(and(eq(authSessions.userId, s.user.id), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date()))).orderBy(desc(authSessions.lastSeenAt)),
    db.select().from(accountSecurityEvents).where(eq(accountSecurityEvents.userId, s.user.id)).orderBy(desc(accountSecurityEvents.createdAt)).limit(30),
  ]);
  return {
    session: { method: s.method, createdAt: s.createdAt, stepUpFresh: !!s.stepUpAt && Date.now() - s.stepUpAt.getTime() < 10 * 60_000 },
    passkeys: passkeys.map((p) => ({ id: p.id, nickname: p.nickname, backedUp: p.backedUp, deviceType: p.deviceType, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt })),
    totp: totp ? { label: totp.label, verifiedAt: totp.verifiedAt } : null,
    recoveryCodes: { total: codes.length, remaining: codes.filter((c) => !c.used).length, generatedAt: codes[0]?.at ?? null, used: codes.filter((c) => c.used).map((c) => c.pos) },
    sessions: sessions.map((x) => ({ id: x.id, device: x.deviceLabel, method: x.method, createdAt: x.createdAt, lastSeenAt: x.lastSeenAt, current: x.id === s.sessionId })),
    events: events.map((e) => ({ type: e.type, at: e.createdAt, ua: e.userAgent })),
  };
};

const sessionRevoke: Handler = async (body) => {
  const s = await requireUser();
  const { id, all } = z.object({ id: z.string().uuid().optional(), all: z.boolean().optional() }).parse(body);
  const now = new Date();
  if (all) {
    await getDb().update(authSessions).set({ revokedAt: now }).where(and(eq(authSessions.userId, s.user.id), ne(authSessions.id, s.sessionId), isNull(authSessions.revokedAt)));
  } else if (id) {
    await getDb().update(authSessions).set({ revokedAt: now }).where(and(eq(authSessions.id, id), eq(authSessions.userId, s.user.id)));
  }
  await securityEvent(s.user.id, "sessions_revoked", { all: !!all }, true);
  return { ok: true };
};

const logout: Handler = async () => {
  const s = await getSession();
  if (s) await getDb().update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.id, s.sessionId));
  await clearSessionCookie();
  return { ok: true };
};

const profileUpdate: Handler = async (body) => {
  const s = await requireUser();
  const p = z.object({
    displayName: z.string().trim().max(60).optional().nullable(),
    timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }, "Unknown timezone"),
    defaultCurrency: z.string().regex(/^[A-Z]{3}$/),
  }).parse(body);
  await getDb().update(users).set({ displayName: p.displayName || null, timezone: p.timezone, defaultCurrency: p.defaultCurrency, updatedAt: new Date() }).where(eq(users.id, s.user.id));
  return { ok: true, message: "Settings saved" };
};

const status: Handler = async () => {
  const s = await getSession();
  return s ? { signedIn: true, method: s.method, onboardingStep: s.user.onboardingStep } : { signedIn: false };
};

export const authHandlers: Record<string, Handler> = {
  "enroll-start": enrollStart, "invite-redeem": inviteRedeem, "enroll-verify": enrollVerify, "enroll-profile": enrollProfile,
  "passkey-register-options": passkeyRegisterOptions, "passkey-register-verify": passkeyRegisterVerify,
  "passkey-remove": passkeyRemove, "passkey-rename": passkeyRename,
  "login-options": loginOptions, "login-verify": loginVerify,
  "stepup-options": stepUpOptions, "stepup-verify": stepUpVerify,
  "totp-setup": totpSetup, "totp-verify": totpVerify, "totp-remove": totpRemove,
  "recovery-codes-generate": recoveryCodesGenerate, "onboarding-complete": onboardingComplete,
  "recovery-start": recoveryStart, "recovery-verify": recoveryVerify,
  "security-overview": securityOverview, "profile-update": profileUpdate, "session-revoke": sessionRevoke, logout, status,
};

export { randomToken };
