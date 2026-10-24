# Financial review, round 2

Reviewed commit: `8d8ec80` (root `main`, 2026-10-24). I only reviewed; I did not edit any product files.

## Method

- **Read in full:** `lib/server/payouts.ts`; the award, fulfill, release, sponsor and filings sections of `lib/server/services.ts`; `reviewClaim` and `bookOrgFlight` in `lib/server/claims.ts`; `computeTax`/`selectRule`/`aggregateYtdByForm` in `lib/tax/index.ts`; `lib/agent/payout-approval.ts`, `lib/agent/release.ts` and `workflows/payout-approval.ts`; agent operations; `lib/server/ACTIONS.md`.
- **Executed:** two throwaway vitest files (repros A–D) against the shared Postgres, run through `runAuthorizedAction` (the same path `/api/actions` uses). It used two disposable orgs created with `createTestOrg`, which flags them `is_demo`, and purged both with `dropTestOrg` afterwards. A follow-up query found 0 leftover orgs. The test file was deleted and is not committed. I did not touch the shared demo org, the server on :3000 or any global tables, and no money moved.

## Findings

### F1 (high, reproduced): tax year comes from the event start, not the payment date

- **Code:** `taxFor` at `lib/server/payouts.ts:169` sets `year = ctx.event.startsAt.getUTCFullYear()` and passes it to `selectRule` and to `aggregateYtdByForm`. `aggregateYtdByForm` (`lib/tax/index.ts`) drops every payment whose `paidAt` year differs from that year. `generateFilings` groups by the `paidAt` year, so the quote and the filing use different years.
- **Trigger:** any event whose start year differs from the year its payments are made, for example a December hackathon that pays prizes in January. In both runs below, the US winner has a W-9 with no TIN and gets two $1,500 cash prizes. I did not patch `paidAt` in either run.
- **Evidence C (real clock, 2026-10-24):** the event started 2025-12-28. Both payouts were proposed and released by the controller. Both were paid in 2026 under `us-us-prize-2025 v1` with withholding 0 and `reportable: true`. No backup rule exists for 2025, so backup withholding never runs. Under the 2026 payment-year rules (`us-us-prize v2` and `us-us-backup`, $2,000 threshold), payment 2 should have withheld 24% = $360, because the aggregate is $3,000. The payments are under-withheld and carry the wrong rule version, with its $600 threshold.
- **Evidence D (JS `Date` faked to 2027-01-04 with `vi.setSystemTime`; `paidAt` comes from JS `Date`):** the event started 2026-12-28. Payout 1 was released under `us-us-prize v2` (a 2026 rule) with `paidAt` 2027-01-04. Payout 2 was then proposed with withholding 0 and "Below the 1099-MISC box 3 threshold for 2026 so far", because the 2026 YTD bucket leaves out the 2027 payment. Under payment-year semantics there is no verified 2027 US rule, so both payouts should be held. Only the JS clock was faked; DB defaults such as `createdAt` used the real time.
- **Impact:** a year-boundary event skips backup withholding (the same failure as original finding 2) and applies an expired rule version. Its filings, grouped by `paidAt` year, don't match the quotes.
- **Small fix:** derive the tax year from the payment date: `now` at proposal and at release. At release the quote is already recomputed under the person lock, so a year rollover then re-quotes. Use that year for both `selectRule` and the YTD bucket, and record it in `facts`. Add a regression test with an event in late December and a `paidAt` in January. `awardFulfill` needs the same fix, since it calls `taxFor` and `computeTax` with the event year.

### F2 (medium, reproduced): sponsor reconcile reads the current fee policy, not the policy at submission

- **Code:** in `reconcilePacket` (`lib/server/services.ts`, the shortfall branch), `org.feesPaidBy === "org"` is read when reconcile runs. Neither the packet nor the payout records which fee policy was in force when the controller submitted it.
- **Trigger:** a hybrid org with `feesPaidBy: org`. A $500 prize goes through `sponsor.create` and then `sponsor.submit` (controller). The sponsor remits $450.
- **Evidence:**
  - With `feesPaidBy: org`, `sponsor.reconcile {paidMinor: 45000, acceptShortfall: true}` returned 409, "the $50.00 shortfall is still owed to the payee".
  - The organizer then ran `org.update {feesPaidBy: "recipient"}`.
  - The same reconcile then returned 200 "Accepted…". The payout went to `paid` with `destinationNetMinor 45000`, and AP was settled in full against 1100.
