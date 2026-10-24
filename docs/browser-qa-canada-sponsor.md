# Browser QA: Canadian real org, sponsor, physical and flight

Date: 2026-10-24, 12:52 to 13:20 UTC (browser clock America/Los_Angeles, so in-app times read 5:5x AM).
Tester: test sub-agent. Root `main` at a1476b2.

## Sources and environment

| Phase | Deployment | Source |
|---|---|---|
| Signup, onboarding, invites, import, residency, bank, flight request and approval | `eve-calhacks-hj2fnowlg-…vercel.app` | da167e0 |
| Travel cap recheck, cash award, rule resolution, release, physical item, sponsor packet, exports, phone pass | `eve-calhacks-ovu33bdeg-…vercel.app` | b28f559 (root fixes for travel cap, W-9 no-TIN, team confirm) |

Both deployments share one database, so the same fixture carried over after I signed in again on the new host.

- **Browser:** headless Chromium (chrome-headless-shell 1248) through Playwright, attached over CDP to one persistent profile. The T3 in-app preview reported `available: false`, so I used the documented fallback.
- **Protection bypass:** Vercel protection stayed on. A private `_vercel_jwt` bypass cookie came from `vercel curl … x-vercel-set-bypass-cookie:true` (307). I loaded it into the browser context and never logged its value.
- **Viewports:** desktop 1440×1000 and phone 390×844.
- **How actions were driven:** every product action used real browser input: label-targeted `fill`, `selectOption`, `check`, and `click`, with keyboard `Enter` for the flight request. The payout and packet rows needed a mouse click at their coordinates. Playwright's locator click on them never settled, probably because the rows keep re-rendering while the page polls.
- **API use:** `GET /api/app`, made from the signed-in browser context, was used only to read state for evidence. No mutation went through the API.
- **Fixture:** real org `eve-browserqa-ca-mvmegozv` (Canada, CAD, created as Hybrid), event "eve-browserqa-ca Toronto Hack mvmegozv" in Toronto, Nov 20 to 22, 2026. Synthetic accounts are organizer, controller, adult attendee and a "wrong-email" account. There is also one imported minor with no account. All are `eve-browserqa-ca-*-mvmegozv@example.test`, with random passwords held privately. Root asked me to keep the fixture for rechecks on refreshed previews. Guarded cleanup will run after that.

## Results

P = passed, F = failed or defect, N = not run.

### Account, org and staff

| # | Step (UI) | Result | Assertion / evidence |
|---|---|---|---|
| 1 | Sign up organizer on `/login` → Create account | P | Lands on `/onboarding`. One console 403 on `/api/app` before auth (unauthenticated probe from the login page, harmless). |
| 2 | Onboard Canada, Hybrid, fiscal sponsor, Toronto event, cap 600 | P | Inline validation refused a check-in before the event start ("Check-in must fall within the event."), then the org was created and the inbox opened. `qa-ca-01` |
| 3 | Settings → Invite staff (Controller) | P | Copy-link only. Text: "Not emailed … works once, only for the invited email … shown only now." The team list shows "Waiting to accept · expires Oct 31". |
| 4 | Open the controller invite while signed up with a different email, then click Join | P | Refused: "You are signed in with a different email than the one invited." `qa-ca-07`, `qa-ca-08` |
| 5 | Use a different account → create the controller with the invited email → Join | P | Signed in as QA Controller CA · Controller. `qa-ca-09` |
| 6 | Event setup → Attendee import: paste one adult and one minor (DOB 2010-05-01) | P | Preview: "2 people ready, 1 under 18 (will be blocked from money)". Result: "Imported 2 people". `qa-ca-03`, `qa-ca-04` |
| 7 | People → minor detail | P | "Under 18: blocked"; Portal access says "Eve only pays adults"; no invite button. The minor is also absent from the Prizes winner picker. |
| 8 | People → adult → Invite to portal | P | Copy-link only, single-use, for the invited email only. |
| 9 | "Import people" button on People | F (minor) | Goes to `/events/new?tab=import` but the **Basics** tab is selected, not Attendee import. Reported; root is fixing. |
| 10 | Agent feed vs Inbox after import | Observation | The agent feed shows "Escalated 1" (minor blocked), but the Inbox says "Nothing needs you right now" with 0 exceptions. |

