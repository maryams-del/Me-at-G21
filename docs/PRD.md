# Personal Life Dashboard — Product Requirements Document (PRD)

**Version:** 2.0 — FINAL implementation handoff (18 November 2026)  
**Product type:** Private, single-user, mobile-first AI-assisted personal management web app / installable PWA  
**Primary timezone:** Asia/Riyadh  
**Primary currency:** SAR, with configurable currencies  
**Target devices:** iPhone Safari / installed PWA and desktop browsers  
**Primary audience:** One owner; no multi-user collaboration required in v1.  
**Document status:** Complete product scope and acceptance requirements for Claude Code. Where implementation choices remain, choose the safest viable option and document the decision.

## 0. Executive summary and confirmed product decisions

**Build a real, private, mobile-first, installable web application, not a static mockup.** It must persist and synchronize data between trusted devices, have working navigation, tested features, authenticated private storage, reminders, and an AI assistant whose suggestions require explicit confirmation before anything is saved or changed. Desktop use matters, but an iPhone should feel like a first-class app.

### Confirmed decisions at a glance

| Decision | Requirement |
|---|---|
| Product | Personal, single-owner life dashboard and replacement for scattered notes |
| Home market | Saudi Arabia; timezone `Asia/Riyadh`, default currency `SAR` |
| Everyday sign-in | Passkeys with system Face ID / Touch ID when available; never rely on camera presence as a biometric test |
| Backup sign-in | Enrolled authenticator app (TOTP) and **pre-generated, offline, single-use recovery codes** using a secure recovery workflow; **not routine email or SMS OTP** |
| Recovery codes | Generate during account enrollment; show once and allow secure print/download. They are **not sent to an email address or phone number** as the default recovery mechanism |
| Stolen device | Allow secure recovery from another device without the stolen phone; support additional pre-enrolled passkeys, synced passkeys where recoverable, or strong reviewed recovery using an independently stored code and email verification |
| Separate password vault | **In scope**, but remains blocked for real credentials until independent security review; own step-up check, vault master passphrase/encryption, and separate recovery key |
| AI | Text and editable voice dictation; intelligent routing, follow-up questions, natural-language corrections, smart search; **explicit Confirm** before every AI write or reminder creation |
| Incomplete captures | User can choose `Fill details later`, then **confirm** creation of a draft in `Needs Details` |
| Waxing | Actual completion date anchors a 40-day cycle; remind on days 27/30/35/38/40, stop old reminders when done |
| Dental scaling | Due every **six calendar months** from completion |
| Toothbrush | Track bought date and first-use date; replace at three calendar months after first use, with advance reminder |
| Brushes/bedsheets | Weekly customizable cleaning/changing reminders |
| Quran class | Every Sunday, **19:00 Saudi time**; initial class alert **60 minutes ahead** (editable); independent homework and Quran translation study reminders |
| Money and religion | Charity ledger, multiple savings goals, lent/borrowed balances/reminders, subscriptions, zakat estimates/payments, fast debt ledger with configurable annual additions |
| Documents | Private upload/download, protected ID metadata and copy action; never public links by default |

**Explicit non-goals:** Important contacts, purchase warranties, health appointments, general courses/reading, generic yearly/monthly goals, separate Ramadan goals, birthdays/important dates. Do not insert these into the MVP.

---

## 1. Product vision

Build one secure, beautiful, low-friction place to remember, track and manage personal life information that would otherwise be scattered across Notes, reminders, documents and memory. It is **AI-first but not AI-autonomous**: the owner can type or dictate a natural-language request, inspect the assistant's proposed interpretation, correct it, and **explicitly confirm** before any persistent change occurs. All features must also be usable manually without AI.

Design for quick actions (typically a few taps), a useful dashboard, chronological history, trustworthy reminders, and searchable records. Make privacy, reliability and secure handling of sensitive data core requirements.

## 2. Non-negotiable design principles

1. **Explicit confirmation for all AI writes.** AI must not create, edit, delete, share, upload, schedule, reschedule or otherwise commit a record without an explicit human confirmation action. Reading/searching permitted non-vault data may be handled without a write confirmation. Disclose what will be changed; show diff or structured preview.
2. **AI is optional.** Every function works via regular forms and interfaces if the AI/API is unavailable.
3. **Incomplete is better than lost.** Users can save a draft with missing information; unresolved fields appear in `Needs Details`.
4. **User-controllable reminders.** Every reminder has enable/disable, editable lead time, delivery channel, snooze and completion semantics.
5. **Sensitive data isolation.** Passwords/PINs/recovery codes are not exposed to AI, analytics, logs, search indexing, or ordinary app storage; avoid passing menstrual-health details or sensitive ID content to a third-party model without explicit user consent.
6. **Never invent dates, amounts, completion or payments.** The UI displays dates/times in Asia/Riyadh by default, stores timestamps unambiguously, and distinguishes due dates from actually completed dates.
7. **Personal single-user app.** No community, advertising, shared feeds or public profiles.
8. **Accessibility and resilience.** Responsive interface, keyboard accessible, touch targets, reduced-motion support, clear empty states, safe retry behavior and reliable backups.

## 3. Information architecture / navigation

