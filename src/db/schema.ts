/**
 * Database schema (Phase A + shared infrastructure).
 *
 * Conventions
 *  - Money: bigint minor units (halalas for SAR) + ISO currency code. Never floats.
 *  - Local calendar dates (no time) use `date` columns as 'YYYY-MM-DD' strings,
 *    interpreted in the owner's IANA timezone (default Asia/Riyadh).
 *  - Instants use timestamptz (stored UTC).
 *  - Every user record carries owner_id; all service queries filter by it.
 *  - Ledgers are append-only: corrections are new rows or `voided_at`, never silent edits.
 */
import {
  pgTable, text, uuid, timestamp, date, integer, bigint, boolean, jsonb,
  uniqueIndex, index, smallint, pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const owner = () => uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" });
const money = (name: string) => bigint(name, { mode: "number" });

export const recordSource = pgEnum("record_source", ["manual", "ai"]);

/* ───────────────────────────── Accounts & auth ───────────────────────────── */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  displayName: text("display_name"),
  timezone: text("timezone").notNull().default("Asia/Riyadh"),
  defaultCurrency: text("default_currency").notNull().default("SAR"),
  /** onboarding: email_verified → passkey → totp → recovery_codes → complete */
  onboardingStep: text("onboarding_step").notNull().default("email"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)]);

