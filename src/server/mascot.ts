import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import { familyEmailsOf, type MascotKind } from "@/lib/invites";

/** Which mascot this person sees: the site owner and anyone they've marked as family get the original; everyone else the cat. */
export async function mascotFor(email: string): Promise<MascotKind> {
  const e = email.trim().toLowerCase();
  if (e === env.ownerEmail) return "family";
  const [owner] = await getDb().select({ settings: users.settings }).from(users).where(eq(users.email, env.ownerEmail));
  return familyEmailsOf(owner?.settings).includes(e) ? "family" : "cat";
}