- **Home Dashboard:** Today, upcoming reminders, overdue items, pending AI confirmations, `Needs Details`, class reminders, fasts balance, savings progress, applications, recent activity.
- **AI Quick Capture:** Persistent, prominent entry point from every screen; text input, microphone, attachment control (where permitted), conversational preview and confirmation.
- **Finance:** Charity; Savings; Money Lent/Borrowed; Subscriptions; Zakat.
- **Personal Care:** Period Log; Waxing; Dental Scaling; Recurring Hygiene Routines.
- **Education & Career:** Master's Applications; Projects & Tasks; Quran Classes & Homework; Achievements / Hobbies.
- **Faith:** Make-Up Fasts and related history; Zakat may cross-link to Finance.
- **Life Admin:** Expiries & Renewals; Document Vault.
- **Secure Vault:** Credentials, passwords, PINs, recovery codes; independently gated.
- **Inbox / History:** Needs Details, all permitted non-vault activity and global search.
- **Settings:** Account, security, passkeys, reminder preferences, time zone, data export, backups, AI permissions and integrations.

Layout: desktop left sidebar + central content; mobile bottom navigation for core areas with a clearly visible AI action. Prefer concise overviews and progressive disclosure over massive forms.

## 4. Detailed functional requirements

### 4.1 Home Dashboard
- Show upcoming 7 days, overdue tasks, recently completed tasks, the next Quran class, outstanding homework, annual make-up fast balance, current month's charity total, savings goals and application deadlines.
- Quick actions: `Log charity`, `Period started`, `Period ended`, `Waxing completed`, `Fast completed`, `Add savings`, `Add task`, `Add entry by AI`.
- Each widget opens its dedicated tracker. Widgets can be hidden/reordered later.
- Show notification state if browser/PWA permissions are missing; never imply a push alert was delivered if it was not.

### 4.2 Monthly Charity
**Fields:** payment date (default current local date), platform/recipient, cause/category, amount, currency, note, optional receipt, optional recurring designation.  
**Functions:** add/edit/delete with confirmation, filter/search by date/platform/cause, monthly/yearly totals, chronological history, optional monthly goal and reminder. Do not assume that a planned donation has been paid; separate `planned` from `completed`.

### 4.3 Menstrual Period Log
- Explicit `Period started` and `Period ended` actions. Record accurate local date and optional time, notes, symptoms optional, and corrections to past dates.
- Calendar and history of cycles with start/end and length; optional prediction based on prior cycles, clearly marked as an estimate, not a medical assertion.
- No automatic disclosure to AI, email summaries, analytics, or general dashboards unless owner opts in. Provide privacy controls for dashboard visibility and notifications.

### 4.4 Waxing
- Log actual waxing date, optional body area/note.
- Rule: remind as the elapsed time since **last actual waxing** nears 30 days; session should occur **within 40 days** of the original logged date. Default reminders at day **27, 30, 35, 38 and 40** after last completion, fully editable.
- Display `Last session`, `Day X of 40`, `Next recommended date (day 30)`, `Latest target date (day 40)` and `Overdue` after day 40.
- Upon logging completion, cancel prior pending reminders and create new schedule relative to actual completion date, not previous forecast.
- If historical data is corrected, recalculate safely; don't duplicate reminders. Explicitly label the 40-day window as the owner's personal goal.

### 4.5 Dental Cleaning / Scaling
- Log actual dental scaling date, optional clinic/note.
- **Due every six calendar months** from the actual completed date; next due recalculates on completion.
- Initial suggested reminders 2 weeks prior, 1 day prior and on due date; editable. Use calendar-month arithmetic with explicit end-of-month handling.
- Avoid implying this interval is universal medical advice; it is the owner's chosen cadence.

### 4.6 Recurring Hygiene Routines
Reusable `routine` object: name, last completed/purchased/started date (type-dependent), interval (days/weeks/calendar months), next due date, advance reminder offsets, notification channels, notes, pause status and history.
- Toothbrush: last **purchase date** and **first-use date** stored separately. Replacement target = **3 calendar months after first use** by default, with reminder 14 days before and on due date; allow customization.
- Makeup brush cleaning: default every **7 days**, customizable; 1 day before/on due.
- Bedsheet changing: default every **7 days**, customizable; on due.
- Completion action logs immutable historical event and recalculates future due date. Skip, snooze, pause and backdate supported. Never silently mark completion.

### 4.7 Make-Up Fasts
- Set an opening debt/balance with optional as-of date.
- Keep an append-only ledger of `initial balance`, `annual additions`, `manual adjustments` (reason required), and `fast completed` events.
- **Balance = initial balance + additions + signed adjustments − completed fasts**. Enforce no accidental negative balance; warn and require explicit override for historical corrections.
- Owner configures annual addition rule (amount, recurrence date, calendar basis: Hijri or Gregorian) or manually enters an addition each year. **Do not invent automatic yearly quantities**. Idempotency ensures each scheduled year is added at most once.
- Fast completed action records local date and decreases balance by 1; allow multiple completions only on distinct eligible dates unless an explicit historical correction is entered.
- Display balance, completed by year, ledger history, calendar, and optional target/reminders. Handle Hijri dates using an identified configurable calendar convention; show Gregorian equivalent; account for calendar variation.