### Attendee portal (390 phone for profile and bank)

| # | Step | Result | Assertion / evidence |
|---|---|---|---|
| 11 | Accept the portal invite by signup → Join | P | `/portal` shows "Sign your Residency declaration" and "Add a payout account … in CAD". `qa-ca-10` |
| 12 | Profile → Residency declaration (suggested) with a mismatched signature | P | Refused: "Type your name exactly as on your profile". |
| 13 | Sign with the matching name; no SIN entered | P | "Residency declaration saved." Status Valid. The unverified-rule notice is shown. No overflow at 390. `qa-ca-11` |
| 14 | Attestation copy | F (copy) | A Canadian residency declaration says "I certify under penalties of perjury", which is US W-9 wording. Reported; root is fixing. |
| 15 | Payouts → add account last 4 = 4821, currency CAD (default CAD) | P | Shows "CAD account ••4821" plus a change-freeze warning. `qa-ca-12` |

### Flight (event-relative, Toronto, November 2026)

| # | Step | Result | Assertion / evidence |
|---|---|---|---|
| 16 | Travel → From YVR | P (fixture limit) | "Eve has no simulated fares from YVR. Try YYZ, JFK, SEA, LHR …". |
| 17 | From JFK, depart 2026-11-19 → Suggest flights | P | Three JFK→YYZ economy fares (US$147 to US$175). "Best fit" lands Nov 20 00:45, before the 09:30 check-in. `qa-ca-13` |
| 18 | Travel cap label (da167e0) | **F → fixed** | Showed "Cap US$600.00" for a CAD 600 cap; the engine used US$437.26. Reported. On **b28f559** it reads **"Cap CA$600.00"** at 1440 and 390 with no overflow. `qa-ca-20`, `qa-ca-21` |
| 19 | Request the best fit with the keyboard (focus + Enter) | P | Request created. The portal briefly showed "Needs info / No receipt or e-ticket attached". |
| 20 | Organizer → Claims → open the claim → Approve | P | All checks shown (age 27, travel window, economy, US$159 vs US$437.26 cap, budget). `qa-ca-15` |
| 21 | Does not pay the attendee | P | Claim `org_booked_flight` → status paid, row label **Booked**. `/api/app` has **0 payouts**. Ledger: Dr 5000 Travel / Cr 1000 simulated cash, US$159.00; no AP to the attendee. The portal says "Booked by the organization … Nothing is reimbursed to the attendee." `qa-ca-17` |
| 22 | Claims filter labels | Observation | The approved booking counts under the "Paid" filter while the row says "Booked". |

### CAD cash award, unverified rule, release

| # | Step | Result | Assertion / evidence |
|---|---|---|---|
| 23 | Prizes → Enter a winner: Cash CA$500.00 | P | Row shows CA$500.00, Ready, "CA · Residency declaration valid". |
| 24 | Propose payout while the Prizes budget line is 0 | P (guard) / F (label) | Blocked: "Proposing $364.38 would exceed the Prizes budget … cap CAD 0.00 converted …". The guard is correct, but "$364.38" has no **US$** prefix in a CAD org. |
| 25 | Budget → Prizes → Change cap = 2000 (CAD) | P | "cap set as CA$2,000.00", shown as US$1,457.52 left/of. `qa-ca-23` |
| 26 | Budget copy | Observation | "converted at CAD cap converted at 0.72876000" repeats itself. Entering awards committed US$451.83 over a US$0 cap without warning at entry; the hard block comes only at propose. |
| 27 | Propose again | P | "The payout is held. Rule ca-ca-prize v1 is unverified … Below the T4A threshold". "CA$500.00 as awarded, booked as US$364.38". `qa-ca-24` |
| 28 | Controller → Payouts → Held → open → Resolve with an **empty** reason | P | "Say why in at least 10 characters." |
| 29 | Resolve with a **9-character** reason | P | Same refusal. |
| 30 | "Accept the rule as stated, 0%" + a valid reason → Resolve and re-quote | P | Reason quoted in the record: "for this payment only … the rule itself stays unverified". Status Proposed. `qa-ca-26` |
| 31 | Release payout | P | "Release accepted. Sending through Simulated wire". `/api/app` shows status `paid`, `releasedBy` ≠ `requestedBy`, provider `mock_wire`, truth Simulated. `qa-ca-28`, `qa-ca-29` |
| 32 | Recipient amount | Observation (sent to root) | CA$500 award → **est. CA$499.75 received**. Books leg: CAD→USD at 0.72876 from the seeded 2026-09-01 table (`lib/server/seed.ts:64`). Destination leg: USD→CAD mid 1.3995 from the cached ECB table dated 2026-10-23 (`lib/payouts/fx.ts`), minus the mock-wire 2% spread (`lib/payouts/quote.ts:139-141`), giving 1.37151. The sheet does not show the destination rate, its date or the spread. US$25 fee paid by the org. Root is deciding whether CAD→CAD should skip the conversion and spread. |
| 33 | T4A boundary 500.00 / 500.01 | Partly | CA$500.00 alone → "Below the T4A threshold". After the CA$120 item (cumulative CA$620) → "Reportable on T4A". I did not run the dedicated 500.01 boundary or a Filings T4A draft. |
| 34 | Stipend | N | The winner form offers only Physical item and Cash. I found no stipend entry point in the organizer UI within the timebox. |

