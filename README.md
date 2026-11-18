# Life Dashboard

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

## Deploy (Vercel + Neon)

1. Create a Vercel project from this repo.
2. In Vercel → Storage, add **Neon Postgres** (sets `DATABASE_URL`). Add a **private Blob** store for Phase B.
3. Add env vars from `.env.example` with **fresh** production values. `APP_ORIGIN` must be your final HTTPS URL; passkeys are bound to that domain, so changing the domain later means re-enrolling passkeys.
4. Run migrations once against production: `DATABASE_URL=… npm run db:migrate`.
5. Open `/onboarding` on your iPhone in Safari and enroll. Then add a second passkey from your Mac.

### Reminder scheduler (important)
Reminders are sent by `GET /api/cron/dispatch` with header `Authorization: Bearer $CRON_SECRET`, which needs to run **every minute**.
- **Vercel Pro:** change the schedule in `vercel.json` to `* * * * *`.
- **Vercel Hobby (free):** Vercel only allows a daily cron. Create a free per-minute job at a service such as cron-job.org pointing at `https://<your-app>/api/cron/dispatch` with that header. The daily Vercel cron stays as a fallback.

Settings → Notifications shows when the scheduler last ran.

### iPhone notifications
Safari → Share → **Add to Home Screen** → open the app from the Home Screen → Settings → Notifications → **Enable reminders** → **Send a test notification**.

## Backups and restore
- Neon keeps point-in-time history (the window depends on plan); restore by branching from a timestamp in the Neon console.
- Settings → Your data → **Download JSON export** gives a portable copy of all non-secret data.
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
