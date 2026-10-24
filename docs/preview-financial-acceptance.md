# Preview financial acceptance (HTTPS, payment-year backup withholding)

- Target: https://eve-calhacks-m14jvqij4-badbird5907s-projects.vercel.app, deployed from source `1e36ec1`, which includes the R2 financial fixes from `81c4d73`. Requests went through `vercel curl` (CLI 60.1.3, automatic protection bypass). Protection stayed on.
- Date: 2026-10-24, 12:06:44–12:08:59 UTC for the HTTP run; cleanup finished at 12:10:34 UTC. Result: **31/31 checks passed** over 34 HTTPS requests, plus a Postgres readback. No stalls, no blockers, nothing escalated to the root.
- Data: one disposable real (non-demo) US organization, `direct` mode, USD, fees paid by the org, and three synthetic `eve-fin-<tag>-{org,ctl,att}@example.com` accounts (organizer, controller, adult attendee). Each account had its own cookie jar (mode 600, temp dir 700). Money is simulated (`mock_wire`, truth `Simulated`). The shared demo was not touched, and Run Eve was never pressed.
- Readback and cleanup used a `git archive` of `1e36ec1` with the root `node_modules` symlinked in, so the schema matched the deployment. They read the database URL from the root `.env` without printing it.

## Scenario

The event started on **2025-12-28** and the clock read 2026-10-24, so payments fall in 2026. Under F1 (R2), tax was keyed to the event year. After the fix it must use the payment year: `us-us-prize` v2 with the $2,000 1099-MISC threshold, and `us-us-backup` at 24% for a W-9 signed without a TIN. The original onboarding validation accepted the past event, so no `event.update` was needed and no SQL fixture was used.

Two $1,500 cash awards were made one after the other. The second was created only after the first was `paid`, so its quote already included the first payment and no stale-quote path came up.

## Steps and results

| Step | Check | Result |
| --- | --- | --- |
| Accounts | Sign up organizer, controller, attendee | 200 ×3 |
| Org | `POST /api/onboarding/organization`: US, USD, direct, event 2025-12-28 to 2025-12-29, Prizes $10,000 | 201, `created: true` |
| Controller | Copy-link invite (`delivery.sent: false`), accepted by the matching account | 201 / 200, role `controller` |
| Winner | `people.import` of one adult US person | 200 |
| Attendee | Attendee invite, accepted by the matching account and linked to the person | 201 / 200 |
| W-9 | Attendee `tax.submit`: W-9, typed signature, **no `tin`**, `certify: true` | 200, `taxStatus: valid`, `taxLast4` null; DB reason "No TIN provided; backup withholding may apply." |
| Bank | Attendee first `payout.bankChange` (simulated enrollment) | 200, `enrolled: true`; no account number in the response |
| Snapshot | Organizer `/api/app` | 200, own org, not demo, 1 person |
| Award 1 | Organizer `award.create`, cash $1,500.00 | 200 |
| Autonomous proposal 1 | Organizer `/api/app` poll | `proposed` 11.4 s after the award, `requestedBy: agent`, `releasedBy` null, `us-us-prize` v2 verified, withholding $0. Reason: "No TIN on file; backup withholding (us-us-backup) starts once the 1099-MISC total reaches the threshold … Below the 1099-MISC box 3 threshold for 2026 so far." |
| Separation of duties | Organizer `payout.release` | 403 "Only a controller can release money." |
| | Attendee (the recipient) `payout.release` | 403 |
| Release 1 | Controller `payout.release` | 202 "Controller approval recorded for 1 payout. Release checks are running." |
| Settlement 1 | Controller `/api/app` poll | `paid` 12.0 s after the 202; gross $1,500, withholding $0, net $1,500 |
| Award 2 | Organizer `award.create`, cash $1,500.00, after payout 1 was `paid` | 200 |
| Autonomous proposal 2 | Organizer `/api/app` poll | `proposed` 10.2 s after the award, by the agent, `us-us-prize` v2, **withholding $360.00, net $1,140.00**. Reason: "No TIN on file and the 1099-MISC total reaches the threshold, so backup withholding applies at 24% (us-us-backup v1) … Reportable on 1099-MISC box 3." |
| Release 2 | Controller `payout.release` | 202 |
| Settlement 2 | Controller `/api/app` poll | `paid` 10.0 s after the 202; withholding $360.00, net $1,140.00, the same as the quote |
| Replay | Controller `payout.release {id: p2}` | 200 "These payouts have already completed." |
| | Controller `payout.release {ids: [p1, p2]}` | 200 "These payouts have already completed." |
| Scope | Attendee `/api/app` | 200, exactly 2 payouts (own, both `paid`), `paidYtdMinor` 300000 |
| Filings | Attendee `filings.generate {year: 2026}` | 403 |
| | Controller `filings.generate {year: 2026}` | 200 "Drafted 1 filing(s) for 2026." |
| | Filing in the snapshot | Exactly one: 2026 1099-MISC, gross $3,000.00, withholding $360.00, `draft`, document attached |
| | Controller `GET /api/export?type=filing&id=…` | 200, `application/pdf`, starts with `%PDF-`, 2,278 bytes |
| | Attendee filing export | 403 |
| | Controller regenerates 2026 | 200, still exactly 1 filing |

### Amounts (quoted = persisted = paid)

| Payout | Gross | Withholding | Fee (org) | Net to winner | Rule | Paid at (UTC) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | $1,500.00 | $0.00 | $25.00 | $1,500.00 | `us-us-prize` v2 | 12:07:59.154 |
| 2 | $1,500.00 | $360.00 (24%) | $25.00 | $1,140.00 | `us-us-prize` v2, plus backup `us-us-backup` v1 | 12:08:20.148 |
| Total | $3,000.00 | $360.00 | $50.00 | $2,640.00 | | |

