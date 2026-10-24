# Eve acceptance review (independent)

Reviewed commit `8350f44` (main, 2026-10-24 ~10:50 UTC) against PRD.md and PRODUCT.md. Reviewer did not edit product source. Main has since moved to `061e82d` (financial fixes `3e13506`/`ba4aa76`, controller sponsor UI); this report was not re-run against it, so recheck each finding on current main before fixing.

## How this was checked

- **Executed:** a disposable service-level probe ran `createOrganization` and then the same `runAuthorizedAction` path that `POST /api/actions` uses, against the shared Postgres. It covered one **CA/CAD** org and one **US/USD** org, using real organizer, controller and attendee actor contexts (`demo: false`). Each org was flagged `is_demo` immediately after creation so `purgeOrg` could delete it, and both orgs plus their synthetic `auth_user` rows were purged afterwards (`cleanupRemainingOrgs: 0`). No money moved and nothing was released. The probe script was deleted and not committed. Because notification delivery is simulated when `EVE_NOTIFICATIONS_LIVE` is unset, the `is_demo` flag does not change the bank-code outcome. The probe called services directly, not over HTTP, so it covers server behaviour only, not UI wiring.
- **Executed:** `vitest run` gave 150 passed and 36 skipped (DB-backed suites skip without a test DB), exit 0.
- **Code-read only:** everything marked "code" below.
- **Out of scope:** the financial and UI findings already assigned to other workers (flight price trust, YTD/backup withholding, release self-dealing, FMV/fulfillment, sponsor double-pay, held-award mutations, scoreboard threshold, budget limits, award.fulfill/offerToken UI, controller sponsor UI, real-org Run Eve and sign-out). I did not re-file them.

## Ranked defects (not already owned)

### D1 (critical): real orgs can never activate a payout method, so no real payout can be released

- **Trigger:** in any non-demo org, an attendee (or organizer) calls `payout.bankChange` for a person with no method. This is the *only* way to create a payout method (`lib/server/payouts.ts:305`; the other insert is the seed). Then `payout.verify`.
- **Observed (executed, both orgs):** the method is created `pending_verification` and the person's payouts freeze. The 6-digit code goes only through `deliverBankVerification`, which sends real email only when `EVE_NOTIFICATIONS_LIVE=true` and both `RESEND_API_KEY` and `EVE_EMAIL_FROM` are set (`lib/notifications/index.ts:33-46`). None of these are in the root `.env`. The portal notice body contains no code (`has6digit: false`), and `snapshot.ts:94-95` reveals it only to a demo persona in the demo org. A guessed code returns `409 That code does not match… 4 attempts left`. Every award or claim payout for a person without a method stays `held: No verified payout method on file`, and payouts frozen by the change stay `frozen`.
- **Expected:** PRD core flow 1.5 says the attendee picks a payout method, and the M1 spine requires that the controller release it. Original-channel verification applies to *changes* near a payout, not to the first method.
- **Framing:** holding a *bank change* when notifications are disabled is intentional, and `8350f44` wires the delivery helper after commit. The gap is that no separate path exists for a person's *first* method, so initial enrollment is caught by the replacement safeguard.
- **Minimal fix:** add a dedicated attendee-only initial enrollment, distinct from replacement. In `changeBankDetails` (or a new `payout.enroll` action), when the person has no active method and the actor is that attendee (`actor.personId === personId`), insert the method as `active` (version 1, `verifiedBy` = self, decision logged as "initial method, entered by the account owner") and skip the freeze. Keep the current freeze-and-verify path for every later change and for organizer-entered methods. Alternatively, configure Resend on Preview and document it, but a missing provider should not brick payouts.

### D2 (critical for CAD orgs): `award.create` fails for every CAD prize and stipend

This is a known engine limitation (fulfillment estimates are USD-only), but it blocks non-stretch scope: a CAD org cannot enter any prize or paid role.

