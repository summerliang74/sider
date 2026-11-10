CREATE TABLE "upload_scan_jobs" (
	"resource_id" uuid PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"snapshot_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"source_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upload_scan_jobs" ADD CONSTRAINT "upload_scan_jobs_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upload_scan_jobs_due_idx" ON "upload_scan_jobs" USING btree ("status","available_at");