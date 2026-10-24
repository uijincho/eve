CREATE TABLE "portal_run" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"packet_id" text NOT NULL,
	"workflow_run_id" text,
	"status" text DEFAULT 'starting' NOT NULL,
	"requested_by" text NOT NULL,
	"sandbox_id" text,
	"stream_url" text,
	"page" text DEFAULT 'other' NOT NULL,
	"pages_visited" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"state" jsonb,
	"review_check" jsonb,
	"escalation" jsonb,
	"confirmation" text,
	"portal_record" jsonb,
	"approved_by" text,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"stop_requested" boolean DEFAULT false NOT NULL,
	"error" text,
	"usage" jsonb DEFAULT '{"inputTokens":0,"outputTokens":0,"cacheReadTokens":0}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portal_run" ADD CONSTRAINT "portal_run_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_run" ADD CONSTRAINT "portal_run_packet_id_sponsor_packet_id_fk" FOREIGN KEY ("packet_id") REFERENCES "public"."sponsor_packet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_run_org_idx" ON "portal_run" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_run_active_uq" ON "portal_run" USING btree ("packet_id") WHERE "portal_run"."status" in ('starting', 'filling', 'awaiting_approval', 'submitting');