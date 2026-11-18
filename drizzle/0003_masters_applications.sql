CREATE TABLE "application_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"on_date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "masters_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"university" text NOT NULL,
	"program" text NOT NULL,
	"country" text,
	"intake" text,
	"url" text,
	"deadline_date" date,
	"deadline_time" text,
	"deadline_tz" text,
	"deadline_at" timestamp with time zone,
	"deadline_verified" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'researching' NOT NULL,
	"submitted_on" date,
	"fee_minor" bigint,
	"fee_currency" text,
	"funding" text,
	"contacts" text,
	"notes" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reminder_offsets_days" jsonb DEFAULT '[-30,-14,-7,-1]'::jsonb NOT NULL,
	"reminders_enabled" boolean DEFAULT true NOT NULL,
	"source" "record_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "application_requirements" ADD CONSTRAINT "application_requirements_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_requirements" ADD CONSTRAINT "application_requirements_application_id_masters_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."masters_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_status_events" ADD CONSTRAINT "application_status_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_status_events" ADD CONSTRAINT "application_status_events_application_id_masters_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."masters_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "masters_applications" ADD CONSTRAINT "masters_applications_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apps_owner_deadline_idx" ON "masters_applications" USING btree ("owner_id","deadline_at");