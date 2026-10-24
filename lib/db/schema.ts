// Eve relational schema (PRD, "Data model and ledger").
//
// Money: bigint integer minor units plus a currency code. FX: numeric(18,8).
// Never floats. Core relationships are foreign keys; JSON columns only hold
// immutable evidence (extracted receipt fields, check results, decision facts).
//
// Raw SQL that Drizzle cannot express (deferred ledger balance trigger,
// immutability and locked-period triggers, demo-reset guard) lives in the
// custom migration `lib/db/migrations/*_ledger_integrity.sql`.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const money = (name: string) => bigint(name, { mode: "bigint" });
const fx = (name: string) => numeric(name, { precision: 18, scale: 8 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();

export const roleEnum = pgEnum("member_role", ["attendee", "organizer", "controller", "auditor", "agent"]);
export const orgModeEnum = pgEnum("org_mode", ["direct", "sponsor", "hybrid"]);
export const taxFormEnum = pgEnum("tax_form", ["W-9", "W-8BEN", "W-8BEN-E", "Residency declaration"]);
export const taxStatusEnum = pgEnum("tax_status", ["missing", "valid", "expired", "review"]);
export const claimTypeEnum = pgEnum("claim_type", ["travel", "expense"]);
export const claimStatusEnum = pgEnum("claim_status", [
  "submitted", "processing", "approved", "escalated", "rejected", "needs_info", "paid",
]);
export const awardKindEnum = pgEnum("award_kind", ["cash", "item"]);
export const fulfillmentEnum = pgEnum("fulfillment", ["undecided", "ship", "local", "cash"]);
export const awardStatusEnum = pgEnum("award_status", ["draft", "needs_form", "ready", "proposed", "paid"]);
export const sourceTypeEnum = pgEnum("payout_source", ["claim", "award"]);
export const payoutStatusEnum = pgEnum("payout_status", [
  "held", "proposed", "approved", "processing", "paid", "failed", "returned", "frozen",
]);
export const methodStatusEnum = pgEnum("payout_method_status", [
  "active", "pending_verification", "superseded", "rejected",
]);
export const packetStatusEnum = pgEnum("packet_status", ["draft", "submitted", "questioned", "paid", "exception"]);
export const decisionStatusEnum = pgEnum("decision_status", ["running", "waiting", "done", "escalated", "frozen"]);
export const filingStatusEnum = pgEnum("filing_status", ["draft", "reviewed"]);
export const noticeStatusEnum = pgEnum("notice_status", ["queued", "sent", "simulated"]);
export const accountTypeEnum = pgEnum("account_type", ["asset", "liability", "expense", "income", "equity"]);

// ---------------------------------------------------------------- Better Auth
// Table shapes follow Better Auth's core schema; wired via drizzleAdapter in lib/auth.

export const authUser = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const authSession = pgTable("auth_session", {
  id: text("id").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
});

export const authAccount = pgTable("auth_account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: ts("access_token_expires_at"),
  refreshTokenExpiresAt: ts("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const authVerification = pgTable("auth_verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ------------------------------------------------------------- Organizations

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  country: text("country").notNull(),
  mode: orgModeEnum("mode").notNull().default("hybrid"),
  currency: text("currency").notNull().default("USD"),
  agentLimitMinor: money("agent_limit_minor").notNull().default(sql`30000`),
  organizerLimitMinor: money("organizer_limit_minor").notNull().default(sql`200000`),
  controllerThresholdMinor: money("controller_threshold_minor").notNull().default(sql`200000`),
  sponsorName: text("sponsor_name").notNull().default(""),
  sponsorTurnaroundDays: integer("sponsor_turnaround_days").notNull().default(10),
  feesPaidBy: text("fees_paid_by", { enum: ["org", "recipient"] }).notNull().default("org"),
  notificationChannel: text("notification_channel"),
  policyNotes: text("policy_notes"),
  /** Only demo orgs accept demo-persona sessions and scoped reset. */
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const event = pgTable("event", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  venue: text("venue").notNull(),
  expectedHeadcount: integer("expected_headcount").notNull().default(0),
  travelCapMinor: money("travel_cap_minor").notNull(),
  economyOnly: boolean("economy_only").notNull().default(true),
  bookingDeadline: ts("booking_deadline").notNull(),
  checkInAt: ts("check_in_at").notNull(),
  closingAt: ts("closing_at").notNull(),
  locked: boolean("locked").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("event_org_idx").on(t.orgId)]);

export const person = pgTable("person", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  eventId: text("event_id").references(() => event.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  /** Original contact channel. Bank changes never alter it; verification codes go here. */
  email: text("email").notNull(),
  country: text("country").notNull(),
  citizenship: text("citizenship").notNull(),
  dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
  address: text("address").notNull().default(""),
  role: text("role").notNull().default("hacker"),
  adult: boolean("adult").notNull(),
  payoutCurrency: text("payout_currency").notNull().default("USD"),
  chaseCount: integer("chase_count").notNull().default(0),
  lastChasedAt: ts("last_chased_at"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("person_org_email_uq").on(t.orgId, t.email),
  index("person_org_idx").on(t.orgId),
]);

export const orgMember = pgTable("org_member", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => authUser.id, { onDelete: "cascade" }),
  personId: text("person_id").references(() => person.id, { onDelete: "set null" }),
  role: roleEnum("role").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  /** Selectable through POST /api/demo/session (demo orgs only). */
  demoPersona: boolean("demo_persona").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("org_member_user_uq").on(t.orgId, t.userId),
  uniqueIndex("org_member_email_uq").on(t.orgId, t.email),
  check("org_member_attendee_person", sql`${t.role} <> 'attendee' OR ${t.personId} IS NOT NULL`),
]);

// ------------------------------------------------------------- PII and files

/** AES-256-GCM ciphertext (server key, EVE_VAULT_KEY). Only last4 ever leaves the server. */
export const vaultSecret = pgTable("vault_secret", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  personId: text("person_id").references(() => person.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["tin", "bank_account", "verification_code"] }).notNull(),
  ciphertext: bytea("ciphertext").notNull(),
  iv: bytea("iv").notNull(),
  tag: bytea("tag").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  last4: text("last4"),
  createdAt: createdAt(),
});

