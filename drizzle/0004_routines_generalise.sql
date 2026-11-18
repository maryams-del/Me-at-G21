ALTER TABLE "routines" ADD COLUMN "grace_days" integer;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "sensitive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Move waxing & dental (maintenance activities) into generic routines, keeping the same IDs.
INSERT INTO "routines" ("id", "owner_id", "name", "kind", "anchor", "interval_value", "interval_unit", "reminder_offsets_days", "reminder_time", "reminders_enabled", "grace_days", "sensitive", "created_at", "updated_at")
SELECT m."id", m."owner_id", m."name", m."kind", 'completed',
  CASE WHEN m."kind" = 'waxing' THEN COALESCE((m."rule"->>'recommendedDay')::int, 30) ELSE COALESCE((m."rule"->>'intervalMonths')::int, 6) END,
  CASE WHEN m."kind" = 'waxing' THEN 'day' ELSE 'month' END,
  CASE WHEN m."kind" = 'waxing'
    THEN COALESCE((SELECT jsonb_agg(d::int - COALESCE((m."rule"->>'recommendedDay')::int, 30) ORDER BY d::int) FROM jsonb_array_elements_text(m."rule"->'reminderDays') AS d), '[-3,0,5,8,10]'::jsonb)
    ELSE COALESCE(m."rule"->'reminderOffsetsDays', '[-14,-1,0]'::jsonb) END,
  m."reminder_time", m."reminders_enabled",
  CASE WHEN m."kind" = 'waxing' THEN COALESCE((m."rule"->>'windowDays')::int, 40) - COALESCE((m."rule"->>'recommendedDay')::int, 30) ELSE NULL END,
  m."kind" = 'waxing', m."created_at", now()
FROM "maintenance_activities" m
WHERE NOT EXISTS (SELECT 1 FROM "routines" r WHERE r."id" = m."id");
--> statement-breakpoint
INSERT INTO "routine_events" ("owner_id", "routine_id", "type", "on_date", "notes", "source", "voided_at", "created_at")
SELECT e."owner_id", e."activity_id", 'completed', e."completed_on", NULLIF(concat_ws('. ', e."detail", e."notes"), ''), e."source", e."voided_at", e."created_at"
FROM "maintenance_completion_events" e
WHERE NOT EXISTS (SELECT 1 FROM "routine_events" x WHERE x."routine_id" = e."activity_id" AND x."on_date" = e."completed_on" AND x."type" = 'completed');
--> statement-breakpoint
-- Old waxing/dental reminders are replaced by routine reminders (rebuilt by the next sync).
UPDATE "reminders" SET "status" = 'cancelled', "updated_at" = now() WHERE "source_type" IN ('waxing', 'dental') AND "status" IN ('scheduled', 'snoozed');
