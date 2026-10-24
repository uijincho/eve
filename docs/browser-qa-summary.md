# Browser QA follow-up

October 24, 2026. This is the follow-up the owner requested after the overnight implementation. It covers real browser interactions, persisted results and regression tests; it is not a production financial or accessibility certification.

Current application source: **`81ae42a`**, available at the [protected Vercel preview](https://eve-calhacks-bnzqx9gf8-badbird5907s-projects.vercel.app) and [local demo](http://localhost:3000). Later commits contain reports and documentation.

## Evidence

- [US account and payout journey](browser-qa-us.md): real signup, organization setup, staff and attendee invites, form validation, two $1,500 prizes, $360 backup withholding on the second payment, controller release, replay protection, a PDF with the $3,000 / $360 filing amounts, bank replacement freeze, sign-out and sign-in. The initial no-TIN submission used an explicitly documented API deviation; the corrected form was then tested entirely through the UI.
- [Canadian account and sponsor journey](browser-qa-canada-sponsor.md): CAD onboarding, minors blocked from money, residency signature, bank enrollment, event-relative flight booking without an attendee payout, CAD cash award, controller tax-rule resolution, local physical fulfillment, sponsor submission and balanced exports.
- [Team and receipt journey](browser-qa-teams-receipts.md): attendee-scoped team confirmation, receipt size and required-field errors, upload failure/retry, real Claude extraction, human review, duplicate detection, controller settlement and balanced journals. The disposable fixture was provisioned directly, as stated in that report.
- [Routes and accessibility](browser-qa-routes-accessibility.md): 19 routes at 1440, 390 and 320 CSS pixels, 38 axe checks, keyboard navigation, dialog focus, recovery and exports. This report records the older failures; the final verification report supplies their rechecks.

- [Canadian remittance recheck](browser-qa-canada-sponsor-recheck.md): full and shortfall reconciliation, required reasons, controller boundaries, parsing and mobile behavior. It found stale settlement amounts; the subsequent correction recomputes USD net, fees and CAD estimates from the actual remittance.
- [Final sponsor settlement](browser-qa-sponsor-settlement-final.md): new CAD full-payment and shortfall packets pass on `81ae42a`, including PDF amounts, net/fee/destination consistency, one journal per packet, decimal-comma rejection and guarded fixture cleanup.
- [Final route and recovery verification](browser-qa-final-verification.md): setup reflow, contrast, rail copy, login focus, error recovery, role locks and import navigation.
- [Final accessibility addendum](browser-qa-accessibility-final-addendum.md): all four later recommendations pass on `81ae42a`, including 200% text without document overflow, correct link semantics, visible selected phone tabs and forced-color selection.

Browser interactions used headless Chromium after collaborative-preview failures or unavailability. Vercel protection stayed enabled. API and database reads corroborated UI state; deliberate server authorization probes and fixture setup are identified separately in the reports. All money movement, bookings and physical fulfillment were simulated.

## Corrections made during QA

| Area | Correction |
| --- | --- |
| W-9 without a TIN | Explicit “TIN not provided” choice allows the documented backup-withholding path; malformed nonempty IDs are still rejected. |
| Team prize portal | A recipient can confirm their share even though their snapshot correctly hides other team members. |
| Canadian travel cap | Raw organization-currency limits are labeled CAD, rather than USD. |
| Sponsor reconciliation | Submitted and exception packets accept cumulative USD remittance amounts; differences remain open for review and shortfall acceptance remains controller-only. |
| Sponsor settlement amounts | Full payments and accepted shortfalls recompute net, fees and destination estimates at the locked rate; gross and tax stay unchanged. Existing historical packets are not silently backfilled. |
| Financial amount entry | Decimal commas and malformed thousands groups are refused instead of silently multiplying an amount. |
| Roles | Organizer-only controls use the same role boundary as the server; controller review, release and filing functions remain available. |
| Import navigation | The People import link selects the correct Event setup tab, and tab selection survives reload. |
| Stipends | Winner entry includes a discoverable Judge stipend choice using the existing server contract. |
| Canadian certification | Residency declarations use a plain accuracy confirmation; W-9/W-8 wording stays separate. |
| Money explanations | Destination rates, simulated FX spread, USD books, substantial recipient fees and phone packet request amounts are visible. New payout explanations persist quote source/date/spread. |
| Bank notices | Real-account copy no longer claims an email was sent when delivery is unavailable. Codes remain absent from real sessions. |
| Readability | Released-by labels avoid internal member IDs; long-overdue dates use days; the closed-release rail text fits. |
| Accessibility and recovery | Setup reflows on phones, critical badge contrast is increased, enlarged tables scroll by keyboard, invalid login focuses the first field, successful retry restores heading focus, and invalid invites have an exit. |

## Regression checks

The combined suite passed **273 tests in 37 files**, with real Postgres enabled and no skips, on `dfbf030`. The later sponsor correction passed four new real-database regressions and two existing sponsor checks. Final presentation and role changes passed 104 targeted tests; typecheck, lint and the `81ae42a` Vercel build passed. The broad suite was not rerun after the final sponsor correction.

The final sponsor browser recheck on `81ae42a` confirms full payment at US$36.44 / estimated CA$49.98 and an accepted US$70.00 remittance with US$2.88 recipient fee / estimated CA$96.01. Gross and tax are unchanged; each packet has one settlement journal and the ledger balances. The [independent browser report](browser-qa-sponsor-settlement-final.md) records the persisted evidence and cleanup.

## Cleanup and preserved demo

The US, team/receipt and Canadian fixtures were removed after checks of exact identities, ownership and in-flight work. The final Canadian cleanup removed its organization and all four synthetic auth users. A separate root read confirmed **zero `orgtest_` organizations, zero `eve-browserqa-*` organizations and zero `eve-browserqa-*` auth users**; the retained credentials file is gone. Private browser cookies and profiles were removed.

Both the protected preview and the running local demo return HTTP 200 with 300 people, 160 claims, 25 awards and the preserved measured scoreboard: **40/40 caught, zero false positives and zero wrongful payouts**. QA did not reset or modify the shared sample finances.

## Limits

The functional books remain USD. The simulated wire can convert a CAD award into USD and back into CAD, using dated tables and a 2% destination spread; it does not model domestic CAD routing. Existing historical quotes are not assigned invented provenance. The application uses the documented Stripe/Duffel/QuickBooks fallbacks, and filings are custom drafts. Canadian and treaty rules remain unverified where labeled.

Email ownership and real bank ownership are not verified. Invitations are copy-link; bank replacements need configured out-of-band delivery and otherwise remain frozen. Signed-out finance routes intentionally show the labeled sample event when demo mode is enabled; a signed-in account without an organization does not inherit that sample identity.

Two minor presentation observations remain from the final sponsor check: long descriptive text can clip in the packet PDF, and successfully recording an exception uses the green action-result styling even though the packet remains an exception. They do not change amounts or permit settlement. The final round did not repeat CRA/T4A download, shipping or bank-code replay; the reports distinguish earlier database coverage from browser coverage.

This QA does not establish screen-reader certification, real bank settlement, official tax filing, or complete coverage of every workflow permutation. Original reports retain their tested source commits and limitations instead of retroactively claiming the final build was tested there.