### Physical item (controller-only completion)

| # | Step | Result | Assertion / evidence |
|---|---|---|---|
| 35 | Enter a Physical item worth CA$120 | P | Comparison: ship est. CA$89.19, buy local est. CA$124.80, cash equivalent CA$120. Recommends buying locally (duty over 15%, warranty). |
| 36 | Controller clicks "Buy it locally" | F (UX) | The button is enabled for the controller; clicking it returns the raw error **"A controller cannot perform award.choose."** (403). Reported; root is fixing. |
| 37 | Organizer chooses Buy it locally | P | "Fulfilment: Buy it locally". **Confirm bought locally is aria-disabled** with the description "A controller confirms delivery." `qa-ca-30` |
| 38 | Controller → Confirm bought locally | P | The CA→CA item rule is unverified, so the first attempt held it ("Fulfillment held … Reportable on T4A"). Resolved with a required reason, then confirmed. Award `paid`, fulfilment `local`. `qa-ca-31` |
| 39 | Non-cash reporting and ledger | P | Payout `provider: in_kind`, gross US$87.45 (= CA$120 FMV), **net 0, destination net 0**. Text: "Fair market value $87.45 is reportable income." Ledger: Dr 5100 Prize expense / Cr 1000 simulated cash, 87.45. |
| 40 | Item copy | F (labels) | "Estimated shipping plus duty is $65.00 on a $87.45 item … local price is $90.95 in USD" uses bare `$` next to CA$ figures on the same sheet. |

### Sponsor packet (own org settings)

| # | Step | Result | Assertion / evidence |
|---|---|---|---|
| 41 | Settings → Money movement: Sponsor packet, turnaround 10, fees paid by **The recipient** → Save | P | "Organization updated."; `/api/app` shows org mode `sponsor`, fees `recipient`. `qa-ca-32` |
| 42 | New Cash award CA$50 | P | Auto-proposed and held on the unverified rule. Fees −US$25.00 paid by the recipient → **net US$11.44 on a CA$50 prize**, with no warning that the fee takes 69% of the prize. |
| 43 | Controller resolves the rule (reason) | P | "Release payout" is blocked: "QA Simulated Sponsor University pays for this organization. Create a sponsor packet instead". |
| 44 | Controller → Sponsor → Create packet | F (UX) | Enabled button, then the raw error **"A controller cannot perform sponsor.create."** (403). Reported; root is fixing. |
| 45 | Organizer → Create packet | P | Draft packet, Requested US$36.44, Remitted US$0.00, due Nov 3. `qa-ca-34` |
| 46 | Controller → open the packet → download Packet PDF and Request CSV | P | `%PDF-` 2441 B; CSV header `packet_id,payout_id,recipient,country,requested_minor,gross_minor,withholding_minor,fee_minor,net_minor,currency,destination_currency,expected_received_minor,…`. |
| 47 | Authorize and submit to sponsor | P | Status Submitted. Ledger accrual Dr 5100 / Cr 2000 AP 36.44, as `ACTIONS.md` specifies. `qa-ca-35` |
| 48 | Reconcile in full / shortfall with the required reason | **BLOCKED** | For a real org there is **no UI to enter the remitted amount**. A submitted packet shows only Close, Packet PDF and Request CSV. Reconcile controls render only for exception/questioned (`components/app/views/sponsor-view.tsx`). `reconcilePacket` needs `paidMinor` or `remittanceMinor`, and only the demo seed sets the latter. Sent to root as a blocker; root is adding "Record remittance". **Not run:** full reconcile, shortfall + reason, and the fee-mode (org vs recipient) shortfall rule. |
| 49 | Sponsor list at 390 | F (labels) | The phone card shows only "US$0.00" (remitted) and hides the US$36.44 requested. `qa-ca-40` |

