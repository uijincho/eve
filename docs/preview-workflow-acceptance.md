# Preview workflow acceptance (HTTPS, US cash winner)

- Target: https://eve-calhacks-j0ll0xebl-badbird5907s-projects.vercel.app (source `8d8ec80`), reached through `vercel curl` (CLI 60.1.3, automatic protection bypass; protection left on).
- Date: 2026-10-24, 11:43–11:46 UTC. Result: **21/21 HTTP checks passed**, 21 requests, plus a Postgres readback. No stalls and no blockers.
- Data: one disposable real (non-demo) US organization, `direct` mode, USD, and three synthetic `eve-wf-<tag>-*@example.com` accounts (organizer, controller, attendee), each with its own cookie jar (mode 600, temp dir 700). Money is simulated (`mock_wire`, truth `Simulated`). Nothing was sent to a real person or a financial provider. The shared demo was not touched.
- Readback and cleanup used an archive of `8d8ec80` so the schema matched the deployment.

## Steps and results

| Step | Check | Result |
| --- | --- | --- |
| Accounts | Sign up organizer, controller, attendee | 200 ×3 |
| Org | `POST /api/onboarding/organization`: US, USD, direct, Prizes budget $1,000 | 201, `created: true` |
| Controller | Copy-link invite (`delivery.sent: false`), then accepted by the matching account | 201 / 200, role `controller` |
| Winner | `people.import` of one adult US person | 200, `adult: true` |
| Attendee | Attendee invite, then accepted by the matching account | 201 / 200, role `attendee`, linked to the imported person |
| W-9 | Attendee `tax.submit`: W-9, typed signature, synthetic TIN `999-00-1234`, `certify: true` | 200, `taxStatus: valid`, `taxLast4: 1234`; no full TIN in the response |
| Bank | Attendee first `payout.bankChange` (simulated enrollment) | 200, `enrolled: true`; no account number in the response |
| Award | Organizer `award.create`: cash, $500.00 USD (`50000`) | 200; no payout in the response (the proposal runs in the background) |
| Autonomous proposal | Polled organizer `GET /api/app` without pressing Run Eve | Found on the first poll: `proposed`, `requestedBy: agent`, `releasedBy: null`, rule `us-us-prize` v2 |
| Separation of duties | Organizer `payout.release` | 403 "Only a controller can release money." |
| | Attendee (the recipient) `payout.release` | 403 |
| Release | Controller `payout.release` | 202 "Controller approval recorded for 1 payout. Release checks are running.", 1 queued run |
| Settlement | Polled controller `GET /api/app` | `paid` about 5 s after the 202 |
| Replay | Controller `payout.release` again | 200 "These payouts have already completed." |
| Scope | Attendee snapshot | 200, exactly 1 payout (own, `paid`) |
| PII | Attendee and controller snapshots | No full TIN or account number |

### Amounts (quoted = persisted = paid)

Gross $500.00, withholding $0.00 (W-9 with TIN, below the 2026 1099-MISC threshold, as the payout reason states), fee $25.00 paid by the org (`feesPaidBy: org`), net to the winner $500.00, provider `mock_wire`, truth `Simulated`, provider reference present. The API values at proposal, after payment and in Postgres were identical.

### Background workflow evidence

The 202 alone was not counted as a pass. Settlement was confirmed separately:

- Postgres `agent_run`: kind `awards`, triggered by `Eve (agent)`, 11:43:56.2 → 11:43:59.3 `done`: "proposed 1 prize payout(s) … 1 payout(s) await controller approval." It started from the `award.create` follow-up (response at 11:43:52.8), not from Run Eve.
- Decision log, in order: `agent:computeWithholding+quotePayouts:payout.propose`, `agent:waitForController:Controller release requested`, `controller:queueControllerRelease:Controller approval submitted`, `controller:executePayout:Controller hook resumed`, `controller:executePayout:payout.release`.
- Vercel runtime logs (sanitized; ids and emails redacted): `POST /.well-known/workflow/v1/flow` at 04:43:53.5, 04:43:58.9 and 04:45:12.5 PDT, matching award entry, the review and the hook resume. No warnings or errors from this run. One unrelated earlier line (04:35:36, Better Auth "Invalid password" on sign-in) came before this run, which never called sign-in.

### Postgres readback (before cleanup)

- Org `is_demo=false`, US, direct. 3 members, 1 person, 1 award, 1 payout (`paid`, released by the invited controller, idempotency key set).
- 1 approval: payout, approver role `controller`, the invited controller. Still 1 after the replay.
- 2 journal entries, both balanced, still 2 after the replay:
  - Accrue award: Dr 5100 $500.00 / Cr 2000 $500.00
  - Pay: Dr 2000 $500.00 / Cr 1000 $500.00; Dr 5300 $25.00 / Cr 1000 $25.00
- Tax profile W-9 `valid`, last4 1234, TIN vaulted. Payout method simulated, `active`, ••6789, v1. Vault rows (`tin`, `bank_account`) have no plaintext.
- No raw TIN or account number in payout, agent run, decision, notice or journal rows.
- Notices: the attendee invite (portal, queued; copy link only) and the organizer notice "Payout account added" (simulated). No external delivery.

## Cleanup

The org's name and id were checked against the run state, and all 3 auth users were checked to be this run's `eve-wf-<tag>-` addresses. Then only that org was set `is_demo=true` (1 row), purged with `purgeOrg(tx, orgId, { deleteOrg: true })`, and the 3 exact `auth_user` ids were deleted. Afterwards there were 0 rows for the org in organization, person, org_member, award, payout, approval, journal_entry, journal_line, ledger_account, agent_run, decision_log, notice, tax_profile, payout_method, vault_secret, document, budget_line, event and org_invitation. There were also 0 auth users, sessions and accounts for those ids, 0 `eve-wf-%@example.com` users and 0 `Synthetic Workflow Acceptance %` orgs. The agent run and the approval workflow had both finished before cleanup. If any later timer wakes, it will find no org and exit on its next step. The temp directory (state, jars, bodies and scripts) was deleted.

## Limits

- One US cash path at $500, so the $2,000 filing threshold, backup withholding (W-9 without TIN), non-US 1042-S, bank-change freeze, re-quotes and batch release were not exercised here. Local `scripts/verify-workflow.ts` covers batches and import reminders, but only on localhost.
- Approval reminders (one hour, then daily) and backup-controller escalation were not observed, because the release came within 2 minutes.
- Known and disclosed, not refiled: signup does not verify email; the first enrollment does not prove bank ownership; invites are copy-link only; no email provider is configured.
- Readback used the shared database from the root `.env`, assumed to be the database the preview uses. The org and rows created over HTTPS showed up there, which confirms it.
