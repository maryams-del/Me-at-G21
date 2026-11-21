import { z } from "zod";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import { invitedEmailsOf } from "@/lib/invites";
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
    let emailed = true;
    try {
      await sendEmail(i.email, "You're invited to Me @ G21",
        `You've been invited to create your own private Me @ G21.\n\nOpen ${env.origin}/onboarding and sign up with this email address (${i.email}). You'll set up a passkey on your device. Your account and everything in it is separate and only visible to you.`);
    } catch { emailed = false; }
    return { id: null, message: emailed ? `Invited ${i.email}. They've been emailed a link.` : `Invited ${i.email}. The email didn't send, so share ${env.origin}/onboarding with them.` };
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
    await ctx.tx.update(users).set({ settings: { ...settings, invitedEmails: list.filter((x) => x !== i.email) }, updatedAt: ctx.now }).where(eq(users.id, ctx.ownerId));
    await audit(ctx, "accounts", "uninvited", "invite", null, `Removed the invite for ${i.email}`);
    return { id: null, message: "Invite removed" };
  },
});