- **Impact:** an organizer's policy change after submission shortchanges a payee who was already approved, and the books show the payable as settled. It needs an organizer and a controller to act in sequence, but the controller sees no warning that the policy changed.
- **Small fix:** store `feesPaidBy` on the sponsor packet at `sponsor.create`, and include it in the packet/`termsKey` check at submit. `reconcilePacket` should use the stored value. Optionally, `org.update` could refuse to change `feesPaidBy` while packets are submitted.

### F3 (low, static): sponsor payouts still in `processing` at year end are left out of filings

`generateFilings` selects only `status = 'paid'`, but YTD counts `processing` (`FINAL`). A packet submitted in December and reconciled in January is filed under the reconcile year, while its quote counted it in the submit year. This is consistent with F1 once F1 is fixed. Decide whether the payment date is submission or remittance, and use the same date in both places.

### F4 (low, static): `payout.retry` is unreachable and skips release checks

Nothing ever sets a payout to `failed`: the Stripe webhook returns 501 and the simulated provider never fails. So `retryPayout` (`payouts.ts:479`) is dead code. If a live provider is ever wired up, retry would mark the payout paid without:

- recomputing the quote or YTD, or re-checking the form or budget;
- checking `payoutMethodId` (it checks only the version);
- checking sponsor-packet ownership.

Before enabling it, either route retry through `prepareRelease` or remove the action.

### F5 (low, static): regenerating filings resets them to `draft`

`generateFilings` upserts with `status: "draft"` and replaces `documentId`. No action sets `reviewed` today, so the effect is nil now. It will matter once a "reviewed/signed" step exists, because the scheduled Jan 1 run would silently revert a reviewed filing.

## Checked and holding (no defect found)

- **Self-release:** `prepareRelease` blocks the requester and checks the beneficiary by `personId` or normalized email, before any role logic. The same checks run in the workflow (`assertControllerApproval`, then `releasePayout` with the member's current role and email) and in `awardFulfill`, `sponsorCreate`, `reconcilePacket` and `reviewClaim`. `award.create` refuses self-awards by `personId` or email. Person email can't be changed by `person.update` or by `people.import` upsert. A staff member whose sign-in email differs from their person record and who has no linked `personId` is still undetectable; that is a known limit of the design.
- **Concurrency:** every dispatcher action takes the org `NO KEY UPDATE` lock first (`runAuthorizedAction`), and so do agent operations and workflow approval. Release recomputes the quote under the person lock, and a changed quote returns `requoted` with `releasedBy` cleared. Batches pin each payout's `termsKey`, and the workflow pins the full fingerprint.
- **Initial enrollment:** applies only to an attendee acting on their own record, from the portal, with no active, superseded or verified history. The history is read `FOR UPDATE` under the person lock. An abandoned staff-entered pending method is rejected; it does not strand the person. The new method is activated and the payouts are re-quoted, not released. Residual risk, as known: whoever holds the attendee session for a person with no history can set the account without any out-of-band check. Combined with the known unverified-email pre-registration, that is an account-takeover path for a first payout. Consider requiring email verification before `payout.enroll`.
- **In-kind fulfillment:** controller only, not the creator and not the recipient. The tax hold blocks it. Gross-up reconciles to FMV. The journal is Dr 5100 gross / Cr 1000 FMV / Cr 2100 withholding, and it balances. The in-kind row counts toward YTD and filings, and siblings are re-quoted.
- **Sponsor:** a packet owns its payout (direct release is refused), submit runs `prepareRelease`, a re-quote deletes only draft and questioned packets, and the accrual posts at submit with settlement against 1100.
- **Org-booked flights:** the claim is never paid to the attendee, and the agent never approves it.

## Not verified

- I did not re-run the root's 200-test suite or the HTTP/durable workflow run; I relied on the root's report.
- I did not load-test concurrent releases; I verified the lock order by reading the code.
- I did not run the UI.
- CAD, CA rules, rule-resolution holds, citizen classification, tax identity invalidation, scoreboard false positives and event-relative flights are owned by other workers. I did not re-file them.