### 4.8 Savings Goals
- Multiple concurrent named goals, target amount, currency, optional target date, opening balance, optional recurring monthly planned contribution.
- Actual deposits and withdrawals are ledger transactions; calculated current progress = opening balance + deposits − withdrawals, with percentage and remaining amount.
- Show month-by-month contributed amount, total balance, history, progress bar, milestones and configurable reminders for monthly planned contribution.
- Distinguish **goal targets / plans** from **actual money saved**; no bank connectivity required.

### 4.9 Money Lent / Borrowed
- Type `I lent` or `I borrowed`, person/name, original amount/currency, transaction date, optional due date, notes, status, partial repayments and payment history.
- Calculate outstanding amount accurately. Mark fully settled only when outstanding reaches zero or owner explicitly corrects amount with audit note.
- Reminders: customizable X days before due, on due and overdue repeat intervals; user can snooze, edit, stop, or mark settled. Reminders should clearly distinguish `I need to repay` versus `I need to collect`.
- No automatic contact with other people; no messages sent without explicit owner action.

### 4.10 Subscriptions
- Service name, cost, currency, cadence (monthly/yearly/custom), next billing date, payment method **label only** (no card number), renewal behavior, optional trial end, notes, URL, active/cancelled state.
- Renewal notifications and trial-end alerts with editable lead times. Aggregate monthly-equivalent spending and show calendar of upcoming charges.
- No subscription cancellation automation in v1.

### 4.11 Expiries & Renewals
- Item label/type, expiration date, optional issuing organization, document reference, notes, status, optional renewal date and new expiry after renewed.
- Default lead reminders 90, 30, 7 days before expiration, configurable per item.
- Support passports, IDs, licenses, bank cards, memberships and arbitrary custom entries. Sensitive identifiers are not displayed in notification previews.

### 4.12 Document Vault and ID Numbers
- Store document entries such as passport, national ID, transcripts, certificates, CV versions, application files and official letters.
- Structured metadata: document title/type, optional masked ID, full ID stored in protected field, issuing authority, issue and expiry date, notes, tags, upload(s), version history.
- Owner may reveal/copy ID number only after appropriate authentication; explicit confirmation before sharing. Permit download, local device share sheet / email attachment workflow without creating public permanent file links.
- Private file storage, encryption at rest, short-lived authorized download links, strict storage access controls, file-size and type restrictions, no public indexing; never leak document content into AI without explicit opt-in.
- For extremely sensitive documents, consider separate client-side encryption and review exact recovery implications.

### 4.13 Master's Application Tracker
- University, program, country, intake, application URL, deadline with timezone, status (researching/preparing/submitted/interview/decision/accepted/rejected/withdrawn), requirements checklist, documents and links, fees (optional), funding/scholarship, notes, contacts (free text), follow-up tasks.
- Sort by next deadline; highlight upcoming 30/14/7/1-day dates, customizable; show kanban/list/detail views.
- Allow multiple applications per institution. Persist dated status history and submission date.
- All deadlines entered or verified by user; AI must never assume an externally stated application deadline is correct without confirmation.

### 4.14 Projects, Tasks and Deadlines
- Project (e.g. `Update my portfolio website`) with description, status, target date, optional priority, links and related achievements.
- Subtasks with assignee implicit owner, due dates, reminders, checklists, completion dates, attachments and notes. Support backlog/in-progress/done, deadline views and reminders.
- Manual project creation and AI capture. No automatic project completion from due date.

### 4.15 Career Achievements Bank & Hobbies
- Add accomplishments, work/academic/personal projects, hobbies, volunteering, awards, technical skills, relevant dates, outcome metrics, links, optional portfolio-ready summary, media attachments, tags.
- Filters and exportable concise CV/portfolio bullets; AI may draft language from permitted fields but **must not invent achievements or metrics**.
- Allow linking an achievement to a completed project or master's application.

### 4.16 Quran Classes & Homework
- Initial recurring class: **every Sunday at 7:00 PM Asia/Riyadh** (19:00); recurring indefinitely until changed or paused.
- Initial class reminder: **60 minutes before**, thus **Sunday 6:00 PM**, fully editable per class or globally.
- Each occurrence has its own homework checklist (title, description, optional surah/ayah reference, notes, due date/time, priority, completion state, last edited), preparation notes, and attendance optional.
- Provide `Learn Quran translation` as a distinct recurring study task. **Suggested initial reminder: Saturday at 7:00 PM, one day before class**, but make reminder day/time and homework due time configurable; allow user to change or disable suggestion before activating it.
- Home dashboard displays upcoming class, how long until class, incomplete homework, and translation reminder.
- Class-level recurrence rule and task-level due/notification rules must be separate. Completing this week's homework must not complete next week's. Allow class cancellations/skipped weeks and exceptions.
- Provide generic recurring events/classes structure so owner can add other repeating commitments later.

