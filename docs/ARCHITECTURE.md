# Architecture decision record — Personal Life Dashboard

Status: Phase A implemented (18 Nov 2026). Phases B and C are planned below.

## 1. Stack and why

| Concern | Choice | Why | Alternatives considered |
|---|---|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind 4 | Server components keep data and secrets on the server; one deployable; first-class on Vercel | Remix, SvelteKit |
| Hosting | Vercel | Already connected to the owner's account; preview deployments; HTTPS by default (WebAuthn and web push need it) | Fly.io, Render |
| Database | Neon Postgres via `pg` + Drizzle ORM, versioned SQL migrations in `drizzle/` | Free plan with no pause; plain Postgres; branching for safe testing | Supabase (pauses after 7 idle days on Free) |
| Files (Phase B) | Vercel Blob **private** store (`access: 'private'`, GA) | Auth on every read; no public URLs | S3 + presigned URLs |
| Passkeys | `@simplewebauthn/server` + `/browser` v14, self-hosted | Full control over the PRD's recovery rules; no vendor lock; audited, widely used | Hosted auth providers (none matched every recovery rule) |
| TOTP | `otplib` v13 (RFC 6238, constant-time compare, replay protection via `afterTimeStep`) | Standard, maintained | speakeasy (unmaintained) |
| Server crypto | Node `crypto` only: AES-256-GCM envelopes, HMAC-SHA256 verifiers | No custom algorithms | libsodium |
| AI | Anthropic Messages API, structured JSON output, server-side only; offline rule parser as fallback | Strict schema output; key never reaches the browser | OpenAI, AI Gateway |
| Email | Resend (verification codes, security alerts, optional reminder fallback) | Simple API | Postmark, SES |
| Push | Standard Web Push (VAPID) with the `web-push` library and a minimal service worker | Works with iOS 16.4+ Home Screen web apps, Android and desktop | Third-party push SaaS |
| Scheduler | `/api/cron/dispatch`, an authenticated, idempotent endpoint hit every minute | Delivery is decoupled from any open browser tab | Queues (overkill for one user) |
| Tests | Vitest (unit + DB integration), Playwright E2E with a CDP virtual WebAuthn authenticator | Exercises real passkey ceremonies in CI | — |

## 2. Capabilities checked during build (Nov 2026)

- **Vercel Cron on Hobby runs at most once a day**, with up to ±59 minutes of jitter. Per-minute schedules need Pro. **Consequence:** on Hobby, point any external per-minute scheduler (for example cron-job.org or a GitHub Actions schedule) at `/api/cron/dispatch` with `Authorization: Bearer $CRON_SECRET`. The daily Vercel cron in `vercel.json` is only a safety net.
- **Vercel Blob private storage is generally available.** Every operation needs authentication; files are served through our route after an owner check.
- **Neon Free:** 1 GB storage per project and 100 compute-hours a month. It scales to zero and wakes on request; it never pauses for good.
- **SimpleWebAuthn v14** and **otplib v13**: API signatures were confirmed from the installed type definitions, not from memory.
- **Passkey ceremonies** (registration, discoverable sign-in, step-up) pass end-to-end in Chrome with a platform-style virtual authenticator that has user verification. **Not yet verified on a physical iPhone or Mac.** That is listed as an open item.
- **iOS web push** needs iOS 16.4+, HTTPS, the app added to the Home Screen, and a permission request inside a user tap. The UI follows this exactly and shows the real permission and subscription state. Real-device delivery still has to be confirmed after deployment.

## 3. Core design

### 3.1 One write path
Every change to user data goes through the **operation registry** (`src/server/ops`). Each op has a Zod schema, an `aiAllowed` flag, a human summary and a `run(ctx, input)`. Manual forms call `POST /api/ops/<name>`. Confirmed AI proposals call the same `runOpInTx` inside a transaction. So validation, owner scoping, reminder sync and audit logging are identical whatever the source.

