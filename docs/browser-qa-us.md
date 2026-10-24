# Browser QA: US real account, end to end

- Date: 2026-10-24, 12:53–13:17 UTC. Tester: QA sub-agent (US slice).
- Targets, both reached with Vercel protection on through a private `_vercel_jwt` bypass cookie (from `vercel curl … x-vercel-set-bypass-cookie:true`; it was never printed and was deleted afterwards):
  - **A**: https://eve-calhacks-hj2fnowlg-badbird5907s-projects.vercel.app, source `da167e0`. Signup through the 2026 filing PDF.
  - **B**: https://eve-calhacks-ovu33bdeg-badbird5907s-projects.vercel.app, source `b28f559` (root fix for no-TIN W-9). W-9 recheck, sign-in, award 3, bank replacement, sign-out, mobile captures.
  - Both previews use the same database. The fixture created on A kept working on B after a fresh UI sign-in, because session cookies are per host.
- Browser: Playwright-core headless Chromium (`chrome-headless-shell` 1248). The T3 collaborative preview had no tab and only one profile, but this run needs four isolated accounts, so I used one Playwright context per account (organizer, controller, attendee, wrong account) with storage state kept between steps. Every action was a real `fill`/`click`/`dblclick`/`check` on rendered controls. `page.request` and DB reads were used only for evidence. Two deliberate exceptions are labeled **[API deviation]** below.
- Viewports: 1440×1000 for organizer and controller, 390×844 (mobile, touch, DPR 2) for attendee, plus organizer and controller key screens.
- Data: one real (non-demo) US org, `Eve BrowserQA <tag> Org`, `direct`, USD, event 2025-12-28 → 2025-12-29, and four synthetic `eve-browserqa-<tag>-{org,ctl,att,wrong}@example.test` accounts with random 24-character passwords kept private. Money is simulated (`mock_wire`, truth `Simulated`). The shared demo was not touched, and Run Eve was never pressed.

## Result

The US journey passes end to end in the browser, with one blocker found and fixed during the run:

- **F1, fixed in B.** The portal could not sign a W-9 without a TIN, so the PRD's backup-withholding path was unreachable from the UI. Root confirmed and fixed it in `b28f559`; I rechecked it on B entirely through the UI.
- Four lower findings (F2–F5) are below; root has fixes in flight for F2–F4. I did not run the expense claim (root covered receipt OCR).

## Steps

Status: P = passed, F = failed or finding, N = not run.