### 4.17 Zakat Calculator & Payment History
- Support owner-entered applicable assets, eligible deductions/liabilities, currency, evaluation date, and selected nisab basis. Use clearly labelled sourced rate inputs if up-to-date prices are enabled, otherwise manual prices.
- Show transparent step-by-step estimate and configurable zakat percentage (default suggestion 2.5% for commonly applicable monetary assets, not a blanket religious ruling), and note that applicability, nisab and lunar-year rules vary by circumstance and interpretation.
- Save calculation snapshots and separately log actual zakat payments/date/recipient; never treat an estimate as a payment.
- Do not give definitive religious rulings or automatically transfer funds.

### 4.18 AI Quick Capture and Assistant (core differentiator)
**Entry points:** persistent header button, floating mobile action and dashboard input. Accept text and microphone dictation; transcript is editable before sending.

**Required pipeline:**
1. User writes/speaks a command, potentially containing **multiple actions**.
2. AI classifies into existing module(s), extracts proposed structured fields and identifies missing/ambiguous fields.
3. AI shows an explicit **preview** of each proposed operation: destination, amounts, dates, reminders, and exactly what will be changed.
4. AI asks concise **context-aware questions** when information needed for safe accuracy is missing (avoid excessive prompts); optional `Fill details later` creates an incomplete **draft** *only after confirmation*.
5. User can correct in natural language (`make that 150 SAR`, `no, next Thursday`); preview updates but no commit.
6. Only after owner hits **Confirm** does app validate and persist the approved operation(s) transactionally with a clear success/failure message. Batch capture allows per-entry confirm/uncheck before commit.
7. AI may suggest reminders, but cannot schedule reminders until confirmation; it cannot delete or overwrite records silently.
8. All AI operations must be auditable, idempotent and undoable where feasible. Enforce server-side permissions and validation, not just UI checks.

**Examples:**
- `I donated 100 riyals through [platform] for [cause] today` → Charity entry.
- `I lent Sara 200 SAR yesterday, she will repay Friday` → Money lent entry + suggested due reminder.
- `I completed one fast and changed my bedsheets` → two reviewed entries.
- `I have Quran homework: learn the translation of [verses] by Sunday` → task linked to next Quran class; missing surah/verses can be added later.
- `When did I last get dental scaling?` → search / answer grounded in stored event.
- `How much did I donate this year?` → aggregate from stored charity transactions with date range shown.

**Smart search:** structured filters and semantic queries over **user-authorized non-vault** records; return linked source entries, show calculation context, handle no-results honestly. No access to password/PIN/recovery-code contents, decryption keys or vault plaintext; no automatic ingestion of sensitive uploaded documents or menstrual records into external models.

**AI trust boundary:** prompt injection protections, strict structured-output schemas, deterministic backend validators, operation allowlists, rate limiting, consent for third-party data processing, retention limits, redaction of PII and secrets in observability. Do not trust LLM-supplied authorization, database queries or changed record IDs.

**Protected search rule:** The owner can still locate her own sensitive period events and document metadata through a protected, deterministic app search where explicitly authorized. Do **not** solve this by transmitting those details to a third-party AI model by default. The same boundary applies to voice transcripts: secure/private recording handling, clear permission, transcription preview and deletion controls. Never record microphone audio without a user action.

### 4.19 Notifications & Reminders
- Reminders require durable backend scheduling and delivery-status tracking; browser tabs being closed should not stop due events from being calculated.
- Delivery options: in-app reminders; web push where supported and permitted; **optional email fallback** for critical reminders. User chooses channels and quiet hours.
- **iPhone web-push requirement:** iOS web push requires a compatible iOS version, HTTPS, an app added to the Home Screen, and notification permission requested after user interaction. On iPhone, guide the owner through `Add to Home Screen` and `Enable reminders` and show the actual permission/subscription state. Do not claim standalone Safari tabs will receive the same notifications as an installed app; verify on real devices.
- Mobile web push support and installation/permission constraints vary; app must clearly tell user if device/PWA settings prevent pushes. Test real iPhone behavior rather than assuming background notification success.
- Deduplicate across devices and retried jobs, use absolute timestamps, respect timezone and calendar recurrence; record sent/dismissed/snoozed/completed state.
- Every reminder can be changed without touching the underlying completed-event history; overdue behavior customizable.
- Notification privacy: avoid displaying IDs, period details, specific health data or vault contents on locked-screen previews unless owner explicitly opts in.

### 4.20 History, Inbox and Export
- `Needs Details` holds confirmed-but-incomplete drafts with source text, target section and missing fields; resume and finish later.
- Global timeline of permitted events with date, category and action (`created`, `edited`, `completed`, `renewed`, etc.). Search by date, category and keywords. Vault secret activity is only represented as minimal redacted security audit events, never plaintext.
- Data export for non-secret app data as machine-readable JSON and optional CSV by module. Secure export for vault data (if implemented) must require re-authentication, explicit warnings and reviewed encrypted export format; no plaintext bulk secrets export by default.
- Backup and restore with integrity checks. Deletion requires confirmation and clearly defined retention/recovery behavior.

## 5. Authentication and secure vault architecture

