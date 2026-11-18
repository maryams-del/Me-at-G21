# Me @ G21

A private, single-owner, mobile-first life dashboard (installable PWA). Phase A of the PRD.

- Passkey sign-in (Face ID / Touch ID), authenticator-app backup, offline recovery codes, lost-phone recovery
- Charity, savings, lent/borrowed, waxing, dental scaling, routines, make-up fasts, Quran class & homework, projects & tasks
- AI capture (Claude or offline parser) that **never saves anything until you press Save**
- Durable reminders with web push (iPhone Home Screen app), quiet hours, redacted lock-screen previews

Docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) · [`docs/SECURITY_RELEASE_CHECKLIST.md`](docs/SECURITY_RELEASE_CHECKLIST.md)

> The **password vault is not enabled for real passwords**. Use a dedicated password manager until the vault passes its security release gate.

## Run locally

Requirements: Node 22+, PostgreSQL 15+.

```bash
npm install
cp .env.example .env.local      # then fill in the values (see comments in the file)
createdb life_dev
npm run db:migrate
npm run dev                     # http://localhost:3000 → /onboarding
```

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # DATA_ENCRYPTION_KEY, AUTH_PEPPER
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))" # CRON_SECRET
npx web-push generate-vapid-keys                                              # VAPID keys
```

Without `RESEND_API_KEY`, verification codes are printed in the dev server console. Passkeys work on `http://localhost`. Any other host needs HTTPS.

## Tests

```bash
npm test                                     # unit + DB integration (uses life_test DB)
CHROME_PATH=/path/to/chrome npm run test:e2e # full journey with a virtual passkey authenticator (uses life_e2e DB)
npm run lint                                 # TypeScript
```

## Deploy (Vercel + Neon): live project `me-at-g21`

Production URL: **https://me-at-g21.vercel.app** (Vercel team "Project G21", region fra1 / Frankfurt). Every push to `main` deploys automatically, and each deploy applies database migrations (`vercel-build` script).

1. **Database:** Vercel → project **me-at-g21** → **Storage** → **Create Database** → **Neon** (Serverless Postgres). Choose the **Free** plan and region **Frankfurt (eu-central-1)**, then connect it to the project for **Production** and **Preview**. This adds `DATABASE_URL`.
2. **Secret keys:** open `https://me-at-g21.vercel.app/setup-keys`, press **Generate keys** (generated in your browser, never sent anywhere), and add each value in Vercel → Settings → Environment Variables as **Sensitive**, **Production**.
3. **Email (needed for sign-up codes and security alerts):** create a free account at resend.com **with the same email as `OWNER_EMAIL`**, create an API key, and add it as `RESEND_API_KEY` (Sensitive). The default sender `onboarding@resend.dev` can only email the Resend account owner, which is fine for a single-owner app. Add your own domain later for better deliverability.
4. **Redeploy:** Vercel → Deployments → ⋯ → Redeploy (or push any commit).
5. **Enroll:** on your iPhone open `https://me-at-g21.vercel.app/onboarding` in Safari. Then add a second passkey from your Mac.
6. **AI (optional):** add `ANTHROPIC_API_KEY` (Sensitive) and change `AI_PROVIDER` to `anthropic`, then redeploy. Until then the offline parser is used.

Passkeys are tied to the domain `me-at-g21.vercel.app`. Moving to a different domain later means registering passkeys again.

### Reminder timer (cron-job.org, free)
1. Sign up at cron-job.org → **Create cronjob**.
2. URL: `https://me-at-g21.vercel.app/api/cron/dispatch`. Schedule: **every minute**.
3. **Advanced** → Headers → add `Authorization` with value `Bearer <your CRON_SECRET>`.
4. Save, then **Test run**: expect HTTP 200. Settings → Notifications in the app shows "Last run".
5. Turn on cron-job.org's failure notifications so you hear about it if the job starts failing.

The daily Vercel cron in `vercel.json` is only a backstop.

## Backups and restore
- **In the app (Settings → Data & backups):** an encrypted backup of all records is made every night (last 14 kept, stored in private Blob storage). "Download a backup now" saves a `.mebackup` file to keep elsewhere. "Restore from a backup" checks the file's integrity, shows what's in it, and after a passkey check replaces all records in one transaction, saving a safety copy first.
- Backups are encrypted with a key derived from `DATA_ENCRYPTION_KEY`. **Keep that key safe and never rotate it casually**: without it, backups (and encrypted fields) can't be opened. Uploaded file contents are not inside backups; they stay in Blob storage.
- Deleted items are recoverable for 30 days (Recently deleted), then purged by the hourly housekeeping, including file contents.
- Spreadsheet (CSV) export per section and a full JSON export are on the same page.
- Neon also keeps short point-in-time history (window depends on plan); restore by branching from a timestamp in the Neon console.
- Keep printed recovery codes offline. They are never stored in plaintext and can't be re-shown.

## Operational checklist
- [ ] Production env vars set, none reused from development
- [ ] Per-minute scheduler configured and visible in Settings → Notifications
- [ ] Resend domain verified, test security email received
- [ ] Owner enrolled two passkeys on two devices, TOTP set up, recovery codes printed
- [ ] Recovery tested once from a second device
- [ ] `npm audit` reviewed. Current findings are dev-only (drizzle-kit's esbuild, vitest's picomatch) and aren't shipped to production.

## Known limits (Phase A)
- Not yet verified on a physical iPhone or Mac (passkeys, push). Automated tests use a virtual authenticator.
- CSP allows inline scripts, which Next.js needs; nonce-based CSP is planned.
- Phase B modules (applications, subscriptions, expiries, documents, period log, zakat, achievements) are not built yet.
