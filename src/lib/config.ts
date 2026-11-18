import "server-only";

/** Which required settings are missing (names only — values are never exposed). */
export function missingConfig(): { key: string; how: string }[] {
  const need: [string, string][] = [
    ["DATABASE_URL", "Vercel → Storage → connect Neon to this project with prefix DATABASE"],
    ["APP_ORIGIN", "Vercel → Settings → Environment Variables"],
    ["OWNER_EMAIL", "Vercel → Settings → Environment Variables"],
    ["DATA_ENCRYPTION_KEY", "Generate at /setup-keys"],
    ["AUTH_PEPPER", "Generate at /setup-keys"],
    ["CRON_SECRET", "Generate at /setup-keys"],
    ["VAPID_PUBLIC_KEY", "Generate at /setup-keys"],
    ["VAPID_PRIVATE_KEY", "Generate at /setup-keys"],
  ];
  const have = (k: string) => !!process.env[k] || (k === "DATABASE_URL" && !!(process.env.ME_AT_G21_DATABASE_URL || process.env.ME_AT_G21_URL));
  const out = need.filter(([k]) => !have(k)).map(([key, how]) => ({ key, how }));
  if (process.env.NODE_ENV === "production" && !process.env.RESEND_API_KEY) out.push({ key: "RESEND_API_KEY", how: "Free API key from resend.com (needed to email sign-up codes)" });
  return out;
}
