CREATE TABLE "document_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"issuer" text,
	"issued_on" date,
	"expires_on" date,
	"id_masked" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "expiry_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'custom' NOT NULL,
	"expires_on" date NOT NULL,
	"issuer" text,
	"document_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"reminder_offsets_days" jsonb DEFAULT '[-90,-30,-7]'::jsonb NOT NULL,
	"reminder_time" text DEFAULT '09:00' NOT NULL,
	"reminders_enabled" boolean DEFAULT true NOT NULL,
	"notes" text,
	"source" "record_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "protected_id_fields" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"value_enc" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renewal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"renewed_on" date NOT NULL,
	"previous_expires_on" date NOT NULL,
	"new_expires_on" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_items" ADD CONSTRAINT "expiry_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protected_id_fields" ADD CONSTRAINT "protected_id_fields_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protected_id_fields" ADD CONSTRAINT "protected_id_fields_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_events" ADD CONSTRAINT "renewal_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_events" ADD CONSTRAINT "renewal_events_item_id_expiry_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."expiry_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_file_version_uq" ON "document_files" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "expiry_owner_idx" ON "expiry_items" USING btree ("owner_id","expires_on");