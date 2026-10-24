# Financial review, round 3

Reviewed commit: `81c4d73` (root `main`, 2026-10-24, "R2: payment-year tax, packet fee bearer, retry re-quotes, superseded profiles"). The review started on `6b50185`; when 81c4d73 landed I fast-forwarded the review branch to it, and every repro below ran on 81c4d73. I only reviewed. I did not edit any product code.

**Verdict:** no high or medium findings. The R2 fixes for F1 (payment year), F2 (fee bearer captured on the packet) and F4 (retry re-quotes) hold under real-Postgres repros, including cases the root's own regressions don't cover. Two low findings remain, both in the Canadian (CRA) threshold handling. Both affect only unverified draft output and labels.

## Method

- **Read:** the 81c4d73 diff in full; `lib/server/payouts.ts` (`taxFor`/`baseTax`, `loadSource`, `loadPayoutContext`, `requote`, `retryPayout`); `lib/server/filings.ts` and `filing-currency.ts`; `lib/server/scoreboard.ts`; `awardFulfill`, `resolveRule`, `sponsorSubmit`, `reconcilePacket` and `runAuthorizedAction` in `lib/server/services.ts`; `lib/tax/index.ts` and `lib/tax/rules.ts`.
- **Executed:** one throwaway vitest file with 5 repros (A–E) against the shared Postgres, run through `runAuthorizedAction`, which is the path `/api/actions` uses. It used two disposable orgs created by `createTestOrg` (`is_demo`), one US and one switched to CA/CAD, and both were purged with `dropTestOrg`. Only the JS clock was faked (`vi.setSystemTime`) and only in repro A. No money moved outside the simulated provider. I did not touch the shared demo org.
- I also re-ran root's `financial-review`, `filing-currency` and `scoreboard-view` DB suites and `engines.test.ts` on 81c4d73 (result under "Tests run").

## Repros on 81c4d73 (all passed)

| # | Scenario | Observed |
|---|---|---|
| A | US payee with W-9 and TIN; event 2026-12-28; cash payout **proposed in 2026** under `us-us-prize v2`; clock set to 2027-01-04, then a controller releases it | Release returned 409 "quote changed … No tax rule covers … cash_prize in 2027". The row went to `held`, `ruleId none`, `paidAt` null, `releasedBy` null. A second controller's release was also refused. In-kind `award.fulfill` of a shipped item in 2027 was refused: "No tax rule covers … item_prize in 2027". The org had 0 journal entries. Root's test proposes in 2027; this one proposes in 2026 and releases in 2027. |
| B1 | Fee policy is `recipient` at draft and submit; the organizer then flips it to `org`; the controller accepts a $50 shortfall | Accepted under the packet's stored `recipient` terms. Ledger: debits 100000 = credits 100000. This is the reverse of root's direction, and the result is correct. |
| B2 | Draft under `org`, flip to `recipient` before submit | `sponsor.submit` returned 409, the packet row was **deleted** (0 rows; `ok:false` commits in `runAuthorizedAction`) and the payout stayed `proposed`. A direct release was then re-quoted, because the fee bearer changes the quote. A new `sponsor.create` and `sponsor.submit` succeeded. The draft does not get stuck. |
| C | Payout set to `failed`, then a pending bank change; `payout.retry` | A controller who is the recipient got 403. A different controller's retry re-quoted it to `frozen` with `releasedBy` null, and a release was then refused. |
| D | CAD org, CA payee with a valid residency declaration | CAD 500.00 converts to US$364.38, and the CRA threshold converts at the same rate. The quote is `reportable: true`. After a controller resolves the rule and a second controller releases, `filings.generate` drafts a T4A for CAD 500.00 exactly (see L1). CAD 499.99 is not reportable. A controller matched to the recipient by email only (no `personId`) got 403 on `resolveRule`. After a valid `resolveRule`, a name change superseded the profile, the override lapsed, the payout went back to `held` and a release was refused. |
| E | US payout paid, then `person.update` changes country to CA | The old signed profile is `valid` with `supersededAt` set, and a new `review` row exists. Scoreboard `wrongfulPayouts` is 0 both before and after the change. |

## Findings

### L1 (low, reproduced): CRA thresholds are applied as "at least $500"; the documented rule says "more than $500"

- **Code:** `computeTax` (`lib/tax/index.ts`) uses `aggregate >= threshold` for every rule. `generateFilings` (`lib/server/filings.ts`) skips a group only when `g.gross < g.threshold`. The CA rules in `lib/tax/rules.ts` (`ca-ca-prize`, `ca-ca-stipend`, `ca-ca-item-prize`) document CRA's wording: T4A when the year's total "is more than $500".
- **Evidence (repro D):** a CAD 500.00 prize is quoted `reportable: true`, and after release a T4A draft for CAD 500.00 with 0 withholding is generated. Under the documented rule, no slip is required at exactly $500 with no tax deducted.
- **Impact:** the T4A draft is extra and the payout label is wrong, exactly at the boundary. No money is affected. The rule and all CRA output are already unverified drafts. The quote and the generator agree with each other, so this is not a quote/filing mismatch. Root's static concern, that a CAD threshold might be compared with USD books, does **not** reproduce: `loadPayoutContext` converts CA thresholds to USD at the same latest rate as the prize, and CAD 499.99 correctly comes out below the threshold.
- **Smallest fix:** make the comparison strict for CRA "more than" thresholds. Either add a rule field (for example `thresholdExclusive: true` on the `ca-*` rules) that `computeTax` honours, or compare `> threshold` when `payerCountry === "CA"`. In `generateFilings`, skip CAD forms when `g.gross <= g.threshold && g.wh === 0n`. Add a CAD 500.00 / CAD 500.01 regression.

