# Browser QA recheck: Canadian sponsor remittance and UI fixes

Date: 2026-10-24, 13:26 to 13:40 UTC (browser clock America/Los_Angeles).
Tester: test sub-agent. This follows `docs/browser-qa-canada-sponsor.md`, using the same retained fixture.

## Sources and environment

| Phase | Deployment | Source |
|---|---|---|
| Empty and malformed amount (packet 1) | `eve-calhacks-n2mwot31f-…vercel.app` | 7957d37 (Record remittance, FX and fee disclosure) |
| Everything else | `eve-calhacks-qn8jim8zk-…vercel.app` (final) | dfbf030 (adds role locks, import tab, residency copy, Judge stipend kind) |

- **Browser:** the T3 in-app preview again reported `available: false`, so I used headless Chromium 1248 through Playwright over CDP, with a fresh profile for each deployment.
- **Protection bypass:** a new `_vercel_jwt` cookie came from `vercel curl … x-vercel-set-bypass-cookie:true` (307). It was kept in a 0600 jar and never logged.
- **How actions were driven:** every product mutation used real fill, select and click. Table and card rows were clicked at their coordinates.
- **API use:** `GET /api/app` and `GET /api/export?type=ledger`, from the signed-in context, only to read evidence.
- **Fixture:** retained real org `eve-browserqa-ca-mvmegozv` (`org_MaoCyMyg0Y4L3lic`, Canada, sponsor mode, fees paid by the recipient). Its users are the same synthetic organizer, controller and attendee accounts. No shared sample or other org was touched, and no new accounts were made.
- **Viewports:** 1440×1000 and 390×844.

## Starting state

- Packet `sp_nSzPvKq7e_CdVH4w` was **submitted**: requested US$36.44, remitted 0, payout `pay_MVIM18Erc9u0Dzig` processing via `sponsor_packet`.
- Ledger: 12 rows, balanced at 103665 minor.

## Results

P = passed, F = failed or defect, O = observation.

### Packet 1: Record remittance, malformed input, partial, then full

| # | Step (UI) | Result | Evidence |
|---|---|---|---|
| 1 | Submitted packet shows Record remittance (organizer) | P | Field "Amount remitted (USD)" with help text "Enter the total received … including any earlier partial payment." `qa-ca-r2-01` |
| 2 | Empty → Record remittance | P | Inline "Enter an amount of zero or more, with up to two decimal places.", `aria-invalid`, no request sent. `qa-ca-r2-02` |
| 3 | `abc`, `12.345`, `-5` → Record | P | Same inline error each time, no request sent, packet unchanged. |
| 4 | `1,000` → Record | **F (medium)** | The comma is stripped, so this is accepted as **US$1,000.00**. The packet became an exception: "Sponsor paid $1,000.00 on a $36.44 request (over $963.56). Nothing posted". It is harmless here, but a French-Canadian decimal comma `36,44` would also be read as US$3,644.00. Root is changing the parser to reject malformed grouping and hint at the decimal point. `qa-ca-r2-03`, `qa-ca-r2-04` |
| 5 | The overpay exception offers "Accept shortfall as a fee" | O (minor) | The label is wrong for an overpayment. The server refuses to accept an overpayment, so this is a copy issue only. |
| 6 | Re-record the total as `30.00` | P | Exception "short $6.44", payout stays processing, award stays proposed, no journal. `qa-ca-r2-05` |
| 7 | Re-record the total as `36.44` | P | Packet paid, Remitted US$36.44, payout paid, award paid. Record remittance disappears. **Exactly one** `sponsor-pay` journal (`je_Fuquid6kt1DshLw-`: Dr 2000 / Cr 1100, 36.44). Ledger 14 rows, Dr = Cr = 107309. `qa-ca-r2-06` |

### Packet 2: recipient-fee shortfall accepted by the controller

| # | Step | Result | Evidence |
|---|---|---|---|
| 8 | Organizer → Enter a winner, CA$100 cash "Sponsor track cash R2" | P | Auto-proposed and held on the unverified rule. Shows gross US$72.88, fees −US$25.00, net US$47.88, "Received in CAD est. CA$65.67", "Destination rate 1 USD = 1.37151000 CAD", the simulator explanation (USD books, 2% spread, separate dated rates), and **"Transfer fees consume at least 10% of this payment …"**. `qa-ca-r2-08`, `qa-ca-r2-11` |
| 9 | Controller resolves the rule with a reason | P | Proposed. Release is replaced by "Create a sponsor packet instead". `qa-ca-r2-12` |
| 10 | Controller on Sponsor: Create packet | P (fixed) | `aria-disabled`, "Only an organizer can do this." Clicking it sends no request (previously a raw 403). `qa-ca-r2-13` |
| 11 | Organizer → Create packet; controller → Authorize and submit | P | `sp_L2U8_EcYyszxxitI` draft, then submitted, requested US$72.88. `qa-ca-r2-14`, `qa-ca-r2-15` |
| 12 | 390 Sponsor list | P (fixed) | Each card shows "Requested US$72.88". The right-hand remitted figure (US$0.00) has no "Remitted" label (minor). No overflow. `qa-ca-r2-16` |
| 13 | 390 organizer records `70.00` | P | Exception "short $2.88. Nothing posted", payout processing. Form layout fits at 390 (sheet 0 to 390, no document overflow). The green success-style toast covers the locked accept control until dismissed (minor). `qa-ca-r2-17`, `qa-ca-r2-18` |
| 14 | Organizer: Accept shortfall | P | `aria-disabled`, "Only a controller can do this." Clicking it does nothing. |
| 15 | Controller: Accept shortfall → Accept and close with an empty note | P | Inline "Add a short reason. It is saved to the decision log."; packet stays exception. `qa-ca-r2-19`, `qa-ca-r2-20` |
| 16 | Controller: note → Accept and close | P | Packet paid, Remitted US$70.00, Difference −US$2.88. Reason: "Accepted: sponsor sent $72.88 and the payee received $70.00; $2.88 was deducted in transit, which the recipient bears …" plus the note. Award paid. One `sponsor-pay` journal (`je_UACwMHVRFqiaT2ch`, 72.88). Ledger 18 rows, 8 entries, Dr = Cr = 121885. No double pay. `qa-ca-r2-21`, `qa-ca-r2-22` |

