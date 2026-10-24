# Product

<!-- impeccable:product-schema 1 -->

Eve is an event finance agent. This record captures durable product context from [PRD.md](PRD.md), confirmed by the project owner on October 24, 2026. The PRD remains the detailed scope and implementation brief; this file is its product-context summary.

The repository currently contains the PRD and development skills, with no application scaffold. Capabilities and integrations below are confirmed requirements, not claims of shipped functionality.

## Platform

web

## Stack

Confirmed greenfield stack: one Next.js App Router application with strict TypeScript, server actions, and webhook route handlers; Drizzle with Postgres; Zod validation; Better Auth; Vercel Workflow for durable jobs; Vercel AI SDK with Claude for document understanding and tool calling; Tailwind, shadcn/ui, and TanStack Table for the interface. Deploy the app and workflows on Vercel. Vitest covers the deterministic engines and answer-key scenarios.

Postgres runs on PlanetScale Postgres (decided October 24, 2026), reached through node-postgres: PgBouncer for app traffic, a direct connection for migrations. File storage (Supabase Storage or Cloudflare R2) remains an implementation choice. pdf-lib fills official forms; external services sit behind typed interfaces with the PRD's explicit sandbox or fixture fallbacks.

## Users

- **Organizer / finance lead:** runs event finances, sets budgets and policies, and resolves exceptions without manually coordinating every receipt, form, and payout.
- **Attendee:** an adult hacker, speaker, mentor, or judge who submits expenses, arranges travel, supplies tax information, and claims a prize or payment. International recipients are a core audience.
- **Controller:** the treasurer or fiscal sponsor contact who independently approves releases, handles larger decisions, signs filing packets, and locks accounting periods.
- **Fiscal sponsor:** the university or nonprofit that holds the bank account and executes disbursements in its own system. It can remain an external counterparty receiving packets.
- **Auditor:** an accountant or demo judge with read-only access to decisions and their evidence.
- **Agent:** a restricted system role with explicitly enforced permissions, never a superuser.

## Product Purpose

Run the money side of events from onboarding through travel, expenses, prizes, payout preparation, reconciliation, and year-end filing drafts. Replace fragmented spreadsheets and email with one connected process, while preserving human control of money release.

Success means recipients can see what they need to do and what they will receive; organizers handle exceptions instead of routine coordination; controllers can release complete, explainable payment proposals; and accountants can reconstruct every decision.

The first implementation milestone is one complete international prize flow: winner selected, tax profile collected, withholding computed, controller approval obtained, test payout executed, and ledger and audit trail updated. The seeded-event scoreboard measures detected errors, false positives, and wrongful payouts; its results must come from actual runs.

## Positioning

Eve combines event-specific travel and prize workflows, cross-border tax preparation, and fiscal sponsor handoffs. It fills the travel coordinator, accounts payable clerk, and tax/compliance preparation roles within one permissioned process.

Its distinguishing mechanism is policy-bounded automation backed by deterministic financial calculations, versioned rules, a double-entry ledger, and decision evidence. It supports organizations that do not control their own bank account as well as those that can disburse directly.

## Operating Context

- Organizers configure an organization once, then set each event's travel policy, budget, prizes, paid roles, and attendees. The approval inbox is the organizer's home page.
- Attendees use a separate portal within the same web application for their profile, forms, travel, claims, prizes, and payout preferences.
- Before an event, Eve collects missing information and flags travel or prize constraints. During the event, it prepares winner payment plans. Afterward, it processes claims, reconciles payments, supports closeout, and prepares filing packets.
- Organizations choose direct payout, sponsor packet, or hybrid operation. Sponsor packets contain approved requests and supporting documents; remittance mismatches remain explicit reconciliation exceptions.
- Controllers may approve on a phone during closing ceremonies. Organizers receive Slack or Discord notifications; attendees receive email and portal notices.
- The initial build is for the Cal Hacks 13.0 demonstration. External money movement uses test mode or a mock provider, and filing documents are drafts rather than submitted returns.

## Capabilities and Constraints

### Core workflows

- Adult-only onboarding collects identity, citizenship, tax residency, mailing address, tax profile, and payout preferences. Under-18 attendees at the event start date are blocked.
- Travel supports policy-aware flight suggestions, organization booking with approval, and attendee reimbursement. Receipt checks cover identity, dates, class, caps, currency conversion, and duplicates.
- General expenses use the same receipt, policy, category, and budget process.
- Cash and physical prizes use a shared winner profile. Physical-prize recommendations compare shipping, local purchase, and cash equivalent. Team prize splits require member confirmation when changed from the default.
- Payout proposals disclose gross amount, withholding, fees, FX, expected net received, and delivery timing before approval. Estimates are identified as estimates.
- Missing forms hold payment and trigger follow-up. Changed bank details near payout freeze the payment and require verification through the original contact channel.
- Budgets distinguish spent, committed, and remaining funds. Claims, payouts, people, sponsor packets, decisions, and filing drafts remain traceable to their source records.