export const document = pgTable("document", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  personId: text("person_id").references(() => person.id, { onDelete: "set null" }),
  uploadedBy: text("uploaded_by").notNull(),
  kind: text("kind", { enum: ["receipt", "tax_form", "sponsor_packet", "filing", "upload"] }).notNull(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: createdAt(),
}, (t) => [
  index("document_org_hash_idx").on(t.orgId, t.sha256),
  check("document_size_limit", sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 10485760`),
]);

export const taxProfile = pgTable("tax_profile", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  personId: text("person_id").notNull().references(() => person.id, { onDelete: "cascade" }),
  form: taxFormEnum("form").notNull(),
  status: taxStatusEnum("status").notNull(),
  statusReason: text("status_reason").notNull().default(""),
  signatureName: text("signature_name"),
  signedAt: ts("signed_at"),
  expiresAt: ts("expires_at"),
  tinVaultId: text("tin_vault_id").references(() => vaultSecret.id),
  tinLast4: text("tin_last4"),
  treatyCountry: text("treaty_country"),
  treatyArticle: text("treaty_article"),
  documentId: text("document_id").references(() => document.id, { onDelete: "set null" }),
  supersededAt: ts("superseded_at"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("tax_profile_current_uq").on(t.personId).where(sql`${t.supersededAt} IS NULL`),
]);

export const payoutMethod = pgTable("payout_method", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  personId: text("person_id").notNull().references(() => person.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("simulated"),
  currency: text("currency").notNull(),
  last4: text("last4").notNull(),
  vaultId: text("vault_id").references(() => vaultSecret.id),
  status: methodStatusEnum("status").notNull(),
  /** Monotonic per person; payouts pin the version they were quoted against. */
  version: integer("version").notNull(),
  requestedVia: text("requested_via").notNull().default("portal"),
  requestedBy: text("requested_by").notNull(),
  verificationVaultId: text("verification_vault_id").references(() => vaultSecret.id),
  verificationSentTo: text("verification_sent_to"),
  verificationExpiresAt: ts("verification_expires_at"),
  verificationAttempts: integer("verification_attempts").notNull().default(0),
  verifiedAt: ts("verified_at"),
  verifiedBy: text("verified_by"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("payout_method_version_uq").on(t.personId, t.version),
  uniqueIndex("payout_method_active_uq").on(t.personId).where(sql`${t.status} = 'active'`),
  uniqueIndex("payout_method_pending_uq").on(t.personId).where(sql`${t.status} = 'pending_verification'`),
]);

// ------------------------------------------------------------------ Rules

export const taxRule = pgTable("tax_rule", {
  id: text("id").notNull(),
  version: integer("version").notNull(),
  payerCountry: text("payer_country").notNull(),
  payeeCountry: text("payee_country").notNull(),
  paymentType: text("payment_type").notNull(),
  rateBps: integer("rate_bps").notNull(),
  thresholdMinor: money("threshold_minor").notNull(),
  form: text("form").notNull(),
  reportingForm: text("reporting_form").notNull(),
  verified: boolean("verified").notNull(),
  sourceUrl: text("source_url").notNull(),
  explanation: text("explanation").notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.id, t.version] })]);

export const fxRate = pgTable("fx_rate", {
  rateDate: date("rate_date", { mode: "string" }).notNull(),
  base: text("base").notNull(),
  quote: text("quote").notNull(),
  rate: fx("rate").notNull(),
  source: text("source").notNull(),
}, (t) => [primaryKey({ columns: [t.rateDate, t.base, t.quote] })]);

// ------------------------------------------------------------ Money objects

export const budgetLine = pgTable("budget_line", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull().references(() => event.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Claim category or "prizes"; used to attribute spend. */
  category: text("category").notNull(),
  capMinor: money("cap_minor").notNull(),
  fundingSource: text("funding_source").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("budget_line_event_category_uq").on(t.eventId, t.category)]);

export const claim = pgTable("claim", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull().references(() => event.id, { onDelete: "cascade" }),
  personId: text("person_id").notNull().references(() => person.id, { onDelete: "cascade" }),
  budgetLineId: text("budget_line_id").references(() => budgetLine.id, { onDelete: "set null" }),
  type: claimTypeEnum("type").notNull(),
  merchant: text("merchant").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull(),
  amountMinor: money("amount_minor").notNull(),
  currency: text("currency").notNull(),
  usdMinor: money("usd_minor").notNull(),
  fxRate: fx("fx_rate").notNull(),
  fxSource: text("fx_source").notNull(),
  purchasedAt: ts("purchased_at").notNull(),
  travelDate: ts("travel_date"),
  cabin: text("cabin"),
  origin: text("origin"),
  nameOnReceipt: text("name_on_receipt"),
  receiptName: text("receipt_name"),
  documentId: text("document_id").references(() => document.id, { onDelete: "set null" }),
  receiptHash: text("receipt_hash"),
  extracted: jsonb("extracted").$type<Record<string, unknown>>(),
  status: claimStatusEnum("status").notNull().default("submitted"),
  checks: jsonb("checks").$type<{ code: string; label: string; passed: boolean; detail: string }[]>().notNull().default([]),
  reason: text("reason").notNull().default(""),
  dueAt: ts("due_at").notNull(),
  requestedBy: text("requested_by").notNull(),
  reviewedBy: text("reviewed_by"),
  idempotencyKey: text("idempotency_key"),
  createdAt: createdAt(),
}, (t) => [
  index("claim_org_idx").on(t.orgId),
  index("claim_person_idx").on(t.personId),
  uniqueIndex("claim_idempotency_uq").on(t.orgId, t.idempotencyKey),
  check("claim_amount_positive", sql`${t.amountMinor} > 0 AND ${t.usdMinor} >= 0`),
]);

export const award = pgTable("award", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull().references(() => event.id, { onDelete: "cascade" }),
  personId: text("person_id").notNull().references(() => person.id, { onDelete: "cascade" }),
  track: text("track").notNull(),
  title: text("title").notNull(),
  kind: awardKindEnum("kind").notNull(),
  /** Cash amount, or item fair market value. */
  amountMinor: money("amount_minor").notNull(),
  currency: text("currency").notNull().default("USD"),
  fulfillment: fulfillmentEnum("fulfillment").notNull().default("undecided"),
  status: awardStatusEnum("status").notNull().default("draft"),
  recommendation: text("recommendation").notNull().default(""),
  shippingMinor: money("shipping_minor").notNull().default(sql`0`),
  localMinor: money("local_minor").notNull().default(sql`0`),
  teamId: text("team_id"),
  splitBps: integer("split_bps").notNull().default(10000),
  splitConfirmed: boolean("split_confirmed").notNull().default(true),
  dueAt: ts("due_at").notNull(),
  requestedBy: text("requested_by").notNull(),
  createdAt: createdAt(),
}, (t) => [
  index("award_org_idx").on(t.orgId),
  check("award_split_range", sql`${t.splitBps} > 0 AND ${t.splitBps} <= 10000`),
  check("award_amount_positive", sql`${t.amountMinor} > 0`),
]);

export const payout = pgTable("payout", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  personId: text("person_id").notNull().references(() => person.id, { onDelete: "cascade" }),
  sourceType: sourceTypeEnum("source_type").notNull(),
  claimId: text("claim_id").references(() => claim.id, { onDelete: "cascade" }),
  awardId: text("award_id").references(() => award.id, { onDelete: "cascade" }),
  grossMinor: money("gross_minor").notNull(),
  withholdingMinor: money("withholding_minor").notNull(),
  feeMinor: money("fee_minor").notNull(),
  netMinor: money("net_minor").notNull(),
  currency: text("currency").notNull(),
  destinationCurrency: text("destination_currency").notNull(),
  destinationNetMinor: money("destination_net_minor").notNull(),
  fxRate: fx("fx_rate").notNull(),
  provider: text("provider").notNull(),
  truth: text("truth", { enum: ["Test mode", "Simulated", "Estimate", "Unverified rule"] }).notNull(),
  status: payoutStatusEnum("status").notNull(),
  /** Status to restore when a freeze is resolved. */
  frozenFrom: payoutStatusEnum("frozen_from"),
  reason: text("reason").notNull().default(""),
  ruleId: text("rule_id").notNull(),
  ruleVersion: integer("rule_version").notNull(),
  ruleVerified: boolean("rule_verified").notNull(),
  reportingForm: text("reporting_form"),
  /** Engine result: the payee's same-form YTD total crosses the reporting threshold with this payment. */
  reportable: boolean("reportable").notNull().default(false),
  requestedBy: text("requested_by").notNull(),
  releasedBy: text("released_by"),
  payoutMethodId: text("payout_method_id").references(() => payoutMethod.id),
  bankVersion: integer("bank_version"),
  idempotencyKey: text("idempotency_key").notNull(),
  providerRef: text("provider_ref"),
  attempts: integer("attempts").notNull().default(0),
  dueAt: ts("due_at").notNull(),
  paidAt: ts("paid_at"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("payout_idempotency_uq").on(t.idempotencyKey),
  // One live payout per source: a retry re-uses the row, it never pays twice.
  uniqueIndex("payout_live_claim_uq").on(t.claimId).where(sql`${t.status} NOT IN ('failed', 'returned') AND ${t.claimId} IS NOT NULL`),
  uniqueIndex("payout_live_award_uq").on(t.awardId).where(sql`${t.status} NOT IN ('failed', 'returned') AND ${t.awardId} IS NOT NULL`),
  index("payout_org_idx").on(t.orgId),
  check("payout_source_fk", sql`(${t.sourceType} = 'claim' AND ${t.claimId} IS NOT NULL AND ${t.awardId} IS NULL) OR (${t.sourceType} = 'award' AND ${t.awardId} IS NOT NULL AND ${t.claimId} IS NULL)`),
  check("payout_amounts", sql`${t.grossMinor} >= 0 AND ${t.withholdingMinor} >= 0 AND ${t.feeMinor} >= 0 AND ${t.netMinor} >= 0`),
  check("payout_no_self_release", sql`${t.releasedBy} IS NULL OR ${t.releasedBy} <> ${t.requestedBy}`),
]);

export const approval = pgTable("approval", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  requestedBy: text("requested_by").notNull(),
  approverId: text("approver_id").notNull(),
  approverRole: roleEnum("approver_role").notNull(),
  decision: text("decision", { enum: ["approved", "rejected", "needs_info"] }).notNull(),
  reason: text("reason").notNull().default(""),
  bankVersion: integer("bank_version"),
  createdAt: createdAt(),
}, (t) => [
  check("approval_segregation", sql`${t.approverId} <> ${t.requestedBy}`),
  check("approval_not_agent", sql`${t.approverRole} <> 'agent' OR ${t.objectType} = 'claim'`),
]);

/**
 * A controller's recorded resolution of an unverified-rule hold for one payout
 * source (award or claim): apply the verified default rule, or accept the
 * unverified rule as stated. It never edits a rule. It applies only while the
 * tax profile, the source amount, the payment type and the selected rule
 * version are unchanged. A separate controller release is still required.
 */
export const taxRuleOverride = pgTable("tax_rule_override", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  sourceType: sourceTypeEnum("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  personId: text("person_id").notNull().references(() => person.id, { onDelete: "cascade" }),
  taxProfileId: text("tax_profile_id").notNull().references(() => taxProfile.id, { onDelete: "cascade" }),
  paymentType: text("payment_type").notNull(),
  amountMinor: money("amount_minor").notNull(),
  currency: text("currency").notNull(),
  /** The unverified rule whose hold was resolved. */
  ruleId: text("rule_id").notNull(),
  ruleVersion: integer("rule_version").notNull(),
  decision: text("decision", { enum: ["default", "rule"] }).notNull(),
  appliedRuleId: text("applied_rule_id").notNull(),
  appliedRuleVersion: integer("applied_rule_version").notNull(),
  reason: text("reason").notNull(),
  approvedBy: text("approved_by").notNull(),
  createdAt: createdAt(),
  revokedAt: ts("revoked_at"),
}, (t) => [
  uniqueIndex("tax_rule_override_live_uq").on(t.sourceType, t.sourceId).where(sql`${t.revokedAt} IS NULL`),
  index("tax_rule_override_org_idx").on(t.orgId),
  check("tax_rule_override_reason", sql`length(trim(${t.reason})) >= 10`),
]);

export const sponsorPacket = pgTable("sponsor_packet", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  payoutId: text("payout_id").notNull().references(() => payout.id, { onDelete: "cascade" }),
  requestedMinor: money("requested_minor").notNull(),
  paidMinor: money("paid_minor").notNull().default(sql`0`),
  status: packetStatusEnum("status").notNull().default("draft"),
  submittedAt: ts("submitted_at"),
  dueAt: ts("due_at").notNull(),
  reason: text("reason").notNull().default(""),
  documentId: text("document_id").references(() => document.id, { onDelete: "set null" }),
  /** Remittance amount reported by the sponsor before reconciliation (seeded or imported). */
  remittanceMinor: money("remittance_minor"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("sponsor_packet_payout_uq").on(t.payoutId)]);

export const filing = pgTable("filing", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  personId: text("person_id").notNull().references(() => person.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  form: text("form").notNull(),
  grossMinor: money("gross_minor").notNull(),
  withholdingMinor: money("withholding_minor").notNull(),
  status: filingStatusEnum("status").notNull().default("draft"),
  documentId: text("document_id").references(() => document.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("filing_person_year_form_uq").on(t.orgId, t.personId, t.year, t.form)]);

export const notice = pgTable("notice", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  personId: text("person_id").references(() => person.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  /** Encrypted body only the recipient may read (e.g. a verification code). */
  privateVaultId: text("private_vault_id").references(() => vaultSecret.id),
  status: noticeStatusEnum("status").notNull().default("simulated"),
  createdAt: createdAt(),
});

// ------------------------------------------------------- Audit and agent runs

export const agentRun = pgTable("agent_run", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  status: text("status", { enum: ["running", "done", "failed"] }).notNull(),
  triggeredBy: text("triggered_by").notNull(),
  summary: text("summary").notNull().default(""),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
});

export const decisionLog = pgTable("decision_log", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull(),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  personId: text("person_id").references(() => person.id, { onDelete: "set null" }),
  personName: text("person_name").notNull().default(""),
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  actor: text("actor").notNull(),
  actorRole: roleEnum("actor_role").notNull(),
  status: decisionStatusEnum("status").notNull(),
  tool: text("tool").notNull(),
  ruleId: text("rule_id"),
  ruleVersion: integer("rule_version"),
  facts: jsonb("facts").$type<Record<string, unknown>>().notNull().default({}),
  checks: jsonb("checks").$type<{ code: string; label: string; passed: boolean; detail: string }[]>(),
  documentId: text("document_id").references(() => document.id, { onDelete: "set null" }),
  nextActionAt: ts("next_action_at"),
  createdAt: createdAt(),
}, (t) => [index("decision_org_created_idx").on(t.orgId, t.createdAt)]);

/** Client-supplied idempotency keys for mutating actions; the stored result is replayed. */
export const actionIdempotency = pgTable("action_idempotency", {
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  key: text("key").notNull(),
  actorId: text("actor_id").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.orgId, t.action, t.key] })]);

// ------------------------------------------------------------------ Ledger

export const ledgerAccount = pgTable("ledger_account", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: accountTypeEnum("type").notNull(),
}, (t) => [uniqueIndex("ledger_account_code_uq").on(t.orgId, t.code)]);

export const accountingPeriod = pgTable("accounting_period", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  startsOn: date("starts_on", { mode: "string" }).notNull(),
  endsOn: date("ends_on", { mode: "string" }).notNull(),
  locked: boolean("locked").notNull().default(false),
  lockedBy: text("locked_by"),
  lockedAt: ts("locked_at"),
}, (t) => [
  uniqueIndex("accounting_period_start_uq").on(t.orgId, t.startsOn),
  check("accounting_period_range", sql`${t.endsOn} >= ${t.startsOn}`),
]);

export const journalEntry = pgTable("journal_entry", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "restrict" }),
  entryDate: date("entry_date", { mode: "string" }).notNull(),
  memo: text("memo").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  reversesEntryId: text("reverses_entry_id").references((): any => journalEntry.id, { onDelete: "restrict" }), // eslint-disable-line @typescript-eslint/no-explicit-any
  idempotencyKey: text("idempotency_key").notNull(),
  createdBy: text("created_by").notNull(),
  postedAt: ts("posted_at").notNull().defaultNow(),
  /** Transaction that created the entry; lines may only be added inside it. */
  createdTxid: bigint("created_txid", { mode: "bigint" }).notNull().default(sql`txid_current()`),
}, (t) => [
  uniqueIndex("journal_entry_idempotency_uq").on(t.orgId, t.idempotencyKey),
  uniqueIndex("journal_entry_reversal_uq").on(t.reversesEntryId),
  index("journal_entry_source_idx").on(t.sourceType, t.sourceId),
]);

export const journalLine = pgTable("journal_line", {
  id: text("id").primaryKey(),
  entryId: text("entry_id").notNull().references(() => journalEntry.id, { onDelete: "restrict" }),
  accountId: text("account_id").notNull().references(() => ledgerAccount.id, { onDelete: "restrict" }),
  debitMinor: money("debit_minor").notNull().default(sql`0`),
  creditMinor: money("credit_minor").notNull().default(sql`0`),
  currency: text("currency").notNull(),
  personId: text("person_id").references(() => person.id, { onDelete: "set null" }),
  memo: text("memo").notNull().default(""),
}, (t) => [
  index("journal_line_entry_idx").on(t.entryId),
  check("journal_line_one_side", sql`(${t.debitMinor} > 0 AND ${t.creditMinor} = 0) OR (${t.creditMinor} > 0 AND ${t.debitMinor} = 0)`),
]);

// ---------------------------------------------------- Proof: answer key + runs

/** Expected outcomes for planted errors. Kept apart from decisions; never read by checks. */
export const answerKey = pgTable("answer_key", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  scenario: text("scenario").notNull(),
  objectType: text("object_type", { enum: ["claim", "person", "award", "payout", "packet"] }).notNull(),
  objectId: text("object_id").notNull(),
  /** flag: claim must not auto-approve and must carry a failed check. hold: no payout may move. freeze: payout frozen. exception: packet exception. reportable: filing drafted. */
  expected: text("expected", { enum: ["flag", "hold", "freeze", "exception", "reportable", "clean"] }).notNull(),
  expectedCode: text("expected_code"),
  description: text("description").notNull(),
});

export const scoreboardRun = pgTable("scoreboard_run", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  runAt: ts("run_at").notNull().defaultNow(),
  total: integer("total").notNull(),
  caught: integer("caught").notNull(),
  missed: integer("missed").notNull(),
  falsePositives: integer("false_positives").notNull(),
  wrongfulPayouts: integer("wrongful_payouts").notNull(),
  results: jsonb("results").$type<{ id: string; scenario: string; expected: string; actual: string; passed: boolean }[]>().notNull(),
});
