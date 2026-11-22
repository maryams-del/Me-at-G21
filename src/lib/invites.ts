/** Emails the site owner has invited to create their own (separate, private) account. Kept in the owner's settings. */
export function invitedEmailsOf(settings: Record<string, unknown> | null | undefined): string[] {
  const v = (settings ?? {}).invitedEmails;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** One-time invite links: only a hash of each link's secret is kept, per email, with an expiry. */
export type InviteToken = { h: string; exp: number };
export const INVITE_LINK_DAYS = 7;
export function inviteTokensOf(settings: Record<string, unknown> | null | undefined): Record<string, InviteToken> {
  const v = (settings ?? {}).inviteTokens;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, InviteToken>) : {};
}

/** Invited people the owner has marked as family. Family (and the owner) see the original mascot; everyone else sees the cat. */
export function familyEmailsOf(settings: Record<string, unknown> | null | undefined): string[] {
  const v = (settings ?? {}).familyEmails;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export type MascotKind = "family" | "cat";
/** The mascot pictures and their sizes in each spot (header switch, opening screen, sign-in page). */
export const MASCOTS = {
  family: { src: "/mascot.png", header: { w: 48, h: 64, lift: 11 }, splash: { w: 72, h: 96 }, auth: { w: 110, h: 146 } },
  cat: { src: "/mascot-cat.png", header: { w: 70, h: 52, lift: 6 }, splash: { w: 116, h: 86 }, auth: { w: 190, h: 142 } },
} as const;
/** Cookie that remembers a family device, so the sign-in page shows the family mascot there too. */
export const MASCOT_COOKIE = "g21-mascot";
