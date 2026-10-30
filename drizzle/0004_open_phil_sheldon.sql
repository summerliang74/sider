CREATE TABLE "registration_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"consumed_by" uuid,
	"note" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registration_invites" ADD CONSTRAINT "registration_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_invites" ADD CONSTRAINT "registration_invites_consumed_by_users_id_fk" FOREIGN KEY ("consumed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "registration_invites_token_hash_unique" ON "registration_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "registration_invites_status_expiry_idx" ON "registration_invites" USING btree ("revoked_at","consumed_at","expires_at");--> statement-breakpoint
CREATE INDEX "registration_invites_created_at_idx" ON "registration_invites" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);