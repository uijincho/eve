CREATE TABLE "disbursement_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"status" text DEFAULT 'preparing' NOT NULL,
	"approved_by" text NOT NULL,
	"approved_by_name" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"fees_paid_by" text NOT NULL,
	"document_id" text NOT NULL,
	"workflow_run_id" text,
	"sandbox_id" text,
	"stream_url" text,
	"state" jsonb,
	"turns" integer DEFAULT 0 NOT NULL,
	"confirmation" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disbursement_batch_item" (
	"payout_id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disbursement_batch" ADD CONSTRAINT "disbursement_batch_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursement_batch" ADD CONSTRAINT "disbursement_batch_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursement_batch_item" ADD CONSTRAINT "disbursement_batch_item_payout_id_payout_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payout"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursement_batch_item" ADD CONSTRAINT "disbursement_batch_item_batch_id_disbursement_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."disbursement_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disbursement_batch_org_idx" ON "disbursement_batch" USING btree ("org_id","created_at");