### 5.1 Main account sign-in: passkey-first, with safe recovery
- **Primary daily authentication:** WebAuthn/FIDO2 passkeys, with the device's built-in user verification (Face ID on supported iPhones, Touch ID where available, or another operating-system-approved method). User must be offered passkey registration during onboarding and may register multiple passkeys/trusted devices.
- **First-time enrollment:** verify control of the user's email address with a single-use, short-lived verification link or code strictly for initial account bootstrap, then require registering a passkey and backup recovery methods. **Email OTP must not be the default recurring sign-in method or an email-only account takeover path.**
- **Device capability UX:** detect WebAuthn/platform-authenticator support, not merely whether a camera is present. Offer 'Enable Face ID / Touch ID' where platform authentication is supported, but explain that browsers do not reliably distinguish/force a specific biometric and may show device PIN as an alternative. A passkey must actually be enrolled through the native browser/system WebAuthn flow.
- **Authenticator-app backup:** support standard TOTP registration with QR setup, proof-of-enrollment challenge, securely protected TOTP seeds, one-time code verification, rate limiting, clock-drift tolerance, and ability to remove/re-register following fresh authentication. Do not assume the TOTP app is accessible after the phone is stolen; encourage an independent/securely recoverable copy.
- **Emergency recovery codes:** default to **10** cryptographically random, high-entropy, individually single-use account-recovery codes at enrollment; display once with print/download option and a strong warning to keep copies offline/outside the phone and outside this app; clarify that these codes are generated during setup and **are not emailed or texted to a phone number**. Store only protected verifiers server-side; show which codes remain unused, allow rotation only after fresh verification, and invalidate old codes on rotation.
- **Loss of all passkeys:** provide a carefully designed recovery flow with verified email **plus** one independent already-enrolled recovery factor (e.g. valid unused recovery code or accessible TOTP), with rate limits, security notifications, recovery audit events, and risk-based restrictions/delays before sensitive credential or device changes. Recovery code/TOTP alone must not bypass required independent checks. If all factors are unavailable, do not implement insecure 'just email support' account reset; explain limitations.
- **Multiple device prevention:** encourage registering a second passkey on an independent trusted device (e.g. Mac, hardware security key) before any loss. Apple iCloud Keychain-backed synced passkeys may become available on a replacement Apple device after Apple Account and Keychain recovery, but this depends on the user's sync/recovery configuration; never guarantee immediate restoration. Signing into a new computer via a phone QR-code flow depends on having the phone; do not present it as the only lost-phone path.
- **After recovery/theft:** present session/device/passkey inventory, remotely revoke lost device sessions and registered authenticators when appropriate, enroll a new passkey, rotate recovery codes, and alert the user to any security-sensitive changes. Revoke sessions separately from passkey registration and recognize that remote app revocation cannot erase data already on a stolen device.
- **Session security:** secure HTTP-only cookies, CSRF protection as appropriate, HTTPS/HSTS, session timeout, logout-all-devices, step-up for sensitive account changes, relevant activity notifications, and strong login/recovery attempt throttling.
- **Two separate recovery boundaries:** account access recovery restores dashboard authorization only. It **must not** decrypt the zero-knowledge password vault. A distinct vault passphrase or securely protected vault recovery key is required for vault secrets.

### 5.2 Independent password/PIN vault access
- **Vault remains in product scope.** Credentials/PINs/recovery codes are accessible only within a separately authenticated and encrypted area. Never store them as ordinary plaintext database columns, ordinary notes, or document metadata.
- On **first vault setup / first unlock on a new device** require **fresh passkey verification**, or a reviewed, suitably strong step-up method during account recovery, **plus a separate vault master passphrase** used to unlock independently protected decryption key material. Dashboard login alone must not unlock the vault. Do not rely on email OTP for routine vault entry.
- Offer **passkey/Face ID/Touch ID-assisted subsequent access** after explicit device enrollment; implement a biometric-only convenience unlock **only if an audited, well-supported design securely protects and releases the vault encryption key on that device**. A WebAuthn sign-in by itself does *not* decrypt data. If the required capability is not safely supported in a particular browser/device, still require the vault passphrase; never fake a Face ID lock by merely toggling a UI state.
- Use a vetted, audited encryption/key-management design, e.g. authenticated client-side encryption with independent, securely derived keys (Argon2id for passphrase-based derivation when appropriate, with well-calibrated parameters; established cryptographic primitives; unique nonces; versioned envelope format). Never invent a custom encryption algorithm or expose keys to the server.
- Passwords and secrets must remain encrypted before syncing; backend stores ciphertext, encrypted key wraps, and minimal metadata. Secure copy/reveal controls, auto-lock timeout, clipboard hygiene where supported, hidden by default, no credentials in logs/telemetry, protection against XSS and unsafe dependencies.
- **Vault recovery must be explicitly designed**: an **independent offline vault recovery key** or another vetted cryptographic mechanism, separate from account-recovery codes; user instructions, lost-device flow, test restoration on another device. Account recovery, TOTP, email verification, or dashboard recovery codes **must never be sufficient to decrypt the vault**. Warn clearly that loss of the passphrase/recovery key may mean permanent loss of vault contents.
- Vault search can run locally after decryption; AI search is prohibited from reading secret values.
- Implement using a well-established password-manager backend/integration if technically feasible; otherwise treat a custom vault as a separate security engineering project. Require independent expert security review, attack modeling, penetration testing and production readiness approval **before storing actual credentials**.
- During early development use dummy test secrets only. A working UI or passing automated tests are NOT proof of password-vault safety.