| # | Preview / viewport | Step (UI) | Assertion and evidence | Status |
| --- | --- | --- | --- | --- |
| 1 | A 1440 | Sign up at /login with a 10-character password | Inline "Use at least 12 characters." No request was sent. `qa-us-signup-short-password-1440` | P |
| 2 | A 1440 | Sign up with a valid password | Redirects to /onboarding, "You (Quinn Organizer) become its first organizer." `qa-us-onboarding-1440` | P |
| 3 | A 1440 | Onboarding: US, Direct, event 2025-12-28/29, check-in 2025-12-30 | "Check-in must fall within the event." and still on /onboarding. `qa-us-onboarding-checkin-error-1440` | P |
| 4 | A 1440 | Fix check-in, Create organization | Lands on /. `/api/app` shows own org, `demo: false`, US, direct, 0 people, 4 budget lines. Past event accepted. `qa-us-org-inbox-empty-1440` | P |
| 5 | A 1440 | Budget → Prizes → Change cap 10000.00 → Save cap | API Prizes `capMinor` 1000000 | P |
| 6 | A 1440 | Event setup → Import: paste one adult US row | "1 person ready." → "Imported 1 people." API: 1 person, `adult: true`, US. `qa-us-import-done-1440` | P |
| 7 | A 1440 | Settings → Invite staff (controller) → Create invite link | Copy link shown once. Copy says it is not emailed, single use, invited email only, expires in 7 days. `qa-us-controller-invite-link-1440` | P |
| 8 | A 1440 | People → Avery → Invite to portal | Copy link shown. `qa-us-attendee-invite-link-1440` | P |
| 9 | A 1440, wrong context | Open controller link, sign up as the wrong account, Join | Masked `e•••@example.test`. "You are signed in with a different email than the one invited…" (403). Wrong account `/api/app` → 403 `setup_required`. "Use a different account" returns to the signup form. `qa-us-invite-email-mismatch-1440` | P |
| 10 | A 1440, controller context | Sign up on the link, Join as controller | Lands on /, role `controller`, same org. Reopening the used link shows "This invitation was already used…". `qa-us-controller-joined-1440` | P |
| 11 | A 390, attendee context | Sign up on the attendee link, Join | /portal, role `attendee`, linked to the imported person, sees 1 person (self). Portal lists "Sign your W-9" and "Add a payout account". `qa-us-attendee-invite-390`, `qa-us-attendee-portal-390` | P |
| 12 | A 390 | Profile: save mailing address | "Profile updated." | P |
| 13 | A 390 | W-9: SSN empty, wrong signature, no certify → Sign W-9 | Three inline errors | P |
| 14 | A 390 | W-9: SSN empty, exact signature, certified → Sign W-9 | **Blocked:** "A W-9 needs your SSN or ITIN." `taxStatus` stays `missing`. `qa-us-w9-no-tin-blocked-390`. Reported to root (F1). | F (fixed in B) |
| 14a | A 390 | **[API deviation]** `tax.submit` W-9 without `tin`, sent as `fetch` from the attendee's own page (same payload as the UI, minus the client check) | 200 "W-9 saved." Portal shows W-9 Valid. API `taxLast4` null. `qa-us-w9-valid-no-tin-390` | P (deviation) |
| 15 | A 390 | Payouts: account "12" → Add account | "Enter the last four digits of the account." | P |
| 16 | A 390 | Account 6789, USD → Add account | "Payout account ••6789 added (simulated provider). 0 unpaid payout(s) re-quoted…" API last4 6789, USD. `qa-us-bank-enrolled-390` | P |
| 17 | A 1440 | Prizes → Enter a winner → Save with an empty form | Four inline errors (winner, track, prize, value) | P |
| 18 | A 1440 | Cash, $1,500.00 → **double-click** Save winner | Exactly 1 award. Sheet closes, row `Ready`. Agent proposal appears 5.6 s later without Run Eve: `requestedBy: agent`, gross 150000, withholding 0, net 150000, fee 2500 (org), `us-us-prize` v2. Reason: "No TIN on file; backup withholding (us-us-backup) starts once the 1099-MISC total reaches the threshold… Below the 1099-MISC box 3 threshold for 2026 so far." `qa-us-award1-saved-1440`, `qa-us-org-payouts-proposed1-1440` | P |
| 19 | A 1440 / 390 | Organizer /payouts; attendee /portal/payouts | Organizer: Release is disabled with "Only a controller releases money." Attendee: no Release control. **[API deviation, role check]** `payout.release` from each session → 403 "Only a controller can release money." `qa-us-attendee-payouts-proposed-390` | P |
| 20 | A 1440 | Controller: select the Avery row → **double-click** "Release 1 payout" | `paid` 6.4 s later: `mock_wire`, Simulated, released by the controller. A session replay returns 200 "These payouts have already completed." Release is disabled afterwards. `qa-us-ctl-release-selected1-1440`, `qa-us-ctl-payout1-paid-1440` | P |
| 21 | A 1440 | Second cash award, $1,500.00 | Agent proposal 5.6 s later: **withholding $360.00, net $1,140.00**. Reason cites "backup withholding applies at 24% (us-us-backup v1)… Reportable on 1099-MISC box 3." UI row: $1,500.00 / −$360.00 / $1,140.00. `qa-us-org-payouts-proposed2-1440` | P |
| 22 | A 1440 | Role blocks repeated, controller releases payout 2 | Organizer and attendee 403. Paid 6.4 s later: wh 36000, net 114000. Replay 200 already completed. `qa-us-ctl-payout2-paid-1440` | P |
| 23 | A 1440 | Controller Filings → **double-click** "Generate 2026 drafts" (repeated 6× in total across reruns) | "Drafted 1 filing(s) for 2026." The table always has exactly 1 row: 1099-MISC · 2026, Draft, $3,000.00, $360.00. `qa-us-filings-1099misc-1440` | P |
| 24 | A 1440 | Click "1099-MISC draft" | Opens a new tab. The link returns 200 `application/pdf`, `%PDF-`, 2,249 bytes. `pdftotext`: "Form 1099-MISC worksheet, tax year 2026", box 3 `3000.00 USD`, "Federal income tax withheld 360.00 USD", two 1500.00 payout lines with `us-us-prize v2` | P |
| 25 | A | Filings role scope | The organizer can see and use Generate (200), matching ACTIONS.md (`filings.generate`: organizer, controller). The attendee has no control, and `filings.generate` returns 403. The attendee can download their own filing document (200), matching ACTIONS.md ("attendees only their own documents"). | P |
| 26 | B 390 | /login: bad email + short password, then wrong password | Inline email and 12-character errors. "That email and password do not match an account." (401). `qa-us-b28f559-wrong-password-390` | P |
| 27 | B 390 | Sign in with the right password | /portal, role attendee, same org. Identity persisted across previews. | P |
| 28 | B 390 | W-9 recheck: blank submit | "Enter your SSN or ITIN, or choose TIN not provided.", plus signature and certify errors | P |
| 29 | B 390 | TIN "12" | "Tax IDs are 4 to 20 letters, digits, or dashes." | P |
| 30 | B 390 | Clear TIN, check "TIN not provided. Eve applies backup withholding when required.", sign, certify → Sign W-9 | "W-9 saved." Valid, no last4, new signed time. No horizontal overflow. `qa-us-b28f559-w9-tin-not-provided-390`, `qa-us-b28f559-w9-signed-ui-390`. **F1 closed.** | P |
| 31 | B 1440 | Organizer and controller sign in. Third cash award, $100.00 | Agent proposal 8.2 s later: wh 2400, net 7600 (24% backup, YTD over the threshold). `qa-us-award3-saved-1440` | P |
| 32 | B 390 | Attendee: Change account → 4321 | "Bank change recorded. Confirmation through the original contact is pending; affected payouts stay frozen." Payout 3 shows `Frozen`: "Bank details changed from ••6789 to ••4321 via portal…". `qa-us-b28f559-bank-change-pending-390` | P |
| 33 | B 390 | Code "12", then fake "000000" | "Enter the 6-digit code from the original email." then 409 "That code does not match the one issued for e•••@example.test. 4 attempts left." `qa-us-b28f559-bank-fake-code-390` | P |
| 34 | B 390 | Portal Messages | "The confirmation code has not been delivered: email delivery is not configured. Payouts stay frozen…" (honest). No 6-digit run in the payouts DOM, the overview DOM or `/api/app`. Other copy contradicts it (F2). `qa-us-b28f559-portal-bank-notice-390` | P / F2 |
| 35 | B 1440 | Controller /payouts | Nothing releasable. Frozen tab. **[API deviation, role check]** release of the frozen payout → 409 "This payout is frozen and cannot be released." `qa-us-b28f559-ctl-frozen-1440` | P |
| 36 | B 1440 | Organizer: Sign out button | → /login. Anonymous `/api/app` is the labeled sample event (`demo: true`) with no synthetic org content. /payouts shows "Sample data". `qa-us-b28f559-signed-out-1440` | P |
| 37 | B 1440 | Organizer signs back in | Same name, role, org. 3 awards, payouts `frozen, paid, paid`, 1 filing. `qa-us-b28f559-org-inbox-after-signin-1440` | P |
| 38 | B 390 | Organizer inbox and payouts, controller filings | No horizontal overflow, one visible `main` landmark each. `qa-us-b28f559-org-inbox-390`, `-org-payouts-390`, `-ctl-filings-390` | P |
| 39 | — | Expense claim with a synthetic receipt | Not run in this slice because of the timebox. Root reported verifying receipt upload errors, network retry and a real-OCR $38.40 claim on B. | N |

