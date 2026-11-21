import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import { invitedEmailsOf } from "@/lib/invites";

/** Who may create an account: the site owner (OWNER_EMAIL) and anyone the owner has invited in Settings. */
export async function mayEnroll(email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (e === env.ownerEmail) return true;
  const [owner] = await getDb().select({ settings: users.settings }).from(users).where(eq(users.email, env.ownerEmail));
  return invitedEmailsOf(owner?.settings).includes(e);
}
