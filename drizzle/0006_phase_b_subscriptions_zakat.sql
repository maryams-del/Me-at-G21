CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"cadence" text DEFAULT 'monthly' NOT NULL,
	"interval_value" integer DEFAULT 1 NOT NULL,
	"interval_unit" text DEFAULT 'month' NOT NULL,
	"anchor_date" date NOT NULL,
	"payment_label" text,
	"renewal" text DEFAULT 'auto' NOT NULL,
	"trial_ends_on" date,
	"url" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"cancelled_on" date,
	"reminder_offsets_days" jsonb DEFAULT '[-3]'::jsonb NOT NULL,
	"trial_offsets_days" jsonb DEFAULT '[-3,-1]'::jsonb NOT NULL,
	"reminder_time" text DEFAULT '09:00' NOT NULL,
	"reminders_enabled" boolean DEFAULT true NOT NULL,
	"source" "record_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "zakat_calculations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"evaluation_date" date NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"assets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"liabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nisab_basis" text NOT NULL,
	"price_per_gram" text,
	"nisab_grams" text,
	"price_source" text,
	"assets_minor" bigint NOT NULL,
	"liabilities_minor" bigint NOT NULL,
	"net_minor" bigint NOT NULL,
	"nisab_minor" bigint NOT NULL,
	"above_nisab" boolean NOT NULL,
	"rate_bp" integer NOT NULL,
	"zakat_minor" bigint NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remind_next_year" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "zakat_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"recipient" text NOT NULL,
	"calculation_id" uuid,
	"notes" text,
	"source" "record_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zakat_calculations" ADD CONSTRAINT "zakat_calculations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zakat_payments" ADD CONSTRAINT "zakat_payments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zakat_payments" ADD CONSTRAINT "zakat_payments_calculation_id_zakat_calculations_id_fk" FOREIGN KEY ("calculation_id") REFERENCES "public"."zakat_calculations"("id") ON DELETE set null ON UPDATE no action;