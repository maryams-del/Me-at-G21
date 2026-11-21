/** Emails the site owner has invited to create their own (separate, private) account. Kept in the owner's settings. */
export function invitedEmailsOf(settings: Record<string, unknown> | null | undefined): string[] {
  const v = (settings ?? {}).invitedEmails;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
