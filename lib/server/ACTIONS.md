# Eve server API and action payloads

Source of truth for validation: `lib/server/action-schemas.ts` (Zod, strict objects; unknown keys are rejected). Shared types: `lib/contracts.ts`.

Money in payloads is integer minor units, as a string (`"129900"`) or a safe integer. Dates are ISO strings. **No payload ever carries a role or actor**; authority comes from the session.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/app` | `AppSnapshot` filtered for the session's role. In demo mode with no session, bootstraps the seeded demo org (seeding it on first call) and sets a signed session for **Dana Whitfield (organizer)**. `personas` is non-empty only in demo mode. |
| POST | `/api/actions` | `{ action, payload }` -> `ActionResult` `{ ok, message, data? }`. HTTP 400 invalid payload, 401 no session, 403 forbidden, 409 conflict/state, 200 ok. Successful mutations return `data.snapshot` (fresh `AppSnapshot`) so the UI can replace state without a second request. |
| POST | `/api/demo/session` | `{ personaId }` (an `Actor.id` from `snapshot.personas`). Demo mode only, seeded demo personas only. Sets an httpOnly HMAC-signed cookie; returns `{ ok, actor }`. |
| DELETE | `/api/demo/session` | Clears the demo cookie. |
| POST | `/api/documents` | multipart `file` (+ optional `kind`: `receipt` (default) / `upload`, optional `personId`). PDF/JPEG/PNG/WebP, magic bytes checked, max 8 MB. Returns `{ id, name, url, sha256 }`. Attendees may only upload for themselves. |
| GET | `/api/documents/:id` | Authorized download (attendees only their own documents). |
| GET | `/api/export?type=ledger\|claims\|payouts\|filings` | CSV (formula-injection safe). `type=packet&id=<packetId>` or `type=filing&id=<filingId>` returns the stored PDF. Organizer, controller, auditor only. |
| GET/POST | `/api/auth/*` | Better Auth (email + password) for real users. Real users need an `org_member` row; demo personas never apply. |

## Personas (demo org `blue-hour-demo`)

Dana Whitfield organizer · Ari Novak controller · Mei Tanaka auditor · Priya Raman attendee (Toronto, W-8BEN missing, First Overall MacBook Air) · Jordan Okafor attendee (frozen payout after bank change). Persona ids are stable: `mem_demo_dana`, `mem_demo_ari`, `mem_demo_mei`, `mem_demo_priya`, `mem_demo_jordan`.

## Actions

Who may call each action is enforced on the server (`lib/server/permissions.ts`). "self" = an attendee acting on their own person record.

| Action | Payload | Who | Effect |
| --- | --- | --- | --- |
| `org.update` | any of `{ name, country, mode, agentLimitMinor, organizerLimitMinor, currency, sponsorName, sponsorTurnaroundDays, feesPaidBy, notificationChannel, policyNotes }` | organizer | Updates org policy. |
| `event.update` | any of `{ name, startsAt, endsAt, venue, expectedHeadcount, travelCapMinor, economyOnly, bookingDeadline, checkInAt, closingAt, locked }` | organizer | |
| `budget.update` | `{ id?, name, category?, capMinor, fundingSource }` | organizer | Upsert a budget line (category defaults from name). |
| `people.import` | `{ people: [{ name, email, country, citizenship?, dateOfBirth, address?, role?, payoutCurrency? }] }` | organizer | Upserts by email. Under-18 at event start is stored `adult: false` and blocked from money. |
| `person.update` | `{ id, name?, country?, citizenship?, dateOfBirth?, address?, role?, payoutCurrency? }` | organizer, self | Email (the original contact channel) cannot change. |
| `tax.submit` | `{ personId, form, signature, tin?, treatyCountry?, treatyArticle?, certify: true }` | self, organizer | Stores a new tax profile; TIN vaulted (last 4 only). Signature must match the profile name. W-9 with a non-US address goes to `review`. Generates a DRAFT form PDF. Awards waiting on a form become `ready`; held payouts are re-evaluated. |
| `claim.submit` | `{ type, personId?, merchant?, description?, category?, amountMinor?, currency?, purchasedAt?, travelDate?, cabin?, origin?, nameOnReceipt?, documentId?, idempotencyKey? }` | self, organizer | If `documentId` is set and fields are missing, the receipt is read by `lib/agent/receipt.ts`; `requiresReview` blocks auto-approval. FX to USD on purchase date; runs policy checks; auto-approves only within the agent limit. |
| `claim.review` | `{ id, decision: "approve"\|"reject"\|"needs_info", reason }` | organizer (up to organizer limit), controller | Cannot review a claim you requested. |
| `award.create` | `{ personId \| teamPersonIds, track, title, kind: "cash"\|"item", amountMinor, currency?, dueAt? }` | organizer | Team awards split evenly (needs every member's confirmation). Computes recommendation and nudges about forms/withholding. |
| `award.choose` | `{ id, fulfillment: "ship"\|"local"\|"cash" }` | self, organizer | |
| `award.split` | `{ teamId, splits: [{ personId, bps }] }` (sum 10000) | organizer, team member | Resets confirmations. |
| `award.confirm` | `{ id }` | self | Confirms the team split for your award. |
| `payout.propose` | `{ sourceId, sourceType: "claim"\|"award" }` | organizer, agent | Computes tax + quote; `held` if form missing/invalid, recipient under 18, or bank change pending. One live payout per source. |
| `payout.release` | `{ id }` or `{ ids: [...] }` | controller only | Rejects your own requests and anything the agent cannot release. Requires the payout's bank version to be current and verified. Pays through the simulated provider (labeled `Simulated`), posts accrual + payment journal entries, writes approval + decision. |
| `payout.bankChange` | `{ personId, last4, currency, accountNumber?, requestedVia? }` | self, organizer | Creates a pending method, **freezes** the person's unpaid payouts, sends a 6-digit code to the **original** email on file (simulated notice visible only to that attendee). |
| `payout.verify` | `{ id: personId \| methodId, confirmation: "123456", decision?: "confirm"\|"reject" }` | self, organizer, controller | Correct code from the original channel required (5 attempts, 30 min). Confirm: new method active, payouts re-quoted to `proposed` with the new bank version, prior release void (needs a fresh controller release). Reject: pending method rejected, payouts return to `proposed` on the old account. |
| `payout.retry` | `{ id }` | controller | Re-submits a `failed` payout with the same idempotency key. |
| `sponsor.create` | `{ payoutId }` | organizer | Draft packet PDF for the fiscal sponsor. |
| `sponsor.submit` | `{ id }` | organizer | Due date = now + turnaround. |
| `sponsor.reconcile` | `{ id, paidMinor?, acceptShortfall?, note? }` | organizer, controller | `paidMinor` defaults to the sponsor's recorded remittance. Short pay -> `exception`; `acceptShortfall: true` books the difference as a fee and closes. |
| `period.lock` | `{ period: "YYYY-MM" }` | controller | One-way. |
| `filings.generate` | `{ year? }` | organizer, controller | Draft 1099-MISC / 1099-NEC / 1042-S PDFs from paid payouts and YTD totals. |
| `demo.reset` | `{}` | organizer, controller (demo org only) | Deletes and reseeds only the demo org. |
| `demo.run` | `{}` | organizer, controller (demo org only) | Runs the agent pass and recomputes the scoreboard from actual results. |
| `agent.run` | `{ kind?: "claims"\|"chase"\|"all" }` | organizer, controller | Processes submitted claims; chases missing forms (notices). Logged as an agent run. |
| `flight.search` | `{ origin: "YYZ", date?, personId? }` | any non-auditor | Returns `data.offers` (fixtures; labeled). |
| `flight.request` | `{ offerId, origin, carrier, departAt, amountMinor, currency?, cabin?, personId? }` | self, organizer | Creates an org-booked travel request claim (checked against policy). |

## Service entrypoints (for workflows)

`lib/server/services.ts`:

- `runAuthorizedAction(actor, action, payload)` — the same path `/api/actions` uses (validation, permissions, transitions, decision log).
- `agentActor(orgId)` — the agent's ActorContext (role `agent`, cannot release).
- `processClaim(claimId, actor)` — (re)runs extraction-if-needed + checks for one claim.
- `recordNotice({ orgId, personId?, channel, title, body })`.
- `recordDecision(...)` — append to the decision log.
