CREATE TABLE "tax_rule_override" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source_type" "payout_source" NOT NULL,
	"source_id" text NOT NULL,
	"person_id" text NOT NULL,
	"tax_profile_id" text NOT NULL,
	"payment_type" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"rule_id" text NOT NULL,
	"rule_version" integer NOT NULL,
	"decision" text NOT NULL,
	"applied_rule_id" text NOT NULL,
	"applied_rule_version" integer NOT NULL,
	"reason" text NOT NULL,
	"approved_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "tax_rule_override_reason" CHECK (length(trim("tax_rule_override"."reason")) >= 10)
);
--> statement-breakpoint
ALTER TABLE "tax_rule_override" ADD CONSTRAINT "tax_rule_override_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_override" ADD CONSTRAINT "tax_rule_override_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_override" ADD CONSTRAINT "tax_rule_override_tax_profile_id_tax_profile_id_fk" FOREIGN KEY ("tax_profile_id") REFERENCES "public"."tax_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rule_override_live_uq" ON "tax_rule_override" USING btree ("source_type","source_id") WHERE "tax_rule_override"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "tax_rule_override_org_idx" ON "tax_rule_override" USING btree ("org_id");--> statement-breakpoint
-- Canadian-payer rules (all unverified), so CA reimbursements, stipends and item prizes name a real rule instead of "none".
INSERT INTO "tax_rule" ("id", "version", "payer_country", "payee_country", "payment_type", "rate_bps", "threshold_minor", "form", "reporting_form", "verified", "source_url", "explanation", "effective_from", "effective_to") VALUES
('ca-any-reimbursement', 1, 'CA', '*', 'reimbursement', 0, 0, 'Residency declaration', 'None (advisor review)', false, 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/completing-filing-information-returns/t4a-information-payers/t4a-slip.html', 'Unverified default, mirroring any-reimbursement: a Canadian payer repays substantiated travel costs without withholding or a slip. Whether a T4A applies to reimbursements paid to non-employees needs a Canadian advisor. Not held for this alone.', '2026-01-01', NULL),
('ca-ca-stipend', 1, 'CA', 'CA', 'stipend', 0, 50000, 'SIN (token)', 'T4A (box to verify)', false, 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/completing-filing-information-returns/t4a-information-payers/t4a-slip.html', 'Unresolved. Fees for services paid to a Canadian resident may be reported on a T4A when the year''s total is more than $500 or tax was deducted (CRA T4A slip page); the box and whether the judge or mentor is self-employed need review. Hold for review.', '2026-01-01', NULL),
('ca-nonca-stipend', 1, 'CA', 'NONCA', 'stipend', 0, 0, 'Residency declaration', 'NR4 (to verify)', false, 'https://www.canada.ca/en/revenue-agency/services/tax/international-non-residents/payments-non-residents.html', 'Unresolved. Services rendered in Canada by a non-resident can fall under Regulation 105 withholding; CRA''s non-resident payments page lists it, but no rate is assumed here. Hold for review.', '2026-01-01', NULL),
('ca-ca-item-prize', 1, 'CA', 'CA', 'item_prize', 0, 50000, 'SIN (token)', 'T4A (box to verify)', false, 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/completing-filing-information-returns/t4a-information-payers/t4a-slip.html', 'Unresolved, same as ca-ca-prize for a non-cash prize at fair market value. Hold for review.', '2026-01-01', NULL),
('ca-nonca-item-prize', 1, 'CA', 'NONCA', 'item_prize', 0, 0, 'Residency declaration', 'NR4 (to verify)', false, 'https://www.canada.ca/en/revenue-agency/services/tax/international-non-residents/payments-non-residents.html', 'Unresolved, same as ca-nonca-prize for a non-cash prize at fair market value. Hold for review.', '2026-01-01', NULL)
ON CONFLICT DO NOTHING;
