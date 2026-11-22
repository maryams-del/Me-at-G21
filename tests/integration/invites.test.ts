import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "@/db";
import { users } from "@/db/schema";
import { runOpInTx } from "@/server/ops";
import { mayEnroll } from "@/server/auth/invites";
import { mascotFor } from "@/server/mascot";
import { invitedEmailsOf } from "@/lib/invites";
import { resetDb, makeOwner, withCtx } from "../support/db";

const now = new Date("2026-11-21T09:00:00Z");
const op = (ownerId: string, name: string, input: unknown) =>
  withCtx(ownerId, now, (ctx) => runOpInTx(ctx.tx, { ownerId: ctx.ownerId, tz: ctx.tz, source: "manual", now }, name, input));

let owner: Awaited<ReturnType<typeof makeOwner>>;
beforeEach(async () => { await resetDb(); owner = await makeOwner("owner@example.com"); });
afterAll(async () => { await closeDb(); });

describe("Accounts for other people (invite-only)", () => {
  it("only the owner and invited emails may sign up; removing an invite stops it", async () => {
    expect(await mayEnroll("owner@example.com")).toBe(true);
    expect(await mayEnroll("friend@example.com")).toBe(false);

    await op(owner.id, "invite.add", { email: "Friend@Example.com " });
    expect(await mayEnroll("friend@example.com")).toBe(true);
    expect(await mayEnroll("stranger@example.com")).toBe(false);
    await expect(op(owner.id, "invite.add", { email: "friend@example.com" })).rejects.toThrow(/already invited/);
    await expect(op(owner.id, "invite.add", { email: "owner@example.com" })).rejects.toThrow(/your own email/);

    await op(owner.id, "invite.remove", { email: "friend@example.com" });
    expect(await mayEnroll("friend@example.com")).toBe(false);
  });

  it("someone who isn't the owner can't invite anyone", async () => {
    const friend = await makeOwner("friend@example.com");
    await expect(op(friend.id, "invite.add", { email: "x@example.com" })).rejects.toThrow(/Only the site owner/);
    const [o] = await getDb().select({ settings: users.settings }).from(users).where(eq(users.id, owner.id));
    expect(invitedEmailsOf(o.settings)).toEqual([]);
  });

  it("an invite link is one-time, tied to the email, and only its hash is stored", async () => {
    const { inviteTokensOf } = await import("@/lib/invites");
    const { verifier } = await import("@/lib/crypto");
    const { env } = await import("@/lib/env");
    await op(owner.id, "invite.add", { email: "friend@example.com" });
    const r = await op(owner.id, "invite.link", { email: "friend@example.com" }) as unknown as { url: string };
    const invite = new URL(r.url).searchParams.get("invite")!;
    const [b64, token] = invite.split(".");
    expect(Buffer.from(b64, "base64url").toString()).toBe("friend@example.com");
    const [u] = await getDb().select({ settings: users.settings }).from(users).where(eq(users.id, owner.id));
    const entry = inviteTokensOf(u.settings)["friend@example.com"];
    expect(entry.h).toBe(verifier(token, env.pepper, "invite:friend@example.com"));
    expect(JSON.stringify(u.settings)).not.toContain(token);
    await expect(op(owner.id, "invite.link", { email: "nobody@example.com" })).rejects.toThrow(/isn't invited/);
    await op(owner.id, "invite.remove", { email: "friend@example.com" });
    const [u2] = await getDb().select({ settings: users.settings }).from(users).where(eq(users.id, owner.id));
    expect(inviteTokensOf(u2.settings)["friend@example.com"]).toBeUndefined();
  });

  it("the owner and people marked as family see the original mascot; everyone else sees the cat", async () => {
    expect(await mascotFor("Owner@example.com")).toBe("family");
    await op(owner.id, "invite.add", { email: "mum@example.com", family: true });
    await op(owner.id, "invite.add", { email: "friend@example.com" });
    expect(await mascotFor("mum@example.com")).toBe("family");
    expect(await mascotFor("friend@example.com")).toBe("cat");
    expect(await mascotFor("stranger@example.com")).toBe("cat");
    await op(owner.id, "invite.family", { email: "friend@example.com", family: true });
    await op(owner.id, "invite.family", { email: "mum@example.com", family: false });
    expect(await mascotFor("friend@example.com")).toBe("family");
    expect(await mascotFor("mum@example.com")).toBe("cat");
    await expect(op(owner.id, "invite.family", { email: "stranger@example.com", family: true })).rejects.toThrow(/isn't invited/);
    await op(owner.id, "invite.remove", { email: "friend@example.com" });
    expect(await mascotFor("friend@example.com")).toBe("cat");
  });
});
