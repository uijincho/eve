CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'expense', 'income', 'equity');--> statement-breakpoint
CREATE TYPE "public"."award_kind" AS ENUM('cash', 'item');--> statement-breakpoint
CREATE TYPE "public"."award_status" AS ENUM('draft', 'needs_form', 'ready', 'proposed', 'paid');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('submitted', 'processing', 'approved', 'escalated', 'rejected', 'needs_info', 'paid');--> statement-breakpoint
CREATE TYPE "public"."claim_type" AS ENUM('travel', 'expense');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('running', 'waiting', 'done', 'escalated', 'frozen');--> statement-breakpoint
CREATE TYPE "public"."filing_status" AS ENUM('draft', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."fulfillment" AS ENUM('undecided', 'ship', 'local', 'cash');--> statement-breakpoint
CREATE TYPE "public"."payout_method_status" AS ENUM('active', 'pending_verification', 'superseded', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."notice_status" AS ENUM('queued', 'sent', 'simulated');--> statement-breakpoint
CREATE TYPE "public"."org_mode" AS ENUM('direct', 'sponsor', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."packet_status" AS ENUM('draft', 'submitted', 'questioned', 'paid', 'exception');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('held', 'proposed', 'approved', 'processing', 'paid', 'failed', 'returned', 'frozen');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('attendee', 'organizer', 'controller', 'auditor', 'agent');--> statement-breakpoint
CREATE TYPE "public"."payout_source" AS ENUM('claim', 'award');--> statement-breakpoint
CREATE TYPE "public"."tax_form" AS ENUM('W-9', 'W-8BEN', 'W-8BEN-E', 'Residency declaration');--> statement-breakpoint
CREATE TYPE "public"."tax_status" AS ENUM('missing', 'valid', 'expired', 'review');--> statement-breakpoint
CREATE TABLE "accounting_period" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	CONSTRAINT "accounting_period_range" CHECK ("accounting_period"."ends_on" >= "accounting_period"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "action_idempotency" (
	"org_id" text NOT NULL,
	"action" text NOT NULL,
	"key" text NOT NULL,
	"actor_id" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_idempotency_org_id_action_key_pk" PRIMARY KEY("org_id","action","key")
);
--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"triggered_by" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "answer_key" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"scenario" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"expected" text NOT NULL,
	"expected_code" text,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"approver_id" text NOT NULL,
	"approver_role" "member_role" NOT NULL,
	"decision" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"bank_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_segregation" CHECK ("approval"."approver_id" <> "approval"."requested_by"),
	CONSTRAINT "approval_not_agent" CHECK ("approval"."approver_role" <> 'agent' OR "approval"."object_type" = 'claim')
);
--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "award" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"event_id" text NOT NULL,
	"person_id" text NOT NULL,
	"track" text NOT NULL,
	"title" text NOT NULL,
	"kind" "award_kind" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"fulfillment" "fulfillment" DEFAULT 'undecided' NOT NULL,
	"status" "award_status" DEFAULT 'draft' NOT NULL,
	"recommendation" text DEFAULT '' NOT NULL,
	"shipping_minor" bigint DEFAULT 0 NOT NULL,
	"local_minor" bigint DEFAULT 0 NOT NULL,
	"team_id" text,
	"split_bps" integer DEFAULT 10000 NOT NULL,
	"split_confirmed" boolean DEFAULT true NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "award_split_range" CHECK ("award"."split_bps" > 0 AND "award"."split_bps" <= 10000),
	CONSTRAINT "award_amount_positive" CHECK ("award"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "budget_line" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"event_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"cap_minor" bigint NOT NULL,
	"funding_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"event_id" text NOT NULL,
	"person_id" text NOT NULL,
	"budget_line_id" text,
	"type" "claim_type" NOT NULL,
	"merchant" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"usd_minor" bigint NOT NULL,
	"fx_rate" numeric(18, 8) NOT NULL,
	"fx_source" text NOT NULL,
	"purchased_at" timestamp with time zone NOT NULL,
	"travel_date" timestamp with time zone,
	"cabin" text,
	"origin" text,
	"name_on_receipt" text,
	"receipt_name" text,
	"document_id" text,
	"receipt_hash" text,
	"extracted" jsonb,
	"status" "claim_status" DEFAULT 'submitted' NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"requested_by" text NOT NULL,
	"reviewed_by" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_amount_positive" CHECK ("claim"."amount_minor" > 0 AND "claim"."usd_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "decision_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"run_id" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"person_id" text,
	"person_name" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"actor" text NOT NULL,
	"actor_role" "member_role" NOT NULL,
	"status" "decision_status" NOT NULL,
	"tool" text NOT NULL,
	"rule_id" text,
	"rule_version" integer,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checks" jsonb,
	"document_id" text,
	"next_action_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"person_id" text,
	"uploaded_by" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_size_limit" CHECK ("document"."size_bytes" > 0 AND "document"."size_bytes" <= 10485760)
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"venue" text NOT NULL,
	"expected_headcount" integer DEFAULT 0 NOT NULL,
	"travel_cap_minor" bigint NOT NULL,
	"economy_only" boolean DEFAULT true NOT NULL,
	"booking_deadline" timestamp with time zone NOT NULL,
	"check_in_at" timestamp with time zone NOT NULL,
	"closing_at" timestamp with time zone NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "filing" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"person_id" text NOT NULL,
	"year" integer NOT NULL,
	"form" text NOT NULL,
	"gross_minor" bigint NOT NULL,
	"withholding_minor" bigint NOT NULL,
	"status" "filing_status" DEFAULT 'draft' NOT NULL,
	"document_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rate" (
	"rate_date" date NOT NULL,
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "fx_rate_rate_date_base_quote_pk" PRIMARY KEY("rate_date","base","quote")
);
--> statement-breakpoint
CREATE TABLE "journal_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entry_date" date NOT NULL,
	"memo" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"reverses_entry_id" text,
	"idempotency_key" text NOT NULL,
	"created_by" text NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_txid" bigint DEFAULT txid_current() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_line" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"account_id" text NOT NULL,
	"debit_minor" bigint DEFAULT 0 NOT NULL,
	"credit_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"person_id" text,
	"memo" text DEFAULT '' NOT NULL,
	CONSTRAINT "journal_line_one_side" CHECK (("journal_line"."debit_minor" > 0 AND "journal_line"."credit_minor" = 0) OR ("journal_line"."credit_minor" > 0 AND "journal_line"."debit_minor" = 0))
);
--> statement-breakpoint
CREATE TABLE "ledger_account" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notice" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"person_id" text,
	"channel" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"private_vault_id" text,
	"status" "notice_status" DEFAULT 'simulated' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_member" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"person_id" text,
	"role" "member_role" NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"demo_persona" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_member_attendee_person" CHECK ("org_member"."role" <> 'attendee' OR "org_member"."person_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"mode" "org_mode" DEFAULT 'hybrid' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"agent_limit_minor" bigint DEFAULT 30000 NOT NULL,
	"organizer_limit_minor" bigint DEFAULT 200000 NOT NULL,
	"controller_threshold_minor" bigint DEFAULT 200000 NOT NULL,
	"sponsor_name" text DEFAULT '' NOT NULL,
	"sponsor_turnaround_days" integer DEFAULT 10 NOT NULL,
	"fees_paid_by" text DEFAULT 'org' NOT NULL,
	"notification_channel" text,
	"policy_notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "payout" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"person_id" text NOT NULL,
	"source_type" "payout_source" NOT NULL,
	"claim_id" text,
	"award_id" text,
	"gross_minor" bigint NOT NULL,
	"withholding_minor" bigint NOT NULL,
	"fee_minor" bigint NOT NULL,
	"net_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"destination_currency" text NOT NULL,
	"destination_net_minor" bigint NOT NULL,
	"fx_rate" numeric(18, 8) NOT NULL,
	"provider" text NOT NULL,
	"truth" text NOT NULL,
	"status" "payout_status" NOT NULL,
	"frozen_from" "payout_status",
	"reason" text DEFAULT '' NOT NULL,
	"rule_id" text NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_verified" boolean NOT NULL,
	"reporting_form" text,
	"requested_by" text NOT NULL,
	"released_by" text,
	"payout_method_id" text,
	"bank_version" integer,
	"idempotency_key" text NOT NULL,
	"provider_ref" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_source_fk" CHECK (("payout"."source_type" = 'claim' AND "payout"."claim_id" IS NOT NULL AND "payout"."award_id" IS NULL) OR ("payout"."source_type" = 'award' AND "payout"."award_id" IS NOT NULL AND "payout"."claim_id" IS NULL)),
	CONSTRAINT "payout_amounts" CHECK ("payout"."gross_minor" >= 0 AND "payout"."withholding_minor" >= 0 AND "payout"."fee_minor" >= 0 AND "payout"."net_minor" >= 0),
	CONSTRAINT "payout_no_self_release" CHECK ("payout"."released_by" IS NULL OR "payout"."released_by" <> "payout"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "payout_method" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"person_id" text NOT NULL,
	"provider" text DEFAULT 'simulated' NOT NULL,
	"currency" text NOT NULL,
	"last4" text NOT NULL,
	"vault_id" text,
	"status" "payout_method_status" NOT NULL,
	"version" integer NOT NULL,
	"requested_via" text DEFAULT 'portal' NOT NULL,
	"requested_by" text NOT NULL,
	"verification_vault_id" text,
	"verification_sent_to" text,
	"verification_expires_at" timestamp with time zone,
	"verification_attempts" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"event_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"country" text NOT NULL,
	"citizenship" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'hacker' NOT NULL,
	"adult" boolean NOT NULL,
	"payout_currency" text DEFAULT 'USD' NOT NULL,
	"chase_count" integer DEFAULT 0 NOT NULL,
	"last_chased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoreboard_run" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total" integer NOT NULL,
	"caught" integer NOT NULL,
	"missed" integer NOT NULL,
	"false_positives" integer NOT NULL,
	"wrongful_payouts" integer NOT NULL,
	"results" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sponsor_packet" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"payout_id" text NOT NULL,
	"requested_minor" bigint NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"status" "packet_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"due_at" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"document_id" text,
	"remittance_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"person_id" text NOT NULL,
	"form" "tax_form" NOT NULL,
	"status" "tax_status" NOT NULL,
	"status_reason" text DEFAULT '' NOT NULL,
	"signature_name" text,
	"signed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"tin_vault_id" text,
	"tin_last4" text,
	"treaty_country" text,
	"treaty_article" text,
	"document_id" text,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rule" (
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"payer_country" text NOT NULL,
	"payee_country" text NOT NULL,
	"payment_type" text NOT NULL,
	"rate_bps" integer NOT NULL,
	"threshold_minor" bigint NOT NULL,
	"form" text NOT NULL,
	"reporting_form" text NOT NULL,
	"verified" boolean NOT NULL,
	"source_url" text NOT NULL,
	"explanation" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rule_id_version_pk" PRIMARY KEY("id","version")
);
--> statement-breakpoint
CREATE TABLE "vault_secret" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"person_id" text,
	"kind" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"last4" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounting_period" ADD CONSTRAINT "accounting_period_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_idempotency" ADD CONSTRAINT "action_idempotency_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_key" ADD CONSTRAINT "answer_key_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award" ADD CONSTRAINT "award_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award" ADD CONSTRAINT "award_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award" ADD CONSTRAINT "award_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line" ADD CONSTRAINT "budget_line_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line" ADD CONSTRAINT "budget_line_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_budget_line_id_budget_line_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_line"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filing" ADD CONSTRAINT "filing_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filing" ADD CONSTRAINT "filing_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filing" ADD CONSTRAINT "filing_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_reverses_entry_id_journal_entry_id_fk" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_entry_id_journal_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_account_id_ledger_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice" ADD CONSTRAINT "notice_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice" ADD CONSTRAINT "notice_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice" ADD CONSTRAINT "notice_private_vault_id_vault_secret_id_fk" FOREIGN KEY ("private_vault_id") REFERENCES "public"."vault_secret"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_member" ADD CONSTRAINT "org_member_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_member" ADD CONSTRAINT "org_member_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_member" ADD CONSTRAINT "org_member_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_award_id_award_id_fk" FOREIGN KEY ("award_id") REFERENCES "public"."award"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_payout_method_id_payout_method_id_fk" FOREIGN KEY ("payout_method_id") REFERENCES "public"."payout_method"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_method" ADD CONSTRAINT "payout_method_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_method" ADD CONSTRAINT "payout_method_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_method" ADD CONSTRAINT "payout_method_vault_id_vault_secret_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault_secret"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_method" ADD CONSTRAINT "payout_method_verification_vault_id_vault_secret_id_fk" FOREIGN KEY ("verification_vault_id") REFERENCES "public"."vault_secret"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoreboard_run" ADD CONSTRAINT "scoreboard_run_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_packet" ADD CONSTRAINT "sponsor_packet_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_packet" ADD CONSTRAINT "sponsor_packet_payout_id_payout_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payout"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_packet" ADD CONSTRAINT "sponsor_packet_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_profile" ADD CONSTRAINT "tax_profile_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_profile" ADD CONSTRAINT "tax_profile_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_profile" ADD CONSTRAINT "tax_profile_tin_vault_id_vault_secret_id_fk" FOREIGN KEY ("tin_vault_id") REFERENCES "public"."vault_secret"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_profile" ADD CONSTRAINT "tax_profile_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_secret" ADD CONSTRAINT "vault_secret_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_secret" ADD CONSTRAINT "vault_secret_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_period_start_uq" ON "accounting_period" USING btree ("org_id","starts_on");--> statement-breakpoint
CREATE INDEX "award_org_idx" ON "award" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_line_event_category_uq" ON "budget_line" USING btree ("event_id","category");--> statement-breakpoint
CREATE INDEX "claim_org_idx" ON "claim" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "claim_person_idx" ON "claim" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_idempotency_uq" ON "claim" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "decision_org_created_idx" ON "decision_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "document_org_hash_idx" ON "document" USING btree ("org_id","sha256");--> statement-breakpoint
CREATE INDEX "event_org_idx" ON "event" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "filing_person_year_form_uq" ON "filing" USING btree ("org_id","person_id","year","form");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entry_idempotency_uq" ON "journal_entry" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entry_reversal_uq" ON "journal_entry" USING btree ("reverses_entry_id");--> statement-breakpoint
CREATE INDEX "journal_entry_source_idx" ON "journal_entry" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "journal_line_entry_idx" ON "journal_line" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_account_code_uq" ON "ledger_account" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "org_member_user_uq" ON "org_member" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_member_email_uq" ON "org_member" USING btree ("org_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_idempotency_uq" ON "payout" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_live_claim_uq" ON "payout" USING btree ("claim_id") WHERE "payout"."status" NOT IN ('failed', 'returned') AND "payout"."claim_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payout_live_award_uq" ON "payout" USING btree ("award_id") WHERE "payout"."status" NOT IN ('failed', 'returned') AND "payout"."award_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payout_org_idx" ON "payout" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_method_version_uq" ON "payout_method" USING btree ("person_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_method_active_uq" ON "payout_method" USING btree ("person_id") WHERE "payout_method"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "payout_method_pending_uq" ON "payout_method" USING btree ("person_id") WHERE "payout_method"."status" = 'pending_verification';--> statement-breakpoint
CREATE UNIQUE INDEX "person_org_email_uq" ON "person" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "person_org_idx" ON "person" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_packet_payout_uq" ON "sponsor_packet" USING btree ("payout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_profile_current_uq" ON "tax_profile" USING btree ("person_id") WHERE "tax_profile"."superseded_at" IS NULL;