# Browser QA final: sponsor settlement at the locked FX rate

Date: 2026-10-24, 13:42 to 13:53 UTC. Tester: test sub-agent. This follows `docs/browser-qa-canada-sponsor.md` and `docs/browser-qa-canada-sponsor-recheck.md`.

## Sources and environment

- **Deployment:** `eve-calhacks-bnzqx9gf8-…vercel.app`, built from 81ae42a. The fixes under test are f47017c/a182c2f (sponsor net, fee and destination at the locked rate), 2ff4f12 (decimal comma rejected) and 81ae42a (overpay prompt, mobile Remitted label).
- **Browser:** the T3 preview reported `available: false`, so I used headless Chromium 1248 through Playwright over CDP, with a fresh profile.
- **Protection bypass:** a new `_vercel_jwt` came from `vercel curl` with `x-vercel-set-bypass-cookie` (307). It was kept in a 0600 jar and never printed.
- **How actions were driven:** every product mutation used real fill, select and click in the UI.
- **Read-only evidence:**
  - `GET /api/app` and `GET /api/export?type=ledger` from the signed-in context.
  - Direct DB reads in the guarded cleanup dry run.
  - Packet PDFs downloaded through the UI's **Packet PDF** button and read with `pdftotext`.
- **Fixture:** retained org `eve-browserqa-ca-mvmegozv` (`org_MaoCyMyg0Y4L3lic`, CA, sponsor mode, fees paid by the recipient). I created two new CAD awards. The two older paid packets and the held Judge stipend were not touched. No other org or shared sample was mutated.
- **Viewports:** 1440×1000 and 390×844.

## Results

P = passed, O = observation. CAD at 1.37151 is checked by hand: 36.44 × 1.37151 = 49.978, 72.88 × 1.37151 = 99.956, 70.00 × 1.37151 = 96.006.