### 5.3 Password vault release gate and permitted integrations
- Strong preference: select a **mature, well-reviewed password-manager integration** rather than inventing an independent password manager. The integration must actually support the desired in-app flow and protect stored secrets; do not claim that embedding another product is automatically possible.
- If this cannot be safely implemented within scope, deliver a polished **locked vault placeholder or link-out** labelled `Not enabled for real passwords yet` while retaining the complete security design and implementation tasks in the project. Never quietly store actual passwords in ordinary backend rows as a temporary shortcut.
- Document the exact threat model: compromised application server, lost/stolen logged-in phone, malicious browser extension/XSS, lost master password, stolen session, account recovery abuse, and lost device with no independent recovery factors.
- **Definition of security-ready** requires documented cryptographic architecture and independent expert review, verified on-device key handling, recovery testing on a second device, dependency review and remediation, penetration testing, and a clear user-facing warning on irrecoverable secrets.

### 5.4 Separate sensitivity levels
- Ordinary tracker content (tasks, achievements, charity amounts) is private per user.
- Sensitive data (period logs, ID numbers, stored documents) has stricter access control, clear consent for AI, redaction in notifications and careful encryption policies.
- Highest sensitivity (passwords, banking PINs, backup/recovery codes) belongs solely in secure vault, never AI prompts or standard search.

Reference design guidance: OWASP Authentication, Multifactor Authentication, Passkey Security, Cryptographic Storage, Password Storage and Key Management Cheat Sheets; Apple passkeys/WebAuthn documentation. These are engineering references, not certifications.

## 6. Data model (conceptual)

Shared properties for most non-vault records: `id`, `owner_id`, `created_at`, `updated_at`, `status`, `notes`, `attachments`, `source` (manual/AI), and optional `deleted_at`.

Tables/entities expected:
- `users`, `auth_devices`, `passkey_credentials`, `totp_authenticators`, `account_recovery_code_verifiers`, `account_recovery_events`, `account_security_events`, `notification_preferences`
- `charity_payments`
- `period_cycles`
- `maintenance_activities` and `maintenance_completion_events` (waxing, dental, etc.)
- `routines`, `routine_events`
- `fast_ledger_events`, `annual_fast_addition_rules`
- `savings_goals`, `savings_transactions`
- `debts`, `debt_repayments`
- `subscriptions`
- `expiry_items`, `renewal_events`
- `documents`, `document_versions`, `document_files`, `protected_id_fields`
- `masters_applications`, `application_requirements`, `application_status_events`
- `projects`, `tasks`, `task_completion_events`
- `achievements`, `hobbies`
- `recurring_events`, `event_occurrences`, `homework_tasks` (Quran class is an instance)
- `zakat_calculations`, `zakat_payments`
- `reminders`, `notification_deliveries`
- `ai_proposals`, `ai_proposal_operations`, `capture_drafts`, `audit_events`
- `vault_ciphertext_items`, `vault_key_envelopes`, `vault_security_events` **only after approved vault architecture**.

Critical data modeling requirements:
- Money uses precise decimal/integers in minor units, never floating-point totals.
- Durable event history for fast balances, contributions, repayments, completions and recurring activity.
- Store canonical instants in UTC where relevant and IANA timezone for local rules. Distinguish local-only dates from datetimes.
- Recurrence expansions are deterministic and idempotent. No duplicate annual adjustments or repeat reminder sends.
- User-owned records enforced in backend authorization / row-level security, not client filters alone.
- Uploaded files are private by default with constrained authenticated access.

## 7. UX / visual requirements

- Elegant, warm, minimalist visual style; spacious but information-dense enough to be useful. No cluttered enterprise admin dashboard aesthetics.
- Desktop and mobile responsive, polished light mode and dark mode.
- Mobile primary actions at thumb reach; quick-add entry always reachable.
- Consistent tracker patterns: top summary, primary action, history/activity, upcoming reminders, settings.
- Action feedback: optimistic UI only where rollback is safe; otherwise accurate save/success status. Clear empty states with useful examples.
- Privacy: default-hidden secret fields, no auto-reveal on screenshots/search, redacted push previews.
- Full keyboard operation, high contrast, labels, error messaging and accessible forms.

## 8. Recommended implementation approach (not a binding vendor choice)

- Responsive TypeScript web app, e.g. Next.js / React, Tailwind CSS and accessible component library; installable PWA where supported.
- Managed PostgreSQL backend with strict per-user authorization, migrations and private object storage; background scheduler/queue for reminders.
- Carefully vetted authentication service supporting WebAuthn/passkeys as the primary sign-in, TOTP as a backup factor, single-use account recovery codes, multi-device enrollment, and documented account-recovery/risk controls. **Verify exact provider capabilities and pricing; do not assume the provider implements secure recovery automatically.**
- Server-side AI adapter using a strict schema for proposals, redaction layer, permission checks and confirmation-token workflow. Keep model/API keys server-side.
- Browser/device speech-to-text where available, with tested fallbacks; ask permission explicitly.
- Hosted email provider for one-time **initial account/email verification**, security alerts, and optional reminder messages; web push implementation where supported. No routine email OTP sign-in.
- Strong test suite: unit tests for recurrence/counts; integration tests for permissions and confirmation gating; end-to-end tests for iPhone/desktop and lost-device recovery.

