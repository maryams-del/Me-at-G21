import "server-only";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  get origin() { return req("APP_ORIGIN").replace(/\/$/, ""); },
  get rpId() { return new URL(this.origin).hostname; },
  get ownerEmail() { return req("OWNER_EMAIL").trim().toLowerCase(); },
  get dataKey() { return req("DATA_ENCRYPTION_KEY"); },
  get pepper() { return req("AUTH_PEPPER"); },
  get cronSecret() { return process.env.CRON_SECRET ?? ""; },
  get aiProvider() { return (process.env.AI_PROVIDER ?? "offline") as "anthropic" | "offline"; },
  get isProd() { return process.env.NODE_ENV === "production"; },
  get secureCookies() { return this.origin.startsWith("https://"); },
};