Both payouts were quoted, paid and taxed in 2026, the payment year, and the 2026 filing aggregates both. That confirms the F1 fix over HTTPS. Before the fix, R2 repro C produced `us-us-prize-2025` v1 with withholding $0 on both payouts.

The payout row keeps `ruleId` `us-us-prize` v2 even when backup withholding applies. The backup rule shows up only in `reason` (`us-us-backup v1`). That is consistent with the amounts, but a reader of the payout row alone would not see which rule set the 24%.

## Background workflow evidence

A 202 alone did not count as a pass. Each payout reached `paid` on a later poll, and Postgres showed the following:

- `agent_run`: two `awards` runs, both triggered by `Eve (agent)`, both `done`: 12:07:42.2 → 12:07:45.9 and 12:08:09.0 → 12:08:12.6. Each reports "proposed 1 prize payout(s) … 1 payout(s) await controller approval." They started from the `award.create` follow-up, not from Run Eve.
- Decision log, for each payout in order: `agent:computeWithholding+quotePayouts:payout.propose`, `agent:waitForController:Controller release requested`, `controller:queueControllerRelease:Controller approval submitted`, `controller:executePayout:payout.release`, `controller:executePayout:Controller hook resumed`. Two `controller:draftFilings:filings.generate` entries follow.
- Before cleanup: 0 `running` agent runs and 0 payouts in `approved` or `processing`.

## Postgres readback (before cleanup)

- Org `is_demo=false`, US, direct, USD, `fees_paid_by=org`. Event `starts_at` 2025-12-28T16:00Z.
- 2 payouts, both `paid`, `requested_by=agent`, released by the invited controller's member id, idempotency key set. Amounts matched the table above exactly.
- 2 approvals, both `payout` with approver role `controller`. Still 2 after the replays.
- **4 journal entries, all balanced** (debits = credits), still 4 after the replays:
  - Accrue award 1: Dr 5100 $1,500.00 / Cr 2000 $1,500.00
  - Pay 1: Dr 2000 $1,500.00, Dr 5300 $25.00 / Cr 1000 $1,500.00, Cr 1000 $25.00 (total $1,525.00)
  - Accrue award 2: Dr 5100 $1,500.00 / Cr 2000 $1,140.00, Cr 2100 $360.00
  - Pay 2: Dr 2000 $1,140.00, Dr 5300 $25.00 / Cr 1000 $1,140.00, Cr 1000 $25.00 (total $1,165.00)
- Account totals: 1000 cash Cr $2,690.00 (net $2,640 + fees $50); 2000 payable Dr = Cr $2,640.00 (settled to 0); 2100 withholding liability Cr $360.00; 5100 prize expense Dr $3,000.00; 5300 fees Dr $50.00. Debits $3,050.00 equal credits $3,050.00. 0 orphan journal lines.
- Filing: 1 row, 2026 `1099-MISC`, gross 300000, withholding 36000, `draft`, document present.
- Tax profile: W-9 `valid`, "No TIN provided; backup withholding may apply."
- The synthetic account number was in 0 decision summaries, decision facts, notices or payout reasons. No HTTP response carried it.

## Cleanup

Before deleting anything I checked:

- the org id and name matched the run state, and the org was `is_demo=false`;
- the 3 `auth_user` ids matched the run state, and their emails matched `^eve-fin-<tag>-(org|ctl|att)@example.com$`;
- those users had 0 memberships and 0 ownerships in any other org;
- the org had 0 running agent runs and 0 in-flight payouts.

Then, in one transaction, only that org was set `is_demo=true` (1 row) and purged with `purgeOrg(tx, orgId, { deleteOrg: true })`, and the 3 exact `auth_user` ids were deleted (3 rows).

Afterwards there were 0 rows for the org in organization, person, org_member, org_owner, award, payout, approval, journal_entry, ledger_account, agent_run, decision_log, notice, tax_profile, payout_method, vault_secret, document, budget_line, event, org_invitation and filing. There were also 0 auth users, sessions and accounts for those ids, 0 `eve-fin-%@example.com` users and 0 `Synthetic Financial Acceptance %` orgs.

The temp directory was deleted. It held the run state, cookie jars, bodies, the downloaded PDF, the scripts, the source archive and the `node_modules` symlink. No `.env` copy was made, and no servers or processes were left running.

## Limits

- One tax-chase reminder workflow was scheduled when the person was imported, before the W-9 was submitted (`agent:chaseTaxForm`). It sleeps for days on a non-demo org. When it wakes, `advanceTaxChase` finds no organization and returns complete, with no notice sent.
- The PDF check covered status, content type, magic bytes and size. Its text streams are font-encoded, so I did not text-match the box amounts inside the PDF. The amounts were verified in the filing row and the snapshot.
- Sequential awards meant release 2 did not trigger a re-quote. The case where both awards are created up front and a stale $0 quote must be re-quoted to `proposed` and approved again was not exercised over HTTPS. It is covered by the local DB tests from `81c4d73` and by R3.
- F2 (packet fee policy) is sponsor-mode only and was not exercised on this direct-mode org.
- The optional second org (non-US $500 winner, W-8BEN default, $150 withholding, 1042-S) was not run. The brief limited this run to exactly 3 synthetic accounts, and the core path came first.
- I did not pull Vercel runtime logs. Background execution is evidenced by the delayed `paid` state, the `agent_run` rows and the decision log, including both hook resumes.
- Known and disclosed, not refiled: signup does not verify email; the first simulated bank enrollment does not prove ownership; invites are copy-link only; no email provider is configured.
- Readback used the shared database from the root `.env`. The org and rows created over HTTPS appeared there, which confirms it is the database the preview uses.