### Financial integrity and authority

- The agent can approve clean, in-policy reimbursement claims within an organization-set limit; the PRD default is $300. Claim approval is distinct from money release: every payout requires a controller release.
- A requester cannot approve their own payment. Permissions and segregation of duties are enforced in server code. Blocked approval controls explain why the current user cannot act.
- The agent cannot change policy, approve its own payout proposals, edit posted ledger entries, or access raw tax identifiers and bank numbers.
- Money and tax calculations run in deterministic code, not language-model arithmetic. Rules include jurisdiction, payment type, effective dates, sources, verification status, and versions; decisions retain the version used.
- Store money in integer minor units with currency codes and FX in precise numeric values. Record conversion sources and relevant dates. External operations use idempotency keys.
- The double-entry ledger enforces balance. Posted entries are immutable; corrections use linked reversals, and locked periods reject new entries.
- Sensitive identifiers live in an encrypted vault. The agent and ordinary application flows receive tokens and masked values.
- Decisions retain source documents, facts, rules, explanations, actions, and approvers. Evidence must be accessible from the relevant decision or amount; explanations come from the recorded decision.
- The engine prepares and explains; a human controller signs filing packets. Unverified tax rules stay visibly unverified.

### Demonstration boundaries

- Target real internal tax/rule execution, ledger behavior, agent actions, and audit records. External payouts remain test or simulated money.
- Stripe Connect test mode is the primary planned payout integration, with a mock provider fallback. Wire transfers are simulated. Provider support and fees need verification before integration claims are made.
- Flights use Duffel test mode with fixtures as fallback; QuickBooks uses sandbox books with export fallback. Shipping and duty estimates use mocked country data; the sponsor counterparty is simulated.
- Typed tax-form signatures are demo-grade. Generated forms and exports are not proof of production filing compliance or actual filing.
- Computer use against a fictional sponsor portal and market fare anomaly detection are stretch scope. The fictional portal must not impersonate a real university or tax authority, and submission requires controller approval.
- Preserve the complete international-prize flow, decision log, segregation of duties, and planted-error scoreboard when reducing scope. Follow the PRD for the remaining cut order.

### Open decisions and verification

- The PRD's numeric tax thresholds, rates, treaty interpretation, and reporting assumptions are proposed rules requiring source verification before use; this product record does not validate them as law.
- Specifically unresolved: Canadian-resident prize treaty treatment, attendee reimbursement reporting, California nonresident withholding, and Canadian payer reporting and withholding rules.
- Actual organizer payout practices and pain points beyond the founder's account still need interviews. Integration account readiness, country coverage, and live provider behavior are not established by the repository.

## Brand Commitments

The product name is **Eve**, described as an **event finance agent**. Explain actions and exceptions plainly, show why a decision was made, and distinguish real behavior from simulation. Preserve the product statement that the engine prepares and explains while a human controller signs.

No binding visual direction, palette, typography, logo assets, or broader brand system has been supplied.

## Evidence on Hand

- [PRD.md](PRD.md), dated October 23, 2026, contains the product brief, requirements, architecture proposal, demo plan, integration boundaries, and unresolved questions.
- The PRD records Evan's firsthand account of a TreeHacks prize taking about nine months to resolve. This is the motivating account, not independently verified outcome evidence for Eve.
- A 300-person seeded event, planted-error answer key, scoreboard, and live international-prize replay are planned demonstrations. No seed data, results, runnable demo, or measured performance currently exists in this repository.
- No verified customer testimonials, validated organizer interviews, production payment evidence, or implemented integrations are present. Do not invent them or present demo targets as achieved outcomes.

## Product Principles

1. Automate routine work within explicit policy; bring humans the decisions that need their authority.
2. Make financial decisions reproducible from records, deterministic calculations, and versioned evidence.
3. Show recipients the requirements, costs, and expected net outcome before commitments are approved.
4. Treat international recipients and sponsor-controlled money as core workflows.
5. Build a complete, measurable flow first and disclose exactly what is real, test-mode, simulated, or unverified.

## Accessibility & Inclusion

Controller approvals must work on mobile devices in the event setting. International recipients need clear currency, fee, residency, and form information. Restrictions and blocked actions must include understandable reasons. Eligibility is explicitly adult-only; no additional product-specific accessibility standard or localization commitment has yet been established.