| # | Step (UI) | Result | Evidence |
|---|---|---|---|
| 1 | Organizer, Prizes → Enter a winner: Cash CA$50.00 "R3 full CAD" and Cash CA$100.00 "R3 short CAD" | P | Both proposed and held on unverified `ca-ca-prize` v1. Mock-wire quote: gross US$36.44 / US$72.88, fee −US$25.00, est. CA$15.69 / CA$65.67 at 1.37151000. `qa-ca-r3-01`, `-02` |
| 2 | Controller, Payouts → held → Accept the unverified rule, with a reason → Resolve and re-quote | P | Proposed. Release is replaced by "Create a sponsor packet instead; a controller submits it." Resolving the rule did not release anything or skip controller submission. The ≥10% fee warning still shows. `qa-ca-r3-03-*` |
| 3 | Organizer, Sponsor → Create packet ×2 | P | Drafts `sp_K4k-rWZlLiFNq1HW` (36.44) and `sp_7jn8-H7inD9wsJ2U` (72.88). `qa-ca-r3-04` |
| 4 | Packet PDF (UI download) | P (fixed) | Full: Gross 36.44, Fees 0.00, Net 36.44 USD, **Expected received 49.98 CAD at 1.37151000**. Short: Gross 72.88, Net 72.88, **99.96 CAD**. Both say "estimate, the sponsor's rate may differ" and are marked DRAFT, NOT FOR FILING. |
| 5 | Controller → Authorize and submit to sponsor ×2 | P (fixed) | Payouts are now `sponsor_packet`, processing, fee 0, net = gross, **destinationNet 4998 / 9996** (previously the mock wire's 15.69 / 65.67 stayed). `qa-ca-r3-05-*` |
| 6 | Organizer types `36,44` → Record remittance (390) | P (fixed) | Inline "Enter zero or more with a period for cents (36.44). Commas may group thousands (1,000.00).", `aria-invalid=true`, **no non-GET request**, packet unchanged. The help text also says "Use a period for cents (36.44)." `qa-ca-r3-06-*` |
| 7 | Organizer records `36.44` on the full packet | P | Packet paid, payout paid, award paid. Exactly one journal `je_XaFg03a3N3aGH0It` (Dr 2000 / Cr 1100, 36.44). `qa-ca-r3-07` |
| 8 | 390 Sponsor list | P (fixed) | Every card shows "Requested US$…" and **"Remitted US$…"**. `scrollWidth` = 390, so no overflow. `qa-ca-r3-08` |
| 9 | 390 organizer records `80.00` on the short packet (overpay) | P (fixed) | Exception "over $7.12. Nothing posted". **No Accept button**. The page says: "Ask the sponsor to correct the remittance, then record the corrected total above. An overpayment cannot be accepted as a fee." `qa-ca-r3-09` |
| 10 | Re-record `70.00` (390) | P | Exception "short $2.88. Nothing posted"; the payout stays processing. `qa-ca-r3-10` |
| 11 | Organizer: Accept shortfall | P | Not offered to the organizer at 390, and no non-GET request was sent. |
| 12 | Controller: Accept shortfall → Accept and close with an empty note | P | Packet stays exception, and nothing posts. `qa-ca-r3-11` |
| 13 | Controller: note → Accept and close | P (fixed) | Packet paid, Remitted US$70.00, Difference −US$2.88. The payout is **gross 7288 (unchanged), fee 288, net 7000, destinationNet 9601 at 1.37151000**. The reason ends "About CAD 96.01 at the payout's quoted rate …". The award is paid. One journal `je_amxK1LhGTtrdtsJi` (Dr 2000 / Cr 1100, 72.88). `qa-ca-r3-12` |

### Ledger and DB proof after both settlements

- `/api/export?type=ledger` has 26 rows and 12 entries, with **Dr = Cr = 143749**.
- Each packet has exactly one `packet` journal, both from the export and from a DB `count(distinct id)` grouped by `source_id`: 1 for each of the 4 packets.
- AP 2000 is debited at the full requested amount (36.44 and 72.88), which settles the accrual against 1100. This matches the documented semantics. The ledger keeps gross settlement, and the shortfall shows only as the recipient-borne fee on the payout.
- DB payout rows match the API:
  - `pay_8jbOediWRnveXgwy`: paid, 3644 / 0 / 3644 / 4998.
  - `pay_E51zakcr1B7pZuhH`: paid, 7288 / 288 / 7000 / 9601.
- As instructed, old paid fixtures were not backfilled. `pay_MVIM18Erc9u0Dzig` and `pay_era0XwHH7v4567O8` keep their earlier stale destination values, and they were purged with the org.

### Observations (minor, not blocking)

- **O1:** the PDF "For" cell is clipped mid-word ("… A controll"). The PDF also still says "Tax rule ca-ca-prize v1 (unverified)" after the controller resolved it for this payment. That is accurate, because the rule stays unverified, but the PDF does not mention the per-payment resolution.
- **O2:** after an overpay or shortfall, the inline result uses the green success style with a check mark, even though the packet is an exception (`qa-ca-r3-09`).
- **O3, harness note:** a selector crash during one of my scripted runs repeated the 80.00 → 70.00 pair once before the run shown above. The decision log shows two overpay and two short `sponsor.reconcile` entries, all by QA Organizer CA. None of them posted a journal.

## Console and network

- No page errors, no console errors, no HTTP ≥ 400.
- The only failures were 23 `net::ERR_ABORTED` on `/`, `/api/app` and `/api/demo/session`, interrupted by navigation.

## Not run

- CRA/T4A draft generation and download, because of the deadline.
- Ship-the-item fulfilment, bank-code replay and new accounts. These were out of scope for this round.

## Cleanup (done)

1. **Dry-run guards.** All of these held:
   - The org id and name matched exactly.
   - Exactly 3 auth users matched the exact `eve-browserqa-ca-{org,ctl,att}-mvmegozv@example.test` emails.
   - All 3 org members were those emails.
   - 0 memberships in other orgs.
   - 0 running `agent_run`.
   - 0 in-flight payouts.
2. **Apply, in one transaction:**
   - Flagged that org `is_demo=true` (1 row).
   - Ran `purgeOrg(tx, orgId, { deleteOrg: true })`.
   - Deleted the 3 exact auth user ids (3 rows).
3. **Extra synthetic user.** A follow-up query found the documented synthetic "wrong-email" account `eve-browserqa-ca-wrong-mvmegozv@example.test`. It had no membership, owner row or session. I deleted it by exact id and email (1 row).
4. **Verified zero rows:**
   - For the org: organization (by id or name), org_member, person, award, payout, sponsor_packet, journal_entry, decision_log, agent_run, tax_profile, payout_method.
   - `auth_user` matching `eve-browserqa-ca-%mvmegozv@example.test` or the ids, their sessions, and their memberships anywhere.
5. **Local cleanup:**
   - The headless browser was stopped.
   - The cookie jar, the browser profile and `/tmp/eve-bqa-ca/secrets.json` were deleted after cleanup was confirmed.
   - The temporary cleanup scripts were removed.
   - No dormant tax reminders or unrelated jobs were touched.

Nothing in this round moved real money. All settlement, quotes and routing are simulated.