Console and network: 0 `pageerror`s in every context. Every 4xx came from a deliberate negative step: 401 `GET /api/onboarding` while anonymous on an invite page, 401 wrong-password sign-in, 403 wrong-account accept, 403 role-blocked release and filings, 409 fake code and frozen release. No 5xx.

## API and DB readback (before cleanup, read-only)

- Org `is_demo=false`, US, direct, USD, `fees_paid_by=org`.
- Payouts:

  | # | Gross | Withholding | Fee (org) | Net | Status | Rule |
  | --- | --- | --- | --- | --- | --- | --- |
  | 1 | 150000 | 0 | 2500 | 150000 | paid | `us-us-prize` v2 |
  | 2 | 150000 | 36000 | 2500 | 114000 | paid | `us-us-prize` v2 |
  | 3 | 10000 | 2400 | 2500 | 7600 | frozen, `frozen_from` `proposed`, not released | `us-us-prize` v2 |

  All three are `requested_by=agent`, `mock_wire`, Simulated, with an idempotency key set. API values at proposal, after payment and in the DB were identical.
- Approvals: 2, unchanged after double-clicks and replays.
- Journal: 4 entries, each balanced. Award 1 accrual 150000/150000, pay 1 152500/152500, award 2 accrual 150000/150000, pay 2 116500/116500. Account totals: 1000 Cr 269000; 2000 Dr 264000 = Cr 264000; 2100 Cr 36000; 5100 Dr 300000; 5300 Dr 5000. Debits 569000 = credits 569000. 0 orphan lines.
- Filing: 1 row, 2026 1099-MISC, gross 300000, withholding 36000, draft, document present.
- Tax profile: W-9 valid, `tin_last4` null, "No TIN provided; backup withholding may apply." There were two valid rows (the API-deviation sign on A and the UI re-sign on B). Superseded profiles may be kept as history; I did not investigate.
- Payout methods: v1 `active`, verified, no code. v2 `pending_verification`, code sealed in the vault, `verification_sent_to` set, 1 attempt (the fake code; the 2-digit code was stopped on the client).
- Notices: 7, and 0 with a 6-digit run. Agent runs: 3, all `done`, 0 running.

