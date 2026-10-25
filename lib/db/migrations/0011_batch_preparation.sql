ALTER TABLE "disbursement_batch" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "disbursement_batch" ADD COLUMN "requested_payouts" jsonb DEFAULT '[]'::jsonb NOT NULL;