ALTER TABLE "person" ADD COLUMN "project_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "project_url" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "project_source" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "project_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_project_status" CHECK ("person"."project_status" IN ('unknown', 'submitted', 'none'));--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_project_source" CHECK ("person"."project_source" IS NULL OR "person"."project_source" IN ('csv', 'organizer'));