## Findings

| ID | Severity | Where | Finding | State |
| --- | --- | --- | --- | --- |
| F1 | High (blocks a PRD path) | /portal/profile, A | A W-9 without a TIN was refused on the client, so backup withholding (PRD §US) was unreachable from the UI | Fixed in `b28f559`. Rechecked through the UI (steps 28–30). |
| F2 | Low (honesty) | /portal/payouts "Confirm your new account" and the /portal task, B | With email off, the copy says "We sent a 6-digit code to …" and "Enter the code we sent…", while Messages correctly says the code was not delivered | Root fixed it for the next preview. Not rechecked here. |
| F3 | Low | /portal/payouts paid card, A/B | "Released by mem_…" shows a raw internal member id to the attendee | Root adds a "Controller" fallback. Not rechecked. |
| F4 | Low | Inbox header, payouts Due, prizes Due, portal task | Past-event deadlines read "Overdue 7164 h 11 min" (≈298 days) | Root changes to days over 24 h. Not rechecked. |
| F5 | Info, unconfirmed | After UI sign-in /login → / on B | `locator('main')` matched two elements 3 s after the redirect. Later fresh loads had exactly one AX `main`, and screenshots show only the app. Likely a hidden preserved route (Cache Components). Only counts if both are visibly rendered. | Unconfirmed |

## Not covered

- Expense claim with OCR (step 39). Root covered it on B.
- The "both awards first, stale $0 quote re-quoted" path, approval reminders, and controller confirmation of the bank code. The code is never shown, so a real confirm cannot be done without email. Reject change was not clicked.
- Payout 3 was frozen and never released, by design.
- F2–F4 fixes were not rechecked. Root's final independent QA owns that.

## Cleanup (13:15–13:17 UTC)

- Ran from a `git archive` of `b28f559` with the root `node_modules` symlinked; the root working tree was not touched. A dry run first checked the guards, then rolled back:
  - exact org id and name, `is_demo=false`;
  - exactly 4 `auth_user` rows matching `^eve-browserqa-<tag>-(org|ctl|att|wrong)@example\.test$`;
  - 0 other memberships or ownerships;
  - 0 running agent runs, 0 approved or processing payouts.
- Apply ran in one transaction: flagged that one org `is_demo=true` (1 row), `purgeOrg(tx, orgId, { deleteOrg: true })`, then deleted the 4 exact users (4 rows).
- Afterwards there were 0 rows for the org in organization, person, org_member, org_owner, award, payout, approval, journal_entry, ledger_account, agent_run, decision_log, notice, tax_profile, payout_method, vault_secret, document, budget_line, event, org_invitation and filing. There were also 0 users with this run's tag and 0 orphan sessions or accounts. Four other `eve-browserqa-%` users with different tags belong to sibling QA runs and were left alone.
- The temp directory (bypass jars, storage states, the private state file, the PDF, the source archive and the scripts) was deleted. No `.env` copy was made, and no processes were left running.