- **Exact trigger:** create a CA org via `POST /api/onboarding/organization` with `org.country: "CA"` (currency defaults to `CAD`), import an adult attendee, then `POST /api/actions {action:"award.create", payload:{personId, track:"Best Hack", title:"First Overall", kind:"cash", amountMinor:"100000", currency:"CAD"}}`. The same 409 occurs with `track:"Judge stipend"` and with `kind:"item"`. Omitting `currency` avoids the error only because it defaults to `"USD"`, which records a CAD org's prize as USD.
- **Observed (executed):** `409 fulfillment estimates are in USD; convert the item value first`, thrown from `lib/engines/fulfillment.ts:70` through `recommendFulfillment` in `services.ts:174`. This happens even for cash awards. No award rows are created.
- **Expected:** a Canadian org can enter prizes and paid roles in its own currency.
- **Minimal fix:** in the `award.create` handler, convert the amount to USD with the existing `core.ts` FX helper before building the recommendation input, or skip `recommendFulfillment` for `kind: "cash"`. `sourceFromAward` (`payouts.ts:62`) must also convert: it passes `amountMinor` as USD gross regardless of `award.currency`, so a CAD 1,000 prize would be paid as USD 1,000.

### D3 (critical for CA orgs): CA-payer reimbursements, stipends and item prizes have no tax rule, so they are held permanently

- **Trigger:** in a CA org, an approved expense claim is proposed (`claim.review` approve auto-proposes it).
- **Observed (executed):** the payout has `ruleId: "none"` and status held, with the reason "No tax rule covers CA payer → CA payee for reimbursement". `any-reimbursement` has `payerCountry: "US"` (`lib/tax/rules.ts`), and the only CA rules are `cash_prize`. CA stipends and item prizes have no rules either, so they would hold the same way once D2 is fixed (code).
- **Expected:** reimbursements are paid with no withholding by default, flagged for advisor review (PRD rule table, "Anyone, substantiated travel reimbursement").
- **Minimal fix:** add an unverified rule `ca-any-reimbursement` (`payerCountry "CA"`, `payeeCountry "*"`, `reimbursement`, rate 0, `reportingForm "None (advisor review)"`). `computeTax` already does not hold for unverified reimbursement rules. Add explicit unverified CA stipend and item-prize rules so the hold reason names a real rule instead of "none".

### D4 (high): no way to clear an "unverified rule" hold, so treaty winners, foreign judges and all CA-org prizes are stuck

- **Trigger (code):** `computeTax` sets `hold = true` whenever `!rule.verified && paymentType !== "reimbursement"` (`lib/tax/index.ts:181-184`). That covers:
  - a Canadian winner whose W-8BEN carries a treaty article, which selects `us-ca-prize-treaty` (unverified);
  - any non-US judge or mentor stipend (`us-nonus-stipend`);
  - every CA-org prize (`ca-ca-prize` and `ca-nonca-prize`).
  `reevaluatePerson` and `requote` recompute the same hold, and `actionSchemas` has no review or override action.
- **Observed:** not executed. The finding comes from code inspection and the action list. PRD Settings promises "rule overrides with a required reason", and PRODUCT says unverified rules hold "until a person reviews it", but no review action exists.
- **Expected:** a controller can resolve the hold with a recorded reason. For example, they apply the verified default (30%, shown side by side per the PRD treaty bullet) or explicitly accept the unverified rule.
- **Minimal fix:** add a controller-only action `payout.resolveRule { id, use: "default" | "rule", reason }`. It writes an approval and a decision with the reason and rule ids, recomputes with `rule` forced (the `ComputeTaxInput.rule` override already exists) and `hold` cleared for that reason only, and moves the payout to `proposed`. Release stays a separate controller step under the existing segregation-of-duties checks.

### D5 (high): flight suggestions return nothing for any real event

- **Trigger:** in a real org with event dates other than Cal Hacks weekend, call `flight.search {origin:"YYZ"}`.
- **Observed (executed, both orgs, event 2026-11-20 to 22):** `ok: true`, 0 offers, "No offer meets the cap, cabin and timing policy; escalate for an exception." The fixture fares are hardcoded to 2026-10-22 through 26 into SFO (`lib/flights/index.ts`, "Cal Hacks weekend"), and no Duffel key is configured. The timing filter rejects every offer.
- **Expected:** the authorized fixture fallback produces three labeled "Simulated" suggestions timed to *this* event.
- **Minimal fix:** shift fixture depart and return times by the difference between the event's `checkInAt`/`closingAt` and the fixture weekend before calling `suggestFlights`, keeping `truth: "Simulated"`. Alternatively, return an explicit "no fixture for these dates" message instead of a policy-failure message. This must stay compatible with the incoming `offerToken`/verified-server-facts contract (financial worker).

### D6 (medium): CAD orgs keep USD books and compare CAD-entered limits to USD amounts

