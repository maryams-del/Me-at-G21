# PRD traceability: Phase A status

Legend: ✅ implemented and tested · 🟡 implemented, needs real-device or production verification · ⏳ planned (phase) · 🔒 release-gated

## Section 4: functional requirements

| PRD | Item | Status | Where / evidence |
|---|---|---|---|
| 4.1 | Dashboard: 7-day reminders, overdue, recently completed, next Quran class, homework, fast balance, charity this month, savings, push state | ✅ | `app/(app)/page.tsx`, E2E screenshots 17/18 |
| 4.1 | Quick actions: Log charity, Waxing completed, Fast completed, Add savings, Add task, Add entry by AI | ✅ | Dashboard quick-action row |
| 4.1 | Quick actions: Period started/ended | ✅ | Shown on Today only after the owner opts in on the Period page (PRD 4.3 privacy) |
| 4.1 | Hide/reorder widgets | ⏳ B | "later" in PRD |
| 4.2 | Charity CRUD, planned vs completed, filters, monthly/yearly totals | ✅ | `ops/finance.ts`, charity page, tests 8/11 |
| 4.2 | Receipt upload, monthly charity goal reminder | ⏳ B | Needs private Blob (B) |
| 4.3 | Period log: explicit start/end with optional time, symptoms, notes, corrections; calendar; history with length and cycle length; estimate marked as such; privacy controls | ✅ | `ops/period.ts`, `care/period`. Notes/symptoms AES-GCM at rest; ops not AI-allowed; period text in Capture/Search answered locally and never sent to the provider; no notifications; audit entries redacted. `personal.test.ts`, E2E |
| 4.4 | Waxing 40-day window, 27/30/35/38/40 reminders, reset on completion, safe recalculation | ✅ | Now a Routine (template: every 30 days, latest +10, private). Test 1, `trackers.test.ts`, `rules.test.ts` |
| 4.5 | Dental 6 calendar months, −14/−1/0 reminders, editable | ✅ | Now a Routine (template). Test 2 |
| 4.6 | Routines: toothbrush purchase vs first-use, brushes, bedsheets, skip/snooze/pause/backdate, history | ✅ | Test 3, routines page. Generic: any routine can have a grace window, after-due nudges and private notifications; templates are one tap. Migration 0004 moved existing waxing/dental history. |
| 4.7 | Fast ledger, opening balance, adjustments with reason, no accidental negatives, idempotent annual rule (Hijri/Gregorian), by-year, Gregorian+Hijri display | ✅ | Test 4 |
| 4.7 | Fast calendar view, fast targets/reminders | ⏳ B | Ledger list shows Hijri equivalents today |
| 4.8 | Savings: multiple goals, ledger, progress, milestones, month-by-month, planned ≠ saved, monthly reminder | ✅ | Test 6 |
| 4.9 | Lent/borrowed, partial repayments, audited corrections, collect vs repay reminders, overdue repeats | ✅ | Test 5 |
| 4.10 | Subscriptions | ⏳ B | |
| 4.11 | Expiries & renewals: 90/30/7 reminders (editable), renewal history, passports/IDs/licences/cards/memberships/custom, digits redacted from notifications | ✅ | `ops/admin.ts`, `admin.test.ts`, E2E |
| 4.12 | Documents: metadata, version history, private Vercel Blob storage with server-side AES-256-GCM, sniffed file types, 4 MB limit, owner-checked download, share sheet, protected ID numbers (encrypted, masked, reveal/copy after passkey step-up, audit) | ✅ | `storage.ts`, `documents.ts`, `admin.test.ts`, E2E |
| 4.13 | Master's applications | ⏳ B | |
| 4.14 | Projects & tasks: list by deadline, board, reminders, no auto-complete | ✅ | Projects page |
| 4.14 | Task attachments, checklist editing UI | ⏳ B | Checklist stored; editor UI pending |
| 4.15 | Achievements bank & hobbies: kinds, areas, dates, outcome, CV line, skills, tags, links, attached documents, links to projects/applications, filters, CV/portfolio bullet export | ✅ | `ops/career.ts`, `education/achievements`. Bullets built only from stored fields; AI prompt forbids invented metrics; AI can't mark featured. `personal.test.ts`, E2E |
| 4.16 | Quran class Sun 19:00 Riyadh, 60-min reminder (editable), per-occurrence homework, translation study suggestion (Sat 19:00, inactive until owner activates), cancel one vs all future, other weekly classes | ✅ | Tests 7 & 25 |
| 4.17 | Zakat | ⏳ B | |
| 4.18 | AI capture: text and editable dictation, multi-action, preview, questions, NL corrections, Fill details later → draft only after confirm, per-entry confirm, transactional, idempotent, auditable, server-enforced | ✅ | Tests 8/9/10/22; `ai.test.ts`; E2E |
| 4.18 | Smart search grounded in records, calculation shown, honest no-results | ✅ | Test 11 |
| 4.18 | Prompt-injection posture, op allowlist, server validation, no LLM-trusted IDs | ✅ | "Trust boundary" tests |
| 4.18 | Undo for AI operations | 🟡 | Every AI write is reversible via the void/delete actions on the tracker; one-click "undo this capture" is ⏳ B |
| 4.19 | Durable scheduling, dedupe, quiet hours, redacted previews, delivery status, iPhone install guidance, honest permission state | ✅ / 🟡 | Logic tested; real iPhone delivery 🟡 |
| 4.19 | Optional email fallback | ✅ | Needs `RESEND_API_KEY` |
| 4.20 | Needs Details, global timeline + search, JSON export | ✅ | Inbox / history / `/api/export` |
| 4.20 | CSV export, backup/restore tooling | ⏳ B | Neon point-in-time restore available now (see README) |