Claude should propose a concrete stack and explain tradeoffs before writing implementation. Never implement security-sensitive features using fabricated capabilities or unreviewed custom crypto.

## 9. Implementation phases and priorities

**Phase A — foundation / working MVP**
- Main account auth with initial email ownership verification, primary passkey enrollment, TOTP setup, offline single-use recovery codes, multiple trusted passkeys, and tested lost-device recovery (provider verified); responsive shell and dashboard.
- Manual CRUD and trustworthy history for charity, waxing, dental, hygiene routines, fast ledger, savings, money lent/borrowed, projects/tasks and Quran class/homework.
- General notifications and recurrence infrastructure.
- Structured AI capture proposal → corrections/questions → **explicit confirm** → save; smart search on approved records; text and voice input where supported.

**Phase B — full life admin and growth**
- Master's applications, subscriptions, expiry tracking, achievements/hobbies, protected document vault/IDs, period tracker and zakat calculator/history.
- Multi-device sync, reporting, data export and backups, advanced reminder customization.

**Phase C — high-security credentials vault (release-gated)**
- Design reviewed independently; implement tested client-side encryption + separate vault step-up authentication, protected key lifecycle, recovery, audited device-assisted unlock if supported.
- Dummy-secret testing, external security review and remediation, then staged enablement for real secrets. Do not deploy usable real-secret storage without completing security gate.

Phases are suggested engineering order, not permission to omit any committed requirement from the final product.

## 10. Acceptance criteria / test scenarios

1. Logging waxing on Nov 1 schedules default reminders day 27/30/35/38/40; logging a new waxing on Nov 29 cancels old reminders and resets from Nov 29.
2. Dental scaling on Jan 31 produces next due date six calendar months later with sensible end-of-month behavior; settings adjust reminders.
3. Toothbrush purchased one day but started another uses **first-use** date for 3-month replacement; records both dates.
4. Annual fast addition runs once per configured year, never duplicates after refresh/retry; marking fast completed once decrements outstanding by 1 and logs the date.
5. Partial debt repayment updates outstanding total and reminders; `I owe` and `owed to me` are clearly differentiated.
6. Savings contribution records increase actual savings; monthly savings goal alone does not.
7. Quran class appears every Sunday at 19:00 Asia/Riyadh; initial reminder is 18:00, user may change to 30 minutes; translation task has a separate editable reminder; each occurrence has independent homework state.
8. AI parses `Donated 100 SAR, changed bedsheets, and finished a fast` into three previews. **No records or reminders exist until owner explicitly confirms.**
9. AI handles `Actually, make the donation 150` by changing preview only, without silently writing data.
10. For `Add passport expiry` with no date, AI offers one useful question and `Fill details later`; confirmed draft appears in Needs Details.
11. Searching `when did I last wax?` cites actual historical log entry, with no fabricated result when none exists.
12. New owner verifies email during onboarding, enrolls a passkey (Face ID/Touch ID if available), and sets up TOTP and offline single-use recovery codes. Everyday sign-in is passkey-first, not email OTP; camera detection alone never triggers false Face ID claims.
13. Password vault requires distinct fresh passkey/approved step-up verification **and** independently protected decryption key unlock; a user logged into dashboard alone cannot see decrypted secrets. Dashboard account-recovery methods alone cannot unlock vault ciphertext.
14. AI API calls, logs and telemetry provably contain **no** password/PIN/recovery-code plaintext; browser/UI controls do not substitute for server-side auth.
15. Simulated stolen-iPhone scenario succeeds on another device via a second registered passkey, restored synced passkey, or **verified email plus a previously enrolled independent recovery factor**. Authenticator availability is never assumed after theft; sessions/passkeys can be revoked. **Account access recovery cannot decrypt encrypted vault secrets** without their separate passphrase/recovery key.
16. Browser/push permission denial, failed delivery and offline mode show accurate status; never silently promise a reminder was received.
17. All records are owner-only; negative authorization tests prevent access to other IDs or private uploaded files.
18. All timestamps/dates preserve Saudi-time meanings across storage and display.
19. On a compatible iPhone, onboarding can register a passkey through the native system prompt using Face ID/Touch ID where configured. A laptop with Touch ID uses the corresponding OS prompt. Unsupported devices get an honest fallback without fake biometric UI.
20. Recovery codes are generated during setup, displayed only once, can each be used once, and are **not delivered by SMS/email**; the user can print or download and verify recovery works from another device without relying on the lost phone.
21. An installed iPhone PWA can request push permission after a user gesture; a non-installed browser view provides setup instructions rather than silently claiming push is active.
22. Both voice-dictated capture and manually typed capture support corrections to a pending proposal; interruption or retry never creates a record until the owner confirms it.
23. Uploaded identity PDFs cannot be reached by guessing an object URL or changing a record ID, and no document or ID value is exposed to any AI provider without a specific affirmative consent flow.
24. Calendar-month six-month dental and three-month toothbrush rules handle leap years and end-of-month dates consistently; days 27/30/35/38/40 waxing reminders remain tied to the latest actual waxing entry.
25. A Quran class cancellation affects only the selected occurrence unless the owner chooses all future events; homework from a previous class remains historically available.

