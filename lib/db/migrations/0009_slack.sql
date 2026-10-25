CREATE TABLE "slack_alert" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"key" text NOT NULL,
	"category" text NOT NULL,
	"text" text NOT NULL,
	"document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone,
	"message_ts" text
);
--> statement-breakpoint
CREATE TABLE "slack_installation" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"bot_user_id" text NOT NULL,
	"token_ciphertext" "bytea" NOT NULL,
	"token_iv" "bytea" NOT NULL,
	"token_tag" "bytea" NOT NULL,
	"channel_id" text,
	"channel_name" text,
	"on_duty_member_id" text,
	"backup_member_id" text,
	"installed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_installation_org_id_unique" UNIQUE("org_id"),
	CONSTRAINT "slack_installation_team_id_unique" UNIQUE("team_id")
);
--> statement-breakpoint
CREATE TABLE "slack_message" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"item_key" text NOT NULL,
	"audience" text NOT NULL,
	"category" text NOT NULL,
	"channel_id" text,
	"ts" text,
	"state" text DEFAULT 'open' NOT NULL,
	"fingerprint" text DEFAULT '' NOT NULL,
	"last_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_user_link" (
	"member_id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"team_id" text,
	"slack_user_id" text,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"muted" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slack_alert" ADD CONSTRAINT "slack_alert_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD CONSTRAINT "slack_installation_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD CONSTRAINT "slack_installation_on_duty_member_id_org_member_id_fk" FOREIGN KEY ("on_duty_member_id") REFERENCES "public"."org_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD CONSTRAINT "slack_installation_backup_member_id_org_member_id_fk" FOREIGN KEY ("backup_member_id") REFERENCES "public"."org_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_message" ADD CONSTRAINT "slack_message_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_link" ADD CONSTRAINT "slack_user_link_member_id_org_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."org_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_link" ADD CONSTRAINT "slack_user_link_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_alert_key_uq" ON "slack_alert" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "slack_alert_pending_idx" ON "slack_alert" USING btree ("org_id","posted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_message_item_uq" ON "slack_message" USING btree ("org_id","item_key","audience");--> statement-breakpoint
CREATE INDEX "slack_message_org_state_idx" ON "slack_message" USING btree ("org_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_user_link_user_uq" ON "slack_user_link" USING btree ("team_id","slack_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_user_link_code_uq" ON "slack_user_link" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "slack_user_link_org_idx" ON "slack_user_link" USING btree ("org_id");