### 3.2 AI pipeline (confirm-before-write, server-enforced)
1. `capture`: the provider returns `{intent, operations[], questions[], query?}`. The server maps aliases (`@r1`) to the owner's own record IDs, validates each op, and stores an `ai_proposals` row plus versioned `ai_proposal_operations`. **No user record is touched.**
2. `correct`: the previous ops and the owner's correction go back to the provider, producing version N+1. Still no writes.
3. `confirm(proposalId, version, selections)`: locks the proposal row (`FOR UPDATE`), rejects stale versions, expired or cancelled proposals and non-AI ops, then runs every selected op in **one transaction**. A failure rolls everything back. Re-confirming returns the stored outcome (idempotent). `draft` selections create `capture_drafts` (Needs Details).
4. Search runs deterministic, allowlisted SQL queries. The model only translates the question into a query type; **record contents are never sent to the model**.

Sent to the model: the owner's text, today's date and timezone, and the names of routines, savings goals, open debt counterparties, projects and recent task titles, behind short aliases. Not sent: amounts, period data, documents or IDs, vault data, or database IDs.

### 3.3 Reminders
Each source declares its full desired reminder set. `syncReminders` reconciles against the table, using a unique `(owner_id, dedupe_key)` key. Keys embed the anchor (for example `waxing:<id>:<lastDate>:d27`), so a new completion cancels the old schedule and a correction never duplicates. Past-due reminders are not created retroactively. The dispatcher claims each reminder with a conditional UPDATE and each channel attempt with a unique attempt key, so concurrent or retried runs never double-send. It respects quiet hours and redacts sensitive previews ("Personal reminder") unless the owner opts in.

### 3.4 Time and money
- Local dates are `date` columns interpreted in the owner's IANA timezone (default `Asia/Riyadh`). Instants are `timestamptz`.
- Calendar-month maths clamps to the end of the month: Jan 31 + 6 months = Jul 31, Aug 31 + 6 months = Feb 28/29.
- Hijri dates use Umm al-Qura (`Intl` `islamic-umalqura`). The UI notes that moon sighting can shift a month start by a day.
- Money is an integer in minor units, parsed from strings without floating point.

## 4. Sitemap

```
/login  /onboarding  /recover
/                      Today dashboard
/inbox                 Needs details (confirmed drafts)
/finance  /finance/charity  /finance/savings  /finance/debts
/care  /care/waxing  /care/dental  /care/routines
/faith/fasts           Make-up fasts ledger
/quran                 Classes, homework, translation study, other weekly classes
/projects              Projects & tasks (deadline list + board)
/history               Timeline + grounded search
/vault                 Locked placeholder (NOT APPROVED FOR REAL SECRETS)
/settings  /settings/security  /settings/notifications
/more                  Mobile overflow menu
API: /api/auth/[action]  /api/ops/[name]  /api/ai/[action]  /api/push/[action]
     /api/reminders/[action]  /api/drafts/resolve  /api/export  /api/cron/dispatch
```

## 5. Data model
See `src/db/schema.ts` (commented) and `drizzle/0000_init.sql`. Every user table has `owner_id` and every service query filters by it. Ledgers (fasts, savings, debt repayments, completions) are append-only: corrections are new rows or `voided_at`, never silent edits.

## 6. Authentication and recovery

| Path | Factors | Notes |
|---|---|---|
| First enrollment | Email code (10 min, 5 attempts, owner address only), then passkey (UV required), then TOTP, then 10 recovery codes | Codes are shown once and never emailed |
| Daily sign-in | Discoverable passkey with user verification | Face ID / Touch ID / device PIN, as chosen by the OS |
| Step-up | Fresh passkey assertion within 10 min | Required to add a passkey from a normal session, remove factors, rotate codes, replace TOTP |
| Lost every passkey | Email code **and** (unused recovery code **or** TOTP) | Rate limited per IP and per email; security email; recovery session flagged |
| After recovery | Add passkey and revoke sessions now; removing factors locked for 24 h | Session revocation can't erase data already on a stolen device |