### L2 (low, static, latent): scoreboard threshold cases would mix USD books with CAD T4A amounts

- **Code:** in `computeScoreboard`'s `reportable`/`clean` branch, `paidTotal` sums `payout.grossMinor` (USD books), `threshold` is the raw rule value (CAD for `ca-*` rules) and `filedGross` is the filing's gross (CAD for T4A/NR4). `filedGross === paidTotal` can never hold for a CRA form, and `paidTotal >= threshold` compares USD with CAD.
- **Impact:** none today. The seeded answer keys use only the US 1099 threshold case, so no CA `reportable` key exists. If someone adds a T4A answer key, it will always be scored as missed (or a `clean` key may pass wrongly). This does not affect money or filings.
- **Smallest fix:** for forms where `filingCurrency(form) === "CAD"`, compare the filing's gross against the CAD amounts (original CAD award amounts, as `generateFilings` does), or exclude CRA forms from threshold scoring with an explicit "not evaluated: CAD worksheet" result.

## Checked and holding

- **F1 payment year:** `baseTax`, `awardFulfill` (`ctx.now`), `resolveRule` (`ctx.now`) and the scoreboard (current year) all use the payment year. Proposals are re-quoted at release, so a December proposal released in January re-quotes to `held` (A). With no 2027 rule, both cash and in-kind payments are held, not paid under the 2026 rule.
- **F2 fee bearer:** `sponsor_packet.fees_paid_by` is set at `sponsor.create`, checked against current policy at submit (withdraw on mismatch, and the deletion commits), and used at reconcile in both directions (B1, B2, plus root's org→recipient test). Packets that predate the migration and have a null value are treated as `org`, the conservative choice. The seeded demo org is `org`, and seeded packets go through `sponsorCreate`, so they carry the value. This is a business block, not money corruption: a recipient-policy org with pre-migration drafts must re-draft them.
- **F4 retry:** re-quotes through `loadSource` + `buildPayout` (form, bank, rules, YTD, source blockers), clears `releasedBy`/`paidAt`/`providerRef`, keeps the idempotency key and posts nothing. Requester and recipient checks still apply (C).
- **Controller override:** cannot self-approve (personId or email match, D), cannot clear a missing or invalid form (root test plus D after the name change), and lapses when the profile, amount, payment type or rule version changes (D). It needs a separate release by a controller other than the requester.
- **Profile supersession:** a name, country or citizenship change inserts a `review` copy and stamps `supersededAt` on the old valid row instead of rewriting it, so the scoreboard does not flag a past payment as wrongful (E).
- **CAD books:** award amounts convert to USD books at the latest stored rate, with the rate and source in the reason. The CA threshold is converted at the same rate. T4A uses the original CAD award amount exactly. Budget caps are compared in USD (root's CAD test).

## Not covered / limits

- I did not reproduce F3 (sponsor `processing` across a year end; `paymentsFor` dates a processing payout by `createdAt`, not by submit). It remains the known low item.
- I did not run the UI, the HTTP preview or the durable workflow. I did not run the full 200-plus test suite; root is running the combined suite and the seeded benchmark.
- Only the JS clock was faked in A. DB-default timestamps used real time.
- The pending-bank-change historical scoreboard concern: I did not fabricate any verification timestamps. The scoreboard still treats an unverified, rejected v2 method (`verifiedAt` null) as an open change for any later payment. I did not reproduce this in R3, and the root asked that it stay a disclosed limitation.
- Consciously limited fallbacks I did not re-file: USD functional books, custom draft PDFs, cached FX, mock wire, no email provider, and no real Stripe or QBO.

## Tests run

- `tests/db/zz-r3-review.db.test.ts` (throwaway, deleted, not committed): 5/5 passed on 81c4d73.
- Root suites on 81c4d73 (`tests/db/financial-review.db.test.ts`, `tests/db/filing-currency.db.test.ts`, `tests/db/scoreboard-view.db.test.ts`, `tests/engines.test.ts`): 4 files, 66/66 passed (605 s).

## Cleanup

- Both disposable orgs (`orgtest_*` with labels `r3us` and `r3cad`, plus the orgs from root's suites) were purged by `dropTestOrg` in `afterAll`. A follow-up query (`slug LIKE 'r3us-%' OR 'r3cad-%'`) returned 0 rows.
- I deleted the repro file, and removed the `node_modules` and `.env` symlinks and the `/tmp/r3review` logs. No shared demo data, auth users or global tables were touched.