## 11. Explicit exclusions

Do not build important contacts directory, purchase/warranty tracker, general health appointment management, course/reading tracker, yearly/monthly goal manager, Ramadan-goals module, or birthdays/important-dates module in v1. No payments, banking integration, automatic external messaging, or autonomous AI transactions.

## 12. Instructions to Claude Code / delivery expectations

1. Treat this PRD as the source of truth, especially **confirm-before-write**, Saudi local dates, recurrence rules and separate vault security requirements.
2. First return: proposed architecture, exact libraries/providers and their verified capabilities, database schema, UI sitemap, milestone plan, explicit security threat model, and outstanding assumptions. Avoid claiming a product or API feature without checking.
3. Build in small testable phases; include running instructions, environment-variable template, migrations, seed/demo data, test commands, and readable error handling.
4. Use **fake demo records only**, especially for vault and identity features. Never ask for or embed my real passwords, bank PINs, OTPs, recovery codes, passport number or ID PDFs in source code, prompts, screenshots, fixtures, analytics or AI requests.
5. No API secret in front-end bundles. No public storage buckets, auth bypass, client-only authorization, or plaintext logging of sensitive records.
6. Every AI-generated mutation must run through a user-reviewed and confirmed proposal; test this invariant exhaustively.
7. Mark all vault screens **NOT APPROVED FOR REAL SECRETS** until security architecture, key management, recovery and independent review pass release gates.
8. When forced to choose, prioritize safety, data integrity, explicit user control and reliable core workflows over adding more features.

## 13. Open implementation decisions (safe defaults)

- Confirm which provider supports passkey-first WebAuthn, TOTP, secure single-use recovery codes, multiple devices, initial email verification and account recovery on target browsers; specify safe fallback if biometrics are not available.
- Owner to choose whether urgent reminders should also be emailed if push unavailable; default in-app with optional push/email only after opt-in.
- Default translation-study reminder = Saturday 19:00 (suggested, owner editable).
- Default fast annual cycle calendar (Hijri or Gregorian) and addition amount must be selected by owner; do not auto-generate a debt value.
- Choose encrypted file-storage strategy and password-vault integration/implementation only after threat modeling and review.

## 14. Required delivery artifacts and definition of done

Claude Code should produce all of the following in the repository; this PRD alone is not the finished product:

1. **Architecture decision record:** stack/providers, why selected, alternatives considered, costs and free-tier limits, and specifically verified passkey/TOTP/recovery and PWA push capabilities.
2. **Working app:** responsive iPhone/desktop navigation with all requested modules, real persisted data, no decorative buttons that do nothing, thoughtful onboarding and accessible empty states.
3. **Versioned schema and migrations:** integrity constraints, private file access, indexes, account ownership and repeat-job deduplication.
4. **API/service design:** consistent CRUD, ledgers, schedule engine, notifications, AI proposal/confirmation and security boundary; avoid direct client writes that bypass policy.
5. **Auth and lost-device recovery walkthrough:** iPhone and a second device, passkey enrollment, authenticator setup, safe recovery-code handling, new-device login and session revocation.
6. **Complete AI interactions:** editable voice transcript, structured preview, context-aware clarifications, corrections, multiple-action confirmations, confirmed partial drafts, smart search with source-entry links and safe error states.
7. **Reminders implementation:** persistent jobs, web push subscription workflow, iPhone install instructions, email fallback only if configured, visible delivery status, and configurable lead times.
8. **Test coverage:** recurrence unit tests, ledger and rounding tests, AI no-write-before-confirm tests, authorization/security tests, passkey/recovery E2E, iPhone-PWA push and accessibility smoke tests.
9. **Developer handoff:** `.env.example` with placeholders only, README, install/run/test/deploy guide, staging deployment, data backup/restore instructions, known limits and operational checklist.
10. **Security release checklist:** separate vault threat model, key management and recovery plan, security review evidence and visible disabled-for-real-secrets flag until approved.

### Claude's required working sequence

- **First response**: inspect this PRD, propose stack and service providers, explain the authentication and encrypted-vault approach, produce sitemap and data model, and outline phase milestones. Call out genuine blockers. Do **not** begin by pretending the secure vault is already solved.
- **Implementation**: create and test each phase end-to-end. Treat `Confirm before AI write` as a server-enforced invariant; choose safe temporary behavior instead of introducing insecure shortcuts.
- **Sign-off**: map every item in Section 4 and every test in Section 10 to a passing feature/test or an explicit outstanding issue. Clearly distinguish implemented, simulated and security-review-gated capabilities.

## 15. Technical reference links for implementation review

These documents are reference material for engineering validation—not a claim of certification or a substitute for a security audit. Confirm current browser and vendor specifics during development.

- Apple passkeys: https://developer.apple.com/passkeys/
- WebKit Face ID/Touch ID for the web: https://webkit.org/blog/11312/meet-face-id-and-touch-id-for-the-web/
- WebKit iOS/iPadOS Web Push: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- OWASP Passkey Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Passkey_Security_Cheat_Sheet.html
- OWASP MFA Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
- OWASP Forgot Password Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

**End of final PRD.**