### Confirmed defect: sponsor payout net and destination amounts stay stale

Reported to root, which has delegated the fix. Values below are read from `/api/app`. CAD at 1.37151 is my arithmetic.

| Payout | Stage | fee | net (USD) | destinationNet (CAD) | Expected CAD |
|---|---|---|---|---|---|
| `pay_MVIM18Erc9u0Dzig` (packet 1, full 36.44) | paid | 0 | 36.44 | **15.69** | ≈ 49.98 (36.44 × 1.37151) |
| `pay_era0XwHH7v4567O8` (packet 2) | proposed, mock quote | 25.00 | 47.88 | 65.67 | the quote |
| same | after submit | 0 | 72.88 | **65.67** | ≈ 99.95 |
| same | after controller accepts 70.00 | 0 | **72.88** | **65.67** | ≈ 96.01 (70.00 × 1.37151) |

- **Why:** `sponsorSubmit` clears the fee and sets net to the requested amount, but it keeps the mock wire's `destinationNetMinor`. `reconcilePacket` only rewrites the destination when it is USD.
- **Visible effect:** Payouts → Paid shows "Net received US$36.44 / CA$15.69" on the same row (`qa-ca-r2-10a`).
- **After an accepted shortfall:** the USD net still says 72.88 although the payee received 70.00.
- **Ledger:** the ledger itself is consistent. AP is settled at the requested amount against 1100.

**Observation:** 1100 "Due from sponsor" only ever takes credits in this org, so it sits at −US$109.32. This follows from the documented settlement against 1100 with no modeled funding deposit to the sponsor. It is not filed as a defect.

### Final-preview UI fixes

| # | Check | Result | Evidence |
|---|---|---|---|
| 17 | People → Import people | P (fixed) | `/events/new?tab=import` selects **Attendee import**, and the paste box is visible. `qa-ca-r2-23` |
| 18 | Controller role locks | P (fixed) | No "Enter a winner" on Prizes. The prize sheet shows only Close and View evidence. Create packet is locked with a reason (row 10). `qa-ca-r2-24`, `qa-ca-r2-25` |
| 19 | Residency declaration copy | P (fixed) | "I confirm that my residency information is true, correct, and complete." No perjury wording. `qa-ca-r2-26` |
| 20 | Kind → Judge stipend | P | The options are Physical item, Cash and Judge stipend. Choosing it fills Track and Prize with "Judge stipend", relabels the picker to "Judge", and shows "Paid in cash and reported as a stipend, not a prize." It saves as a cash award; the payout is held on rule `ca-ca-stipend` v1, which is unverified. `qa-ca-r2-27`, `qa-ca-r2-28` |
| 21 | Stipend copy | F (copy, minor) | The award recommendation says "Cash prize: pay out after the tax form …", and the payout reason says "Prize of CAD 40.00 converted …". This contradicts "a stipend, not a prize". |
| 22 | Stipend CA$40 at 390 | P | Net US$4.15 after the US$25 fee (86%), with the ≥10% fee warning visible. No overflow. `qa-ca-r2-29` |

## Console and network

- Both deployments: no page errors, no console errors, no HTTP ≥ 400.
- The client-side amount validation and the locked buttons sent no requests.
- The only failures were `net::ERR_ABORTED` on `/api/demo/session`, `/api/app` and `/`, interrupted by navigation.

## Not run

- CRA/T4A filing draft.
- Ship-the-item fulfilment.
- Bank-change replay.
- Recheck of the destination/net fix: waiting for root's new deploy.

## Fixture and cleanup

Root asked me to **keep** the fixture until the sponsor destination/net fix is deployed and rechecked. Cleanup has not run, and the 0600 credentials file stays.

The fixture now holds:
- two paid sponsor packets;
- one held Judge stipend payout (`awd_elMNMVoyXjl5jlhh`), never released.

Guarded cleanup will run after the recheck. It will match the org name and id and the exact synthetic emails, and check that there are no other memberships, running jobs or processing payouts. The browser profile and cookie jar are removed at the end of this round.

Nothing in this round moved real money. All settlement is simulated.