export const authSessions = pgTable("auth_sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  /** passkey | recovery | onboarding */
  method: text("method").notNull(),
  deviceLabel: text("device_label"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  stepUpAt: timestamp("step_up_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [uniqueIndex("auth_sessions_token_uq").on(t.tokenHash), index("auth_sessions_user_idx").on(t.userId)]);

export const passkeyCredentials = pgTable("passkey_credentials", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull(),
  publicKey: text("public_key").notNull(), // base64url COSE key
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  transports: jsonb("transports").$type<string[]>(),
  deviceType: text("device_type"), // singleDevice | multiDevice (synced)
  backedUp: boolean("backed_up").notNull().default(false),
  aaguid: text("aaguid"),
  nickname: text("nickname").notNull().default("Passkey"),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [uniqueIndex("passkey_cred_uq").on(t.credentialId)]);

export const webauthnChallenges = pgTable("webauthn_challenges", {
  id: id(),
  userId: uuid("user_id"),
  purpose: text("purpose").notNull(), // register | login | stepup
  challenge: text("challenge").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const totpAuthenticators = pgTable("totp_authenticators", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  secretEnc: text("secret_enc").notNull(), // AES-256-GCM envelope, never plaintext
  label: text("label").notNull().default("Authenticator app"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  lastTimeStep: bigint("last_time_step", { mode: "number" }), // replay protection
  createdAt: createdAt(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const accountRecoveryCodeVerifiers = pgTable("account_recovery_code_verifiers", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id").notNull(),
  position: smallint("position").notNull(),
  verifier: text("verifier").notNull(), // HMAC-SHA256(server pepper, code); codes are 80+ bits random
  usedAt: timestamp("used_at", { withTimezone: true }),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("recovery_verifier_uq").on(t.verifier)]);

export const emailVerifications = pgTable("email_verifications", {
  id: id(),
  email: text("email").notNull(),
  purpose: text("purpose").notNull(), // enroll | recovery
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const accountSecurityEvents = pgTable("account_security_events", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
}, (t) => [index("sec_events_user_idx").on(t.userId, t.createdAt)]);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});

/* ───────────────────────────── Audit / inbox ───────────────────────────── */

export const auditEvents = pgTable("audit_events", {
  id: id(),
  ownerId: owner(),
  category: text("category").notNull(), // charity | waxing | fasts | ...
  action: text("action").notNull(), // created | edited | completed | deleted | ...
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  summary: text("summary").notNull(),
  source: recordSource("source").notNull().default("manual"),
  sensitive: boolean("sensitive").notNull().default(false),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_owner_time_idx").on(t.ownerId, t.occurredAt)]);

export const captureDrafts = pgTable("capture_drafts", {
  id: id(),
  ownerId: owner(),
  sourceText: text("source_text").notNull(),
  targetModule: text("target_module").notNull(),
  action: text("action").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  missingFields: jsonb("missing_fields").$type<string[]>().notNull(),
  status: text("status").notNull().default("open"), // open | resolved | discarded
  resolvedEntityId: uuid("resolved_entity_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ───────────────────────────── AI proposals ───────────────────────────── */

export const aiProposals = pgTable("ai_proposals", {
  id: id(),
  ownerId: owner(),
  inputText: text("input_text").notNull(),
  inputMode: text("input_mode").notNull().default("text"), // text | voice
  history: jsonb("history").$type<{ role: "user" | "assistant"; text: string }[]>().notNull().default([]),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("pending"), // pending | confirmed | cancelled | expired | failed
  questions: jsonb("questions").$type<string[]>().notNull().default([]),
  provider: text("provider").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const aiProposalOperations = pgTable("ai_proposal_operations", {
  id: id(),
  proposalId: uuid("proposal_id").notNull().references(() => aiProposals.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  position: smallint("position").notNull(),
  module: text("module").notNull(),
  action: text("action").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  missingFields: jsonb("missing_fields").$type<string[]>().notNull().default([]),
  summary: text("summary").notNull(),
  status: text("status").notNull().default("proposed"), // proposed | applied | skipped | drafted | failed
  resultEntityId: uuid("result_entity_id"),
  error: text("error"),
}, (t) => [uniqueIndex("ai_op_uq").on(t.proposalId, t.version, t.position)]);

/* ───────────────────────────── Charity ───────────────────────────── */

export const charityPayments = pgTable("charity_payments", {
  id: id(),
  ownerId: owner(),
  paidOn: date("paid_on").notNull(),
  recipient: text("recipient").notNull(),
  cause: text("cause"),
  amountMinor: money("amount_minor").notNull(),
  currency: text("currency").notNull().default("SAR"),
  status: text("status").notNull().default("completed"), // planned | completed
  recurring: boolean("recurring").notNull().default(false),
  notes: text("notes"),
  source: recordSource("source").notNull().default("manual"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [index("charity_owner_date_idx").on(t.ownerId, t.paidOn)]);

/* ──────────────── Personal care: waxing / dental (maintenance) ──────────────── */

export const maintenanceActivities = pgTable("maintenance_activities", {
  id: id(),
  ownerId: owner(),
  kind: text("kind").notNull(), // waxing | dental
  name: text("name").notNull(),
  /** waxing: { unit:'day', windowDays:40, recommendedDay:30, reminderDays:[27,30,35,38,40] }
   *  dental: { unit:'month', intervalMonths:6, reminderOffsetsDays:[-14,-1,0] } */
  rule: jsonb("rule").$type<Record<string, unknown>>().notNull(),
  reminderTime: text("reminder_time").notNull().default("09:00"),
  remindersEnabled: boolean("reminders_enabled").notNull().default(true),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("maint_owner_kind_uq").on(t.ownerId, t.kind)]);

export const maintenanceCompletionEvents = pgTable("maintenance_completion_events", {
  id: id(),
  ownerId: owner(),
  activityId: uuid("activity_id").notNull().references(() => maintenanceActivities.id, { onDelete: "cascade" }),
  completedOn: date("completed_on").notNull(),
  detail: text("detail"), // body area / clinic
  notes: text("notes"),
  source: recordSource("source").notNull().default("manual"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidReason: text("void_reason"),
  createdAt: createdAt(),
}, (t) => [index("maint_events_idx").on(t.activityId, t.completedOn)]);

/* ───────────────────────────── Routines ───────────────────────────── */

export const routines = pgTable("routines", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("custom"), // toothbrush | brushes | bedsheets | custom
  /** completed = anchor is last completion; first_use = anchor is first-use date (toothbrush) */
  anchor: text("anchor").notNull().default("completed"),
  intervalValue: integer("interval_value").notNull(),
  intervalUnit: text("interval_unit").notNull(), // day | week | month
  /** days relative to the due date: negative = before, 0 = on the day, positive = after (overdue nudges) */
  reminderOffsetsDays: jsonb("reminder_offsets_days").$type<number[]>().notNull().default([0]),
  reminderTime: text("reminder_time").notNull().default("09:00"),
  remindersEnabled: boolean("reminders_enabled").notNull().default(true),
  /** optional window after the due date before it counts as overdue (e.g. waxing: due day 30, latest day 40) */
  graceDays: integer("grace_days"),
  /** private: lock-screen notifications say only "Personal reminder" (unless the owner allows details) */
  sensitive: boolean("sensitive").notNull().default(false),
  paused: boolean("paused").notNull().default(false),
  snoozedUntil: date("snoozed_until"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const routineEvents = pgTable("routine_events", {
  id: id(),
  ownerId: owner(),
  routineId: uuid("routine_id").notNull().references(() => routines.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // completed | skipped | purchased | first_use | paused | resumed | snoozed
  onDate: date("on_date").notNull(),
  notes: text("notes"),
  source: recordSource("source").notNull().default("manual"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("routine_events_idx").on(t.routineId, t.onDate)]);

/* ───────────────────────────── Make-up fasts ───────────────────────────── */

export const annualFastAdditionRules = pgTable("annual_fast_addition_rules", {
  id: id(),
  ownerId: owner(),
  amount: integer("amount").notNull(),
  calendar: text("calendar").notNull(), // hijri (Umm al-Qura) | gregorian
  month: smallint("month").notNull(),
  day: smallint("day").notNull(),
  startYear: integer("start_year").notNull(), // in the rule's calendar
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const fastLedgerEvents = pgTable("fast_ledger_events", {
  id: id(),
  ownerId: owner(),
  type: text("type").notNull(), // initial | annual_addition | adjustment | completed
  delta: integer("delta").notNull(), // signed effect on balance
  onDate: date("on_date").notNull(),
  reason: text("reason"),
  ruleId: uuid("rule_id").references(() => annualFastAdditionRules.id),
  periodKey: text("period_key"), // e.g. 'hijri:1448' for idempotent annual additions
  overrideNegative: boolean("override_negative").notNull().default(false),
  source: recordSource("source").notNull().default("manual"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("fast_rule_period_uq").on(t.ruleId, t.periodKey),
  index("fast_owner_date_idx").on(t.ownerId, t.onDate),
]);

/* ───────────────────────────── Savings ───────────────────────────── */

export const savingsGoals = pgTable("savings_goals", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull(),
  targetMinor: money("target_minor").notNull(),
  currency: text("currency").notNull().default("SAR"),
  targetDate: date("target_date"),
  openingBalanceMinor: money("opening_balance_minor").notNull().default(0),
  plannedMonthlyMinor: money("planned_monthly_minor"),
  reminderDayOfMonth: smallint("reminder_day_of_month"),
  remindersEnabled: boolean("reminders_enabled").notNull().default(false),
  status: text("status").notNull().default("active"), // active | achieved | archived
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const savingsTransactions = pgTable("savings_transactions", {
  id: id(),
  ownerId: owner(),
  goalId: uuid("goal_id").notNull().references(() => savingsGoals.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // deposit | withdrawal
  amountMinor: money("amount_minor").notNull(), // always positive
  onDate: date("on_date").notNull(),
  notes: text("notes"),
  source: recordSource("source").notNull().default("manual"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/* ───────────────────────────── Lent / borrowed ───────────────────────────── */

export const debts = pgTable("debts", {
  id: id(),
  ownerId: owner(),
  direction: text("direction").notNull(), // lent (they owe me) | borrowed (I owe)
  counterparty: text("counterparty").notNull(),
  originalMinor: money("original_minor").notNull(),
  currency: text("currency").notNull().default("SAR"),
  onDate: date("on_date").notNull(),
  dueDate: date("due_date"),
  status: text("status").notNull().default("open"), // open | settled
  reminderOffsetsDays: jsonb("reminder_offsets_days").$type<number[]>().notNull().default([-1, 0]),
  overdueRepeatDays: integer("overdue_repeat_days").default(3),
  reminderTime: text("reminder_time").notNull().default("09:00"),
  remindersEnabled: boolean("reminders_enabled").notNull().default(true),
  notes: text("notes"),
  source: recordSource("source").notNull().default("manual"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const debtRepayments = pgTable("debt_repayments", {
  id: id(),
  ownerId: owner(),
  debtId: uuid("debt_id").notNull().references(() => debts.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("repayment"), // repayment | adjustment
  amountMinor: money("amount_minor").notNull(), // repayment positive; adjustment signed
  onDate: date("on_date").notNull(),
  notes: text("notes"), // adjustment requires audit note
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/* ───────────────────────────── Projects & tasks ───────────────────────────── */

export const projects = pgTable("projects", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"), // active | done | archived
  targetDate: date("target_date"),
  priority: text("priority"),
  links: jsonb("links").$type<string[]>().notNull().default([]),
  source: recordSource("source").notNull().default("manual"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const tasks = pgTable("tasks", {
  id: id(),
  ownerId: owner(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  applicationId: uuid("application_id"), // follow-up task for a master's application
  title: text("title").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("backlog"), // backlog | in_progress | done
  dueOn: date("due_on"),
  dueTime: text("due_time"),
  priority: text("priority"),
  checklist: jsonb("checklist").$type<{ text: string; done: boolean }[]>().notNull().default([]),
  reminderOffsetsDays: jsonb("reminder_offsets_days").$type<number[]>().notNull().default([0]),
  reminderTime: text("reminder_time").notNull().default("09:00"),
  remindersEnabled: boolean("reminders_enabled").notNull().default(true),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  source: recordSource("source").notNull().default("manual"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/* ──────────────── Recurring events (Quran class, study, other classes) ──────────────── */

export const recurringEvents = pgTable("recurring_events", {
  id: id(),
  ownerId: owner(),
  kind: text("kind").notNull(), // class | study
  title: text("title").notNull(),
  weekday: smallint("weekday").notNull(), // ISO 1=Mon … 7=Sun
  localTime: text("local_time").notNull(), // 'HH:mm'
  timezone: text("timezone").notNull().default("Asia/Riyadh"),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  paused: boolean("paused").notNull().default(false),
  reminderLeadMinutes: integer("reminder_lead_minutes").notNull().default(60),
  remindersEnabled: boolean("reminders_enabled").notNull().default(true),
  linkedEventId: uuid("linked_event_id"), // study task → class it prepares for
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const eventOccurrences = pgTable("event_occurrences", {
  id: id(),
  ownerId: owner(),
  eventId: uuid("event_id").notNull().references(() => recurringEvents.id, { onDelete: "cascade" }),
  localDate: date("local_date").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("scheduled"), // scheduled | cancelled | attended | missed | done
  reminderLeadMinutes: integer("reminder_lead_minutes"), // per-occurrence override
  prepNotes: text("prep_notes"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("occurrence_uq").on(t.eventId, t.localDate), index("occ_owner_time_idx").on(t.ownerId, t.startsAt)]);

export const homeworkTasks = pgTable("homework_tasks", {
  id: id(),
  ownerId: owner(),
  occurrenceId: uuid("occurrence_id").notNull().references(() => eventOccurrences.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  reference: text("reference"), // surah/ayah
  dueAt: timestamp("due_at", { withTimezone: true }),
  priority: text("priority"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  source: recordSource("source").notNull().default("manual"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ───────────────────────────── Reminders & notifications ───────────────────────────── */

export const reminders = pgTable("reminders", {
  id: id(),
  ownerId: owner(),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  /** deterministic key → idempotent sync; e.g. waxing:<eventId>:d27 */
  dedupeKey: text("dedupe_key").notNull(),
  title: text("title").notNull(),
  /** lock-screen-safe text (no IDs, health details or secrets) */
  publicBody: text("public_body").notNull(),
  detailBody: text("detail_body"),
  sensitive: boolean("sensitive").notNull().default(false),
  fireAt: timestamp("fire_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("scheduled"), // scheduled | sent | dismissed | snoozed | completed | cancelled
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  link: text("link"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("reminder_dedupe_uq").on(t.ownerId, t.dedupeKey),
  index("reminder_due_idx").on(t.status, t.fireAt),
]);

export const notificationDeliveries = pgTable("notification_deliveries", {
  id: id(),
  reminderId: uuid("reminder_id").notNull().references(() => reminders.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(), // in_app | push | email
  subscriptionId: uuid("subscription_id"),
  /** dedupe: one delivery per reminder × channel × subscription × fire time */
  attemptKey: text("attempt_key").notNull(),
  status: text("status").notNull(), // delivered | failed | skipped
  error: text("error"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("delivery_attempt_uq").on(t.attemptKey)]);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  ownerId: owner(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  deviceLabel: text("device_label"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [uniqueIndex("push_endpoint_uq").on(t.endpoint)]);

export const notificationPreferences = pgTable("notification_preferences", {
  ownerId: uuid("owner_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  pushEnabled: boolean("push_enabled").notNull().default(false),
  emailFallback: boolean("email_fallback").notNull().default(false),
  quietStart: text("quiet_start"), // 'HH:mm' local
  quietEnd: text("quiet_end"),
  showSensitivePreviews: boolean("show_sensitive_previews").notNull().default(false),
  updatedAt: updatedAt(),
});

export const jobRuns = pgTable("job_runs", {
  id: id(),
  job: text("job").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  stats: jsonb("stats").$type<Record<string, unknown>>(),
  error: text("error"),
});

/* ───────────────────────────── Family members ("Belongs to") ───────────────────────────── */

export const people = pgTable("people", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull(),
  relation: text("relation").notNull().default("other"), // spouse | child | parent | sibling | other
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/* ───────────────────────────── Phase B: expiries & renewals ───────────────────────────── */

export const expiryItems = pgTable("expiry_items", {
  id: id(),
  ownerId: owner(),
  label: text("label").notNull(),
  personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }), // null = the owner
  kind: text("kind").notNull().default("custom"), // passport | national_id | license | bank_card | membership | custom
  expiresOn: date("expires_on").notNull(),
  issuer: text("issuer"),
  documentId: uuid("document_id"),
  status: text("status").notNull().default("active"), // active | archived
  reminderOffsetsDays: jsonb("reminder_offsets_days").$type<number[]>().notNull().default([-90, -30, -7]),
  reminderTime: text("reminder_time").notNull().default("09:00"),
  remindersEnabled: boolean("reminders_enabled").notNull().default(true),
  notes: text("notes"),
  source: recordSource("source").notNull().default("manual"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [index("expiry_owner_idx").on(t.ownerId, t.expiresOn)]);

export const renewalEvents = pgTable("renewal_events", {
  id: id(),
  ownerId: owner(),
  itemId: uuid("item_id").notNull().references(() => expiryItems.id, { onDelete: "cascade" }),
  renewedOn: date("renewed_on").notNull(),
  previousExpiresOn: date("previous_expires_on").notNull(),
  newExpiresOn: date("new_expires_on").notNull(),
  notes: text("notes"),
  createdAt: createdAt(),
});

/* ───────────────────────────── Phase B: document vault ───────────────────────────── */

export const documents = pgTable("documents", {
  id: id(),
  ownerId: owner(),
  title: text("title").notNull(),
  personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }), // null = the owner
  kind: text("kind").notNull().default("other"), // passport | national_id | transcript | certificate | cv | application | letter | other
  issuer: text("issuer"),
  issuedOn: date("issued_on"),
  expiresOn: date("expires_on"),
  idMasked: text("id_masked"), // e.g. ••••1234 — safe to display
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** Full ID numbers live apart from document metadata, encrypted, and are revealed only after step-up. */
export const protectedIdFields = pgTable("protected_id_fields", {
  documentId: uuid("document_id").primaryKey().references(() => documents.id, { onDelete: "cascade" }),
  ownerId: owner(),
  valueEnc: text("value_enc").notNull(),
  updatedAt: updatedAt(),
});

export const documentFiles = pgTable("document_files", {
  id: id(),
  ownerId: owner(),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  storageKey: text("storage_key").notNull(), // opaque random path; contents are AES-GCM encrypted before storage
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: createdAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [uniqueIndex("doc_file_version_uq").on(t.documentId, t.version)]);

/* ───────────────────────────── Phase B: Master's applications ───────────────────────────── */

export const APPLICATION_STATUSES = ["researching", "preparing", "submitted", "interview", "decision", "accepted", "rejected", "withdrawn"] as const;

export const mastersApplications = pgTable("masters_applications", {
  id: id(),
  ownerId: owner(),
  university: text("university").notNull(),
  program: text("program").notNull(),
  country: text("country"),
  intake: text("intake"), // e.g. "Fall 2027"
  url: text("url"),
  /** Deadline as the university states it: local date + time in the university's timezone. */
  deadlineDate: date("deadline_date"),
  deadlineTime: text("deadline_time"), // 'HH:mm', default 23:59 when unknown
  deadlineTz: text("deadline_tz"),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }), // canonical instant (computed)
  deadlineVerified: boolean("deadline_verified").notNull().default(false),
  status: text("status").notNull().default("researching"),
  submittedOn: date("submitted_on"),
  feeMinor: bigint("fee_minor", { mode: "number" }),
  feeCurrency: text("fee_currency"),
  funding: text("funding"),
  contacts: text("contacts"),
  notes: text("notes"),
  links: jsonb("links").$type<{ label: string; url: string }[]>().notNull().default([]),
  documentIds: jsonb("document_ids").$type<string[]>().notNull().default([]),
  reminderOffsetsDays: jsonb("reminder_offsets_days").$type<number[]>().notNull().default([-30, -14, -7, -1]),
  remindersEnabled: boolean("reminders_enabled").notNull().default(true),
  source: recordSource("source").notNull().default("manual"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [index("apps_owner_deadline_idx").on(t.ownerId, t.deadlineAt)]);

export const applicationRequirements = pgTable("application_requirements", {
  id: id(),
  ownerId: owner(),
  applicationId: uuid("application_id").notNull().references(() => mastersApplications.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  position: integer("position").notNull().default(0),
  doneAt: timestamp("done_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const applicationStatusEvents = pgTable("application_status_events", {
  id: id(),
  ownerId: owner(),
  applicationId: uuid("application_id").notNull().references(() => mastersApplications.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  onDate: date("on_date").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});

/* ───────────────────────────── Period log (sensitive) ───────────────────────────── */

/**
 * One row per period. Dates are plain local dates (needed for history and estimates);
 * notes and symptoms are AES-GCM encrypted at rest with an owner+row bound AAD.
 * Never sent to an AI provider, never shown in notifications, dashboard only if the owner opts in.
 */
export const periodCycles = pgTable("period_cycles", {
  id: id(),
  ownerId: owner(),
  startDate: date("start_date").notNull(),
  startTime: text("start_time"), // 'HH:mm' optional
  endDate: date("end_date"),
  endTime: text("end_time"),
  notesEnc: text("notes_enc"),
  symptomsEnc: text("symptoms_enc"),
  source: recordSource("source").notNull().default("manual"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [index("period_owner_start_idx").on(t.ownerId, t.startDate)]);

/* ───────────────────────────── Achievements bank & hobbies ───────────────────────────── */

export const ACHIEVEMENT_KINDS = ["accomplishment", "project", "award", "certification", "volunteering", "skill", "publication", "other"] as const;
export const ACHIEVEMENT_AREAS = ["work", "academic", "personal", "community"] as const;

export const achievements = pgTable("achievements", {
  id: id(),
  ownerId: owner(),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("accomplishment"),
  area: text("area").notNull().default("work"),
  organisation: text("organisation"),
  startDate: date("start_date"),
  endDate: date("end_date"), // or the single date for an award
  description: text("description"),
  /** Outcome metrics exactly as the owner states them; AI may never invent these. */
  outcome: text("outcome"),
  /** Optional portfolio/CV-ready line written or approved by the owner. */
  summary: text("summary"),
  skills: jsonb("skills").$type<string[]>().notNull().default([]),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  links: jsonb("links").$type<{ label: string; url: string }[]>().notNull().default([]),
  documentIds: jsonb("document_ids").$type<string[]>().notNull().default([]),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  applicationId: uuid("application_id").references(() => mastersApplications.id, { onDelete: "set null" }),
  featured: boolean("featured").notNull().default(false),
  source: recordSource("source").notNull().default("manual"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [index("achievements_owner_date_idx").on(t.ownerId, t.endDate)]);

export const hobbies = pgTable("hobbies", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull(),
  level: text("level"), // e.g. beginner / intermediate / advanced, free text
  since: date("since"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  links: jsonb("links").$type<{ label: string; url: string }[]>().notNull().default([]),
  source: recordSource("source").notNull().default("manual"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/* ───────────────────────────── Subscriptions ───────────────────────────── */

export const subscriptions = pgTable("subscriptions", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull(),
  category: text("category"),
  amountMinor: money("amount_minor").notNull(),
  currency: text("currency").notNull().default("SAR"),
  /** monthly | yearly | weekly | custom (custom uses intervalValue + intervalUnit) */
  cadence: text("cadence").notNull().default("monthly"),
  intervalValue: integer("interval_value").notNull().default(1),
  intervalUnit: text("interval_unit").notNull().default("month"),
  /** A known billing date; later charges are projected from it in whole intervals (no drift at month ends). */
  anchorDate: date("anchor_date").notNull(),
  /** Payment method LABEL only, e.g. "Visa ending 4821". Never a card number. */
  paymentLabel: text("payment_label"),
  renewal: text("renewal").notNull().default("auto"), // auto | manual
  trialEndsOn: date("trial_ends_on"),
  url: text("url"),
  notes: text("notes"),
  status: text("status").notNull().default("active"), // active | cancelled
  cancelledOn: date("cancelled_on"),
  reminderOffsetsDays: jsonb("reminder_offsets_days").$type<number[]>().notNull().default([-3]),
  trialOffsetsDays: jsonb("trial_offsets_days").$type<number[]>().notNull().default([-3, -1]),
  reminderTime: text("reminder_time").notNull().default("09:00"),
  remindersEnabled: boolean("reminders_enabled").notNull().default(true),
  source: recordSource("source").notNull().default("manual"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/* ───────────────────────────── Zakat ───────────────────────────── */

/** An immutable snapshot of an estimate. Never a payment. */
export const zakatCalculations = pgTable("zakat_calculations", {
  id: id(),
  ownerId: owner(),
  evaluationDate: date("evaluation_date").notNull(),
  currency: text("currency").notNull().default("SAR"),
  assets: jsonb("assets").$type<{ label: string; amount: string }[]>().notNull().default([]),
  liabilities: jsonb("liabilities").$type<{ label: string; amount: string }[]>().notNull().default([]),
  nisabBasis: text("nisab_basis").notNull(), // gold | silver | manual
  pricePerGram: text("price_per_gram"),
  nisabGrams: text("nisab_grams"),
  priceSource: text("price_source"), // where/when the owner got the price
  assetsMinor: money("assets_minor").notNull(),
  liabilitiesMinor: money("liabilities_minor").notNull(),
  netMinor: money("net_minor").notNull(),
  nisabMinor: money("nisab_minor").notNull(),
  aboveNisab: boolean("above_nisab").notNull(),
  rateBp: integer("rate_bp").notNull(),
  zakatMinor: money("zakat_minor").notNull(),
  steps: jsonb("steps").$type<string[]>().notNull().default([]),
  remindNextYear: boolean("remind_next_year").notNull().default(false),
  notes: text("notes"),
  createdAt: createdAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const zakatPayments = pgTable("zakat_payments", {
  id: id(),
  ownerId: owner(),
  paidOn: date("paid_on").notNull(),
  amountMinor: money("amount_minor").notNull(),
  currency: text("currency").notNull().default("SAR"),
  recipient: text("recipient").notNull(),
  calculationId: uuid("calculation_id").references(() => zakatCalculations.id, { onDelete: "set null" }),
  notes: text("notes"),
  source: recordSource("source").notNull().default("manual"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/* ───────────────────────────── Backups ───────────────────────────── */

export const backups = pgTable("backups", {
  id: id(),
  ownerId: owner(),
  kind: text("kind").notNull(), // automatic | manual | pre-restore
  storageKey: text("storage_key").notNull(),
  sha256: text("sha256").notNull(), // of the sealed file (storage integrity)
  payloadSha256: text("payload_sha256").notNull(), // of the records inside
  sizeBytes: integer("size_bytes").notNull(),
  counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("backups_owner_created_idx").on(t.ownerId, t.createdAt)]);
