# Security release checklist

## Password vault: NOT APPROVED FOR REAL SECRETS

The vault stays a locked placeholder until **every** item below is checked and signed off by someone other than the implementer.

- [ ] Written cryptographic design (key hierarchy, algorithms, parameters, envelope versioning) — draft in `ARCHITECTURE.md §8`
- [ ] Threat model covering: compromised server, lost/stolen logged-in phone, malicious extension / XSS, lost master passphrase, stolen session, account-recovery abuse, lost device with no recovery factor
- [ ] Independent expert review of the design and code
- [ ] Argon2id parameters calibrated on the slowest target device (iPhone)
- [ ] Verified on-device key handling: no plaintext key or secret reaches the server, logs, telemetry, AI, search index or `localStorage`
- [ ] Vault recovery key flow tested on a second device from scratch
- [ ] Confirmed account recovery / TOTP / email / recovery codes **cannot** decrypt the vault (automated test + manual)
- [ ] Clipboard hygiene, auto-lock timeout, hidden-by-default reveal
- [ ] Dependency review and remediation (`npm audit`, lockfile pinned)
- [ ] Nonce-based CSP without `unsafe-inline`
- [ ] Penetration test and fixes
- [ ] Clear user warning: losing passphrase + recovery key = permanent loss
- [ ] Owner sign-off; flip the feature flag only after the above

## Account security (Phase A) — pre-production checks

- [x] Passkeys require user verification; counter updated on each use
- [x] Email code: 6 digits, 10-minute TTL, 5 attempts, single use, owner email only, generic responses
- [x] Recovery requires email code **plus** an independent factor; rate-limited; alert email
- [x] Recovery codes: 10 × ~79 bits, HMAC-stored, single use, rotate invalidates old set, never emailed
- [x] TOTP seed encrypted (AES-256-GCM, user-bound AAD); ±1 step drift; replay protection
- [x] Factor removal requires fresh passkey step-up; locked 24 h after recovery
- [x] Sessions: HttpOnly, Secure (HTTPS), SameSite=Lax, hashed server-side, idle + absolute expiry, revoke one / all
- [x] Origin check on all JSON mutations; security headers + CSP; no API keys in the client bundle
- [ ] **Real-device test**: passkey enroll + sign-in on the owner's iPhone (Face ID) and Mac (Touch ID)
- [ ] **Real-device test**: lost-phone recovery from a second device using a printed code
- [ ] **Real-device test**: iPhone Home Screen web push received from the production scheduler
- [ ] Production secrets generated fresh (never reuse `.env.local` values) and stored only in Vercel env vars
- [ ] Resend domain verified (SPF/DKIM) so security emails aren't spam-filtered
