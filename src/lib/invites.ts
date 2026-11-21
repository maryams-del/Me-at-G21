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