### Exports, settings, phone pass

| # | Step | Result | Assertion / evidence |
|---|---|---|---|
| 50 | Settings → Accounting exports, multicurrency off | P | Journal CSV is disabled with the explanation "5 entries are in USD. Turn on multicurrency … or use the native ledger CSV." |
| 51 | Date format DD/MM/YYYY + multicurrency on → Journal CSV, Account mapping CSV, Native ledger CSV | P | All three downloaded through browser download events. Journal: 12 rows in 5 journals, dates `24/10/2026`, currency USD, Dr = Cr = 1036.65. Ledger: 12 rows, debits = credits = 103665 minor. The accounts CSV marks simulated clearing "Do not import into production books." `qa-ca-36` |
| 52 | Budget cap edit, money movement edit, event Basics edit (headcount 150 → 160 at 390) | P | "Event updated."; `/api/app` shows `expectedHeadcount` 160. Only our own org was touched. `qa-ca-42` |
| 53 | 390 phone: Inbox, Payouts, Prizes, Sponsor, Budget, portal Profile/Payouts/Travel | P | No document overflow. `qa-ca-37` to `qa-ca-41` |
| 54 | Books currency | Documented limit | A CAD org keeps USD books (`docs/requirement-coverage.md`, Budgets row). Every page explains this. Not filed as a defect. |

## Console and network

- **Page errors:** none on either deployment.
- **Console errors:** each one matches an expected refusal:
  - 403 on `/api/app` (login page, unauthenticated)
  - 401 on `/api/onboarding` (invite page, signed out)
  - 403 on `/api/invitations/accept` (wrong-email join)
  - 403 ×2 on `/api/actions` (controller `award.choose`, `sponsor.create`)
  - 409 ×2 on `/api/actions` (budget-exceeded propose, and the held item fulfilment)
- **Network:** `net::ERR_ABORTED` entries come from navigations and downloads that interrupted in-flight requests (`/api/app`, `/api/demo/session` prefetch, `/api/export`).

## Reported to root

1. Travel cap label: fixed in b28f559 and rechecked.
2. **Sponsor reconcile has no remittance entry for real orgs (blocker).**
3. Controller sees enabled organizer-only buttons and gets raw action-id errors.
4. Cash FX round trip CA$500 → CA$499.75 (two dated tables plus a 2% spread), with exact sources.
5. Money labels with a bare `$` in a CAD org: budget error and item comparison copy.
6. People "Import people" deep link opens the wrong tab.
7. US perjury wording on the Canadian residency declaration.

## Not run

- Stipend: no UI entry point found.
- Dedicated T4A 500.01 boundary and a Filings draft.
- Sponsor full and shortfall reconciliation: blocked; rerun after root's Record remittance fix.
- Ship-the-item fulfilment.
- Bank-change freeze replay.
- US flows: covered by the root worker.

## Cleanup

The fixture is kept on root's request for refreshed-preview rechecks. Guarded cleanup will match org name, id and the five exact synthetic emails, with no other memberships or jobs. Bypass cookie jars, the browser profile, downloads and the event log have been removed from `/tmp`. Only a 0600 credentials file stays until the recheck and cleanup are done.