- **Observed (code, partly executed):** the probe showed a CAD claim converted to USD (`1822` minor at `0.72876`, "ECB reference (seeded snapshot), 2026-09-01"). Payout `currency` is hardcoded `"USD"` (`payouts.ts:83,102`), every journal line is USD (`payouts.ts:174-190`), FX converts only to USD (`core.ts:266-276`), and filings render USD. `claims.ts:111` compares `claim.usdMinor` with `org.agentLimitMinor`, which a CAD org enters in CAD (default `30000`).
- **Expected:** PRODUCT/PRD "new real organizations (USD/CAD)" means amounts in the org's currency, or at least explicitly USD-functional books with converted limits.
- **Minimal fix (demo-safe):** convert to `org.currency` instead of USD in `toUsd`/payouts/journals for CA orgs. If there's no time, label the org currency as "reporting currency USD" at setup and convert `agentLimitMinor`/`organizerLimitMinor` and budget caps at entry.

### D7 (medium): the approval-escalation and calendar triggers from the PRD trigger table are missing

- "Approval sits unanswered → remind, then route to the backup approver": no backup approver field or logic exists anywhere (grep `backup` in lib/app/workflows/components: none). Setup step 3 also promises a backup approver per role.
- "Calendar: Jan 1 → assemble the year-end packet": `/api/cron` handles digests and bank-code delivery only. Filings are on demand (`filings.generate`).
- **Fix:** have the cron route call `filings.generate` for the previous year on Jan 1 (agent actor, draft only). Add a 24h reminder notice for `proposed` payouts older than N hours. A backup approver can stay out of scope if the gap is disclosed.

### D8 (low): awards can be created for minors

- **Observed (executed, US org):** `award.create` for a person with `adult: false` succeeds (status `needs_form`). Its payout is correctly held with "Recipient is under 18; Eve does not pay minors." No money risk. Rejecting at `award.create` with that message would match "minors are blocked".

## Coverage matrix

Status key: **Impl** = works for real orgs. **Partial** = works with a material gap. **Fallback** = authorized simulation or fixture. **Missing** = not built. **Blocked** = built but unreachable for real orgs because of a defect above. "Run" means executed in this review.

