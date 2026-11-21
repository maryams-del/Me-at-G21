import { z } from "zod";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import { invitedEmailsOf, inviteTokensOf, INVITE_LINK_DAYS } from "@/lib/invites";
import { randomToken, verifier } from "@/lib/crypto";
import { defineOp } from "./registry";
import { audit, UserError, type Ctx } from "../audit";
import { sendEmail } from "../email";

/*
 * Accounts for other people. Each person who signs up gets their own separate, private account
 * (their own passkey, data, reminders and backups). Only the site owner (OWNER_EMAIL) can invite.
 */
async function ownerSettings(ctx: Ctx) {
  const [u] = await ctx.tx.select({ email: users.email, settings: users.settings }).from(users).where(eq(users.id, ctx.ownerId));
  if (!u || u.email !== env.ownerEmail) throw new UserError("Only the site owner can invite people.");
  return u.settings ?? {};
}

const zEmail = z.string().trim().toLowerCase().email().max(254);

export const inviteAdd = defineOp({
  name: "invite.add", module: "accounts", label: "Invite someone", aiAllowed: false,
  schema: z.object({ email: zEmail }),
  summarize: (i) => `Invite ${i.email}`,
  async run(ctx, i) {
    const settings = await ownerSettings(ctx);
    if (i.email === env.ownerEmail) throw new UserError("That's your own email.", "email");
    const list = invitedEmailsOf(settings);
    if (list.includes(i.email)) throw new UserError("That email is already invited.", "email");
    await ctx.tx.update(users).set({ settings: { ...settings, invitedEmails: [...list, i.email] }, updatedAt: ctx.now }).where(eq(users.id, ctx.ownerId));
    await audit(ctx, "accounts", "invited", "invite", null, `Invited ${i.email} to create an account`);
    const link = await makeInviteLink(ctx, i.email);
    let emailed = true;
    try {
      await sendEmail(i.email, "You're invited to Me @ G21",
        `You've been invited to create your own private Me @ G21.\n\nOpen ${env.origin}/onboarding and sign up with this email address (${i.email}). You'll set up a passkey on your device. Your account and everything in it is separate and only visible to you.`);
    } catch { emailed = false; }
    return { id: null, message: emailed ? `Invited ${i.email}. They've been emailed a link.` : `Invited ${i.email}. Tap Share link next to their email to send them their sign-up link.`, url: link };
  },
});

/** A private one-time link that lets this invited person sign up without an email code. Valid for 7 days; a new link replaces the old one. */
async function makeInviteLink(ctx: Ctx, email: string) {
  const settings = await ownerSettings(ctx);
  const token = randomToken(24);
  const tokens = { ...inviteTokensOf(settings), [email]: { h: verifier(token, env.pepper, `invite:${email}`), exp: ctx.now.getTime() + INVITE_LINK_DAYS * 86400_000 } };
  await ctx.tx.update(users).set({ settings: { ...settings, inviteTokens: tokens }, updatedAt: ctx.now }).where(eq(users.id, ctx.ownerId));
  return `${env.origin}/onboarding?invite=${encodeURIComponent(Buffer.from(email).toString("base64url"))}.${token}`;
}

export const inviteLink = defineOp({
  name: "invite.link", module: "accounts", label: "Get an invite link", aiAllowed: false,
  schema: z.object({ email: zEmail }),
  summarize: (i) => `Invite link for ${i.email}`,
  async run(ctx, i) {
    if (!invitedEmailsOf(await ownerSettings(ctx)).includes(i.email)) throw new UserError("That email isn't invited.");
    const url = await makeInviteLink(ctx, i.email);
    await audit(ctx, "accounts", "invite_link", "invite", null, `Made a new invite link for ${i.email}`);
    return { id: null, message: "Invite link ready", url };
  },
});

export const inviteRemove = defineOp({
  name: "invite.remove", module: "accounts", label: "Remove an invite", aiAllowed: false,
  schema: z.object({ email: zEmail }),
  summarize: (i) => `Remove invite for ${i.email}`,
  async run(ctx, i) {
    const settings = await ownerSettings(ctx);
    const list = invitedEmailsOf(settings);
    if (!list.includes(i.email)) throw new UserError("That email isn't invited.");
    await ctx.tx.update(users).set({ settings: { ...settings, invitedEmails: list.filter((x) => x !== i.email), inviteTokens: Object.fromEntries(Object.entries(inviteTokensOf(settings)).filter(([e]) => e !== i.email)) }, updatedAt: ctx.now }).where(eq(users.id, ctx.ownerId));
    await audit(ctx, "accounts", "uninvited", "invite", null, `Removed the invite for ${i.email}`);
    return { id: null, message: "Invite removed" };
  },
});
