# Preview account acceptance (HTTPS)

- Target: https://eve-calhacks-j0ll0xebl-badbird5907s-projects.vercel.app (source `8d8ec80`), reached through `vercel curl` (CLI 60.1.3, automatic protection bypass; protection left on).
- Date: 2026-10-24. Result: **56/56 checks passed**, 47 requests, no blockers.
- Data: one disposable US organization and four synthetic `@example.com` accounts (organizer, controller, wrong account, attendee), each with its own cookie jar. Simulated payouts only. No money moved, no external notifications. The shared 300-person sample was not touched.

## Steps and observed statuses

| Area | Check | Status |
| --- | --- | --- |
| Signup | 11-character password rejected | 400 |
| | 24-character password accepted; `__Secure-` session cookie with Secure and HttpOnly | 200 |
| No org | `/api/app` returns `setup_required`, no actor, no Dana or demo data | 403 |
| | `/api/onboarding` returns `needsSetup: true` with no memberships | 200 |
| Org setup | Check-in outside the event window rejected, `code: invalid` | 400 |
| | Create org: `created: true`; active-org cookie Secure and HttpOnly | 201 |
| | Repeat: `created: false`, same `orgId` | 200 |
| | Organizer snapshot: own org, 0 people, 4 default budgets, `demo` not true | 200 |
| Controller invite | Copy-link invite: `delivery.sent: false` | 201 |
| | Lookup without a session: masked email, `pending` | 200 |
| | Unverified invitee: `pendingInvitations: []`, `pendingInvitationsHidden: true` | 200 |
| | Wrong account accepts: JSON `email_mismatch`; that account still gets `setup_required` | 403 |
| | Matching account accepts: role `controller`; second accept is idempotent | 200 |
| | Controller tries `people.import` and `POST /api/invitations` | 403 |
| Attendee | `people.import` of one adult and one minor | 200 |
| | Attendee invite for the minor: `code: minor` | 409 |
| | Attendee invite for the adult | 201 |
| | Wrong account accepts | 403 |
| | Matching account accepts: role `attendee`, linked to the imported person | 200 |
| | Snapshot: 1 person (self), 0 budgets, 0 packets; no other synthetic emails in the body | 200 |
| | `people.import`, `budget.update` | 403 |
| | Ledger, claims, payouts and filings exports; `GET /api/invitations`; `GET /api/members` | 403 |
| | `payout.bankChange` for another person (the minor) | 403 |
| Bank | First self setup (account number + last4 + USD): `enrolled: true`, `activeMethodId`, no `methodId`, no payout created, no code or account number in the response | 200 |
| | Replacement: `enrolled: false`, pending method, masked `sentTo`; no 6-digit value or account number in the response | 200 |
| | Attendee (1) and organizer (5) notices: no 6-digit code. Delivery status is reported honestly: "The confirmation code has not been delivered: email delivery is not configured" | 200 |
| | Guessed code `000000` from the attendee and from the controller: `ok: false` | 409 |
| Session | Sign out | 200 |
| | Anonymous `/api/app` after sign-out: demo bootstrap (`demo: true`), not the synthetic org | 200 |
| | Sign in with wrong password / correct password | 401 / 200 |
| | Attendee snapshot after sign-in | 200 |

## Database persistence (read-only, before cleanup)

Organization `is_demo=false`, US. Three members: organizer (also `org_owner`), controller, and attendee linked to its person. The wrong account has no membership. Both invitations are accepted, each by the expected user. People: one adult, one minor. Payout methods: v1 `active` ••6789, vaulted, no verification code; v2 `pending_verification` ••4321, vaulted, code sealed, `verification_sent_to` is the original email on file. 0 payouts, 0 agent runs, 3 vault secrets, 5 notices, 8 decisions, 4 budget lines, 1 event. 4 auth users, 4 sessions.

## Cleanup

Only the exact synthetic org was set `is_demo=true` (1 row), then removed with `purgeOrg(tx, orgId, { deleteOrg: true })`. Then the 4 exact `auth_user` ids were deleted, which cascaded their sessions and accounts. Afterwards: 0 rows for that org in every table checked, 0 auth users or sessions, 0 users matching `eve-acc-%@example.com`, 0 orgs named `Synthetic Acceptance %`. Temporary bodies and cookie jars (mode 600), the scripts and the borrowed `node_modules` symlink were removed. No processes left running.

## Not covered

- Winner cash → W-9 → proposal → controller release through Vercel Workflow (optional) was not run. It would start durable workflows on the shared preview, and it did not fit the timebox.
- Known, not refiled: signup does not verify email ownership; initial self-enrollment is simulated and does not prove bank ownership. Behavior matched the documentation.
- Note, not a defect: `payout.verify` allows organizer and controller by design, so staff wrong guesses also count toward the method's attempt limit.