Sessions use a 32-byte random token in an HttpOnly cookie (Secure on HTTPS, SameSite=Lax), stored server-side as an HMAC. They expire after 30 days absolute or 7 days idle. Mutations check Origin, and a strict CSP plus security headers are set. TOTP seeds are encrypted with AES-256-GCM, bound to the user. Recovery codes have about 79 bits of entropy and are stored only as HMAC verifiers.

## 7. Threat model (summary)

| Threat | Mitigation | Residual risk |
|---|---|---|
| Stolen, unlocked, signed-in phone | Passkey needs device UV for new sign-ins; owner can revoke sessions from another device; lock-screen redaction | Data already displayed or cached on the phone |
| Stolen phone, then attacker attempts recovery | Needs owner email **and** an offline code or TOTP; alerts by email; factor removal delayed 24 h | If the attacker controls email *and* the TOTP app on the phone, they can recover; owner should keep TOTP off-phone or rely on offline codes |
| Phishing | Passkeys are origin-bound; no passwords | Email code during recovery is phishable, but useless alone |
| Credential stuffing / brute force | No passwords; DB rate limits on every auth endpoint; email codes capped at 5 attempts | — |
| XSS | React escaping, strict CSP (`script-src 'self' 'unsafe-inline'` because Next inlines bootstrap scripts), no `dangerouslySetInnerHTML` | `unsafe-inline` weakens CSP; nonce-based CSP is a Phase B task |
| CSRF | SameSite=Lax cookies plus Origin check on all JSON mutations | — |
| Prompt injection via captured text | Model output is only a proposal; allowlisted ops; Zod re-validation; owner confirms; IDs resolved server-side from the owner's own records | A wrong but plausible proposal still needs human review (that's the design) |
| Compromised app server or DB dump | TOTP seeds and protected fields encrypted with a key outside the DB; recovery codes and sessions hashed | Server compromise with env access exposes those keys; **this is why the vault must be client-side encrypted** |
| Cross-owner access | Owner filter in every op and query; tests attempt cross-owner IDs | Single-owner app limits blast radius |
| Duplicate notifications / annual additions | Unique dedupe keys, conditional claims, unique `(rule_id, period_key)` | — |

## 8. Password vault (Phase C, release-gated)

Not implemented for real secrets. `/vault` is a locked placeholder labelled **NOT APPROVED FOR REAL SECRETS**.

Proposed design, to be independently reviewed before any code ships:
- **Client-side encryption only.** A per-vault 256-bit data key encrypts items with XChaCha20-Poly1305 or AES-256-GCM (libsodium or WebCrypto), each with a unique nonce, in a versioned envelope.
- **Vault master passphrase:** Argon2id (WASM; parameters around 64–256 MiB and 3 iterations, calibrated on an iPhone) derives a key-encryption key that wraps the data key. The server stores only the wrapped key and ciphertext.
- **Separate offline vault recovery key:** a random 256-bit value shown once as words or QR, wrapping the data key a second time. It is independent of the account recovery codes.
- **Entry:** fresh passkey step-up **and** passphrase. Optional device convenience unlock only via a reviewed mechanism (for example WebAuthn PRF extension where supported) that genuinely releases key material; never a UI toggle.
- **Strong alternative:** integrate an existing password manager (for example a link-out to Apple Passwords or Bitwarden) instead of building one. Recommended unless there's a strong reason to keep secrets in this app.
- **Release gate:** see `docs/SECURITY_RELEASE_CHECKLIST.md`.

## 9. Milestones

- **Phase A (done):** auth and recovery, shell, dashboard, charity, waxing, dental, routines, fasts, savings, lent/borrowed, projects/tasks, Quran classes and homework, reminders and push, AI capture and search, inbox, history, JSON export.
- **Phase B (next):** master's applications, subscriptions, expiries and renewals, document vault and protected IDs (private Blob plus encrypted ID fields with reveal-after-step-up), period log (opt-in AI, redacted everywhere), zakat calculator and payments, achievements and hobbies, CSV export, backup/restore tooling, nonce-based CSP, real-device iPhone verification.
- **Phase C:** vault per §8, external review, then staged enablement.