## Section 5: auth and vault

| Item | Status |
|---|---|
| Passkey-first sign-in, multiple passkeys, WebAuthn capability detection (not camera) | ✅ (virtual authenticator) / 🟡 real iPhone |
| Email used only for initial verification, recovery verification and alerts | ✅ |
| TOTP with QR, proof of enrollment, encrypted seed, drift, rate limits, replace after step-up | ✅ |
| 10 offline single-use recovery codes, shown once, print/download, never emailed, remaining count, rotation after step-up | ✅ Test 20 |
| Lost-passkey recovery = email + independent factor, rate limits, alerts, 24 h restriction | ✅ Test 15 |
| Session inventory, revoke one/all, step-up for sensitive changes | ✅ |
| Vault | 🔒 placeholder only, Test 13 by construction (no vault data exists) |

## Section 10: acceptance tests

| # | Status | Evidence |
|---|---|---|
| 1 | ✅ | `trackers.test.ts` Test 1 |
| 2 | ✅ | `trackers.test.ts` Test 2, `rules.test.ts` |
| 3 | ✅ | `trackers.test.ts` Test 3 |
| 4 | ✅ | `trackers.test.ts` Test 4 |
| 5 | ✅ | `trackers.test.ts` Test 5 |
| 6 | ✅ | `trackers.test.ts` Test 6 + E2E |
| 7 | ✅ | `trackers.test.ts` Tests 7 & 25 |
| 8 | ✅ | `ai.test.ts` + E2E (second tab shows no record before Confirm) |
| 9 | ✅ | `ai.test.ts` + E2E |
| 10 | ✅ | `admin.test.ts`: "Add passport expiry" → one question + Fill details later → confirmed draft in Needs Details |
| 11 | ✅ | `ai.test.ts` + E2E |
| 12 | ✅ / 🟡 | E2E onboarding; real Face ID pending |
| 13 | 🔒 | Vault not enabled; recovery has no path to vault keys by design |
| 14 | ✅ | No vault secrets exist; AI context builder sends no secrets; recovery codes/TOTP never logged or emailed (E2E asserts outbox) |
| 15 | ✅ | E2E: second device, recovery code, old session revoked, code reuse refused, TOTP without email code refused |
| 16 | ✅ / 🟡 | Dispatcher dedupe + honest UI state; real push failure paths on device pending |
| 17 | ✅ | Cross-owner op tests; unauthenticated and cross-origin API refused (E2E) |
| 18 | ✅ | `rules.test.ts` Saudi time |
| 19 | 🟡 | Same flow as 12; needs Mac/iPhone hardware run |
| 20 | ✅ | E2E |
| 21 | 🟡 | UI gating implemented; real iPhone run pending |
| 22 | ✅ | Voice and text share the same proposal path; tests cover correction / interruption / retry |
| 23 | ✅ | `admin.test.ts` + E2E: other owner / unauthenticated access to files and IDs refused; nothing from documents is in the AI context |
| 24 | ✅ | `rules.test.ts` |
| 25 | ✅ | `trackers.test.ts` |
