CREATE TABLE "fare_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"event_id" text NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"kind" text NOT NULL,
	"captured_on" date NOT NULL,
	"source" text NOT NULL,
	"truth" text NOT NULL,
	"typical_low_minor" bigint,
	"typical_high_minor" bigint,
	"lowest_minor" bigint,
	"price_level" text,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fare_snapshot" ADD CONSTRAINT "fare_snapshot_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fare_snapshot" ADD CONSTRAINT "fare_snapshot_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fare_snapshot_day_uq" ON "fare_snapshot" USING btree ("event_id","origin","kind","captured_on");--> statement-breakpoint
CREATE INDEX "fare_snapshot_org_idx" ON "fare_snapshot" USING btree ("org_id");