| PRD area / journey | Status | Evidence | Run |
| --- | --- | --- | --- |
| Real signup/login, create org (US or CA), first event, default budgets, ledger accounts, rules | Impl | `onboarding.ts createOrganization`; CA→CAD default currency | Run (service) |
| Staff invites (organizer/controller/auditor), attendee copy-link invite | Impl (known: email ownership unverified, no provider) | `onboarding.ts createInvitation/createAttendeeInvitation/acceptInvitation` | Code |
| Membership edit/removal, multiple events per org | Missing (known) | one event per org, no member mutation | Code |
| Setup wizard `/setup` (mode, limits, notifications) | Partial | `org.update`; no backup approver (D7); no QBO connect (fallback CSV) | Code |
| Event tabs: Basics, Travel, Budget, Prizes warnings, Roles, Import | Impl/Partial | `event-setup-view.tsx` tabs; `event.update`, `budget.update`, `people.import` | Run (actions) |
| CSV attendee import, under-18 blocked | Impl | `people.import` → `adult:false`, `minors: 1` | Run |
| Tax profile: W-9 / W-8BEN / Residency declaration, typed signature, TIN vaulted, draft PDF | Impl (demo-grade, draft) | `tax.submit` returned `valid` + `documentId` | Run |
| W-8BEN-E, SIN-token form for CA payees | Partial | enum accepts W-8BEN-E; CA payer rule says "SIN (token)" but the CA attendee is accepted with "Residency declaration" | Run |
| Payout method selection with fee/time shown | **Blocked (D1)** | first method needs a code that real orgs can't receive | Run |
| Bank change freeze + original-channel verification | Impl (demo); real orgs never get the code without an email provider | `changeBankDetails`, `verifyBankChange`, delivery helper | Run |
| Travel: flight suggest (3 under cap, timed) | **Fallback only for demo dates (D5)** | `lib/flights/index.ts` fixtures fixed to Oct 22–26 / SFO | Run (0 offers) |
| Travel: org-books path | Partial (financial worker owns the price-trust contract) | `flight.request` | Code |
| Travel/expense claim: policy, FX on purchase date, duplicate, escalate vs auto-approve | Impl (US); Partial (CAD limits, D6) | probe CAD claim escalated with reasons; FX source recorded | Run |
| Receipt OCR (LLM vision) | Impl (per coordinator: synthetic PDF verified) | `lib/agent/receipt.ts`, `scripts/verify-ocr.ts` | Not re-run |
| Claim review by organizer, SoD | Impl | `claim.review` approve → auto-proposed payout | Run |
| Cash prize → tax → quote → proposal (US org) | Impl up to proposal; release **blocked (D1)** | US org: W-8BEN Canadian winner gets 30% `us-nonus-prize`, held only for method | Run |
| Cash prize in CAD org | **Broken (D2, D3/D4)** | `award.create` 409 | Run |
| Item prize ship/local/cash recommendation, gross-up | Partial (FMV/fulfill owned by financial worker) | `recommendFulfillment`, `grossUp` | Code |
| Team split + confirmation | Impl (mutation gaps owned by financial worker) | `award.split/confirm` | Code |
| Paid roles / stipends (judge, mentor) | Partial | no stipend object; a stipend is an `award` whose track matches `/stipend\|judge\|mentor\|speaker/` (`engines.ts:27`). US→US held only on method (run); non-US stipend unverified and stuck (D4); CAD fails (D2) | Run |
| Cumulative $2,000 thresholds by form | Impl (backup-withholding fix owned) | `aggregateYtdByForm`, `paymentsFor` | Code + unit tests |
| Treaty claim shown side by side with 30% default | Partial | `defaultComparison` computed; payout then stuck (D4) | Code |
| California state layer flagged | Impl (flag only, unverified) | `us-ca-state-nonresident` | Code |
| Canadian payer rules (T4A / NR4) | Partial: rules unverified, reimbursement rule missing (D3) | `rules.ts` | Run |
| Unverified rule review/override with reason | **Missing (D4)** | no action | Code |
| Payout release (controller only, SoD, bank version) | Impl, simulated provider | `releasePayout`; not reachable for real orgs (D1) | Code |
| Stripe Connect test payouts | Fallback (deliberately simulated; platform credential probe only) | `/api/integrations/stripe` read-only | Code |
| Mock wire / multi-provider quote | Fallback | `lib/payouts/mock-wire.ts`, `quote.ts` | Unit tests |
| Ledger: balanced, immutable, reversals, period lock | Impl | migrations 0001, `lib/ledger`; `period.lock` | Unit/DB tests (DB suites skipped here) |
| Org-currency books for CAD orgs | **Partial (D6)** | USD hardcoded | Code |
| Sponsor packets, submit, reconcile short-pay exception | Impl (double-pay/1100 fix owned) | `sponsor.*` | Code |
| Budget spent/committed/remaining | Partial (limits owned by financial worker) | `budget-view.tsx`, `budget.update` | Run (update) |
| Decision log / audit trail / evidence | Impl | `recordDecision` on every action in probe | Run |
| Agent run: claims, auto-proposals, chase | Impl (real-org UI button owned by UI worker) | `agent.run` chased 1 person in the US org | Run |
| Durable workflows: approval hook, tax chase | Impl (per coordinator) | `workflows/*.ts`, `scripts/verify-workflow.ts` | Not re-run |
| Approval reminder → backup approver | **Missing (D7)** | none | Code |
| Jan 1 year-end packet trigger | **Missing (D7)**; on-demand generation exists | `/api/cron` | Code |
| Filings: 1099-MISC, 1099-NEC, 1042-S drafts; 1042 summary draft | Impl (drafts, not official forms) | `filings.generate` (0 drafted with nothing paid) | Run |
| T4A / NR4 drafts | Missing (allowed cut #5) | — | Code |
| Notifications: Slack/Discord/email | Fallback (notice log; live only with env flags) | `lib/notifications` | Run (notices recorded, `simulated`) |
| QuickBooks | Fallback (CSV + manifest) | `accounting-export.ts` | Code |
| Seeded 300-person event, answer key, scoreboard | Impl (threshold fix owned) | `seed.ts`, `scoreboard.ts` | Not re-run |
| Computer use, fare anomaly (SerpApi) | Missing (stretch, excluded) | — | — |

## Bottom line

The demo org exercises the spine. A **new real organization cannot complete a single payout**. In both USD and CAD orgs, D1 blocks every payout method. A CAD org also cannot create prizes or stipends (D2), and its reimbursements hold forever (D3). Any treaty-claiming Canadian winner or foreign judge stalls with no way to resolve the hold (D4). Fix order for the remaining time: **D1, D2+D3 (small), D4, D5**. D6 and D7 can be disclosed as limitations if time runs out.
