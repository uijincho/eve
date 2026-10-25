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
| GET | `/api/slack/install` | Organizer only. Redirects to Slack's consent page with a signed state bound to the organizer and org. |
| GET | `/api/slack/oauth` | Slack's redirect. Must arrive in the same organizer's session; stores the workspace and its sealed bot token, then redirects to `/settings?slack=connected`. |
| POST | `/api/webhooks/slack` | Slack interactivity, the `/eve` command and the Events API. Slack's v0 signature is verified over the raw body first. See [docs/slack.md](../../docs/slack.md). |

## Personas (demo org `blue-hour-demo`)

Dana Whitfield organizer · Ari Novak controller · Mei Tanaka auditor · Priya Raman attendee (Toronto, W-8BEN missing, no project on record, First Overall MacBook Air) · Jordan Okafor attendee (frozen payout after bank change). Persona ids are stable: `mem_demo_dana`, `mem_demo_ari`, `mem_demo_mei`, `mem_demo_priya`, `mem_demo_jordan`.

## Actions

Who may call each action is enforced on the server (`ACTION_ROLES` in `lib/server/core.ts`). "self" = an attendee acting on their own person record.

| Action | Payload | Who | Effect |
| --- | --- | --- | --- |
| `org.update` | any of `{ name, country, mode, agentLimitMinor, organizerLimitMinor, currency, sponsorName, sponsorTurnaroundDays, feesPaidBy, notificationChannel, policyNotes }` | organizer | Updates org policy. |
| `event.update` | any of `{ name, startsAt, endsAt, venue, expectedHeadcount, travelCapMinor, economyOnly, bookingDeadline, checkInAt, closingAt, locked }` | organizer | |
| `budget.update` | `{ id?, name, category?, capMinor, fundingSource }` | organizer | Upsert a budget line (category defaults from name). |
| `people.import` | `{ people: [{ name, email, country, citizenship?, dateOfBirth, address?, role?, payoutCurrency?, projectStatus?, projectUrl? }] }` | organizer | Upserts by email. Under-18 at event start is stored `adult: false` and blocked from money. Optional `projectStatus` (`unknown` \| `submitted` \| `none`) and `projectUrl` set the hackathon project (`projectSource: "csv"`). Omitted, an existing status is left alone. A project URL with no status counts as `submitted`. Each status written is its own decision-log row. |
| `people.markSubmitted` | `{ people: [{ email?, name?, projectUrl? }] }` (each row needs email or name) | organizer | Marks matched people `submitted` (`projectSource: "organizer"`). Email wins; a name matches only when it is unique. Unknown and ambiguous names are reported and skipped. One decision-log row per person. The import screen parses a pasted Devpost or judging export with `parseSubmissionList`. |
| `person.update` | `{ id, name?, country?, citizenship?, dateOfBirth?, address?, role?, payoutCurrency? }` | organizer, self | Email (the original contact channel) cannot change. Project status is not on this payload. |
| `person.setProject` | `{ id, projectStatus: "unknown"\|"submitted"\|"none", projectUrl? }` | organizer | Sets the hackathon project. Attendees cannot call it, including on their own person. `projectUrl: null` clears the link. Logged like any other person change. |
| `tax.submit` | `{ personId, form, signature, tin?, treatyCountry?, treatyArticle?, certify: true }` | self, organizer | Stores a new tax profile; TIN vaulted (last 4 only). Signature must match the profile name. W-9 with a non-US address goes to `review`. Generates a DRAFT form PDF. Awards waiting on a form become `ready`; held payouts are re-evaluated. |
| `claim.submit` | `{ type, personId?, merchant?, description?, category?, amountMinor?, currency?, purchasedAt?, travelDate?, cabin?, origin?, nameOnReceipt?, documentId?, idempotencyKey? }` | self, organizer | If `documentId` is set and fields are missing, the receipt is read by `lib/agent/receipt.ts`; `requiresReview` blocks auto-approval. FX to USD on purchase date; runs policy checks; auto-approves only within the agent limit. |
| `claim.review` | `{ id, decision: "approve"\|"reject"\|"needs_info", reason }` | organizer (up to organizer limit), controller | Cannot review a claim you requested. |
| `claim.explain` | `{ id, explanation }` | self | Answers the agent's question on a fare-flagged claim (`needs_info` with a `fareReview`). Stores the answer, moves the claim to `escalated` for a person, logs the decision. One answer per claim. A fare flag never rejects. |
| `award.create` | `{ personId \| teamPersonIds, track, title, kind: "cash"\|"item", amountMinor, currency?, dueAt? }` | organizer | Team awards split evenly (needs every member's confirmation). Computes recommendation and nudges about forms/withholding. |
| `award.choose` | `{ id, fulfillment: "ship"\|"local"\|"cash" }` | self, organizer | Locked once any payout for the award is live (held, proposed, frozen, in flight, paid) or the item was fulfilled. |
| `award.split` | `{ teamId, splits: [{ personId, bps }] }` (sum 10000) | organizer, team member | Resets confirmations. |
| `award.confirm` | `{ id }` | self | Confirms the team split for your award. Locked once a payout for it is live. `award.split` is likewise rejected while any team member has a live payout. |
| `award.fulfill` | `{ id }` | controller (not the award creator, not the recipient) | Item prize with fulfillment `ship` or `local`. **Simulated**: nothing is shipped or bought. Records the fair market value as reportable non-cash income through an in-kind payout row (`provider: "in_kind"`, `status: "paid"`, `netMinor: 0`), which counts toward same-form YTD and filings. If the rule withholds (30% non-US, US backup withholding), the org pays the tax on top: gross-up so gross - withholding = FMV. Ledger: Dr 5100 gross / Cr 1000 FMV / Cr 2100 withholding. Held (409) for a missing form, an unverified rule, a minor, an unconfirmed split or budget. Response `data`: `{ awardId, payoutId, fmvMinor, grossMinor, withholdingMinor, reportingForm, reportable, truth: "Simulated" }`. |
| `payout.propose` | `{ sourceId, sourceType: "claim"\|"award" }` | organizer, agent | Computes tax + quote; `held` if form missing/invalid, recipient under 18, or bank change pending. One live payout per source. |
| `payout.release` | `{ id }` or `{ ids: [...] }` | controller only | Never the requester, never the recipient (linked person **or** matching email), never the agent. Takes org -> person -> payout locks, rechecks form, bank version, source eligibility (split confirmed, item converted to cash), hacker travel project status, and budget, and **recomputes tax** with finalized same-form YTD. A hacker travel payout is held (409, payout stays proposed) when project status is `none`, or still `unknown` after `event.closingAt`. `submitted`, non-hackers, and expenses are unchanged. The same gate runs for sponsor submission. If the terms changed, the payout is re-quoted to `proposed` and returned unpaid (`ok: false`, `data.requoted`), so a fresh release is required. Batches pin the terms each payout had when the batch started. A release re-quotes the recipient's other unpaid payouts. In `sponsor` mode, or when a sponsor packet exists for the payout, direct release is refused. Pays through the simulated provider (`Simulated`) and posts accrual + payment entries. |
| `payout.bankChange` | `{ personId, last4, currency, accountNumber?, requestedVia? }` | self, organizer | Creates a pending method, **freezes** the person's unpaid payouts, sends a 6-digit code to the **original** email on file (simulated notice visible only to that attendee). |
| `payout.verify` | `{ id: personId \| methodId, confirmation: "123456", decision?: "confirm"\|"reject" }` | self, organizer, controller | Correct code from the original channel required (5 attempts, 30 min). Confirm: new method active, payouts re-quoted to `proposed` with the new bank version, prior release void (needs a fresh controller release). Reject: pending method rejected, payouts return to `proposed` on the old account. |
| `payout.retry` | `{ id }` | controller (not requester or recipient) | Never re-sends old terms: a `failed` payout is re-quoted against the current form, bank, rules, YTD and budget, and returns to `proposed` (or `held`/`frozen`) with `releasedBy` cleared and the idempotency key kept. A fresh `payout.release` is required. |
| `payout.resolveRule` | `{ sourceType: "claim"\|"award", sourceId, use: "default"\|"rule", reason }` (reason 10-500 chars) | controller (not requester or recipient) | Resolves a hold caused **only** by an unverified tax rule, for that one source. `default` applies the verified default rule (for example 30% `us-nonus-prize` instead of the unverified Canada treaty). `rule` accepts the unverified rule as stated; `ruleVerified` stays false. Stored in `tax_rule_override`. The rule table is never changed. The override lapses when the tax form, source amount, payment type or rule version changes. Missing or invalid form, minor, bank and budget holds are never cleared (409). A held payout is re-quoted and still needs a separate `payout.release`. With no payout yet, the next `payout.propose` or `award.fulfill` uses it. Response `data`: `{ overrideId, payoutId, status, ruleId, ruleVersion, ruleVerified, withholdingMinor }`. |
| `sponsor.batchRelease` | `{ payouts: [{ id, quote }] }` | controller only | Reserves 1–200 distinct USD payouts against their displayed quote keys and starts one durable bulk workflow. Preparation creates individual packets and one ZIP without an LLM. The one portal agent uploads and submits only after a full manifest match and fresh release checks. |
| `sponsor.batchRetry` | `{ id: batchId }` | releasing controller | Retries the same batch identity only after a failure before submission authorization. |
| `sponsor.batchCancel` | `{ id: batchId }` | controller only | Cancels and frees reservations before submission authorization. Uncertain or confirmed submissions stay reserved. |
| `sponsor.create` | `{ payoutId }` | organizer (not the recipient) | Requires `sponsor` or `hybrid` mode, a `proposed` payout, a valid tax form and no pending bank change. One packet per payout, and the packet then **owns** the payout: direct release is blocked. A re-quote of the payout deletes a draft or questioned packet. Requested amount = gross - withholding, with no Eve provider fee; the packet PDF's expected received amount is that request converted at the payout's locked quote rate (an estimate). Nothing posts. |
| `sponsor.submit` | `{ id }` | controller only | This is the money release for sponsor-paid payouts. It runs the same checks as `payout.release` (requester, recipient, form, bank, budget, tax recompute). Payout -> `processing` (`provider: "sponsor_packet"`, `releasedBy` = controller). Accrual: Dr expense gross / Cr 2100 withholding / Cr 2000 payable. The payout's fee becomes 0, net the request, and destination net the request at the locked rate (the direct-wire fee quote no longer applies). Due = now + turnaround. |
| `sponsor.reconcile` | `{ id, paidMinor?, acceptShortfall?, note? }` | organizer, controller (not the recipient) | `paidMinor` defaults to the recorded remittance. Equal to the request -> Dr 2000 / Cr 1100 "Due from sponsor" (org funds held by the sponsor), payout and source `paid`. Any difference -> `exception`, **nothing posts**, and the payout stays `processing`. `acceptShortfall: true` needs a controller and a `note`, and is allowed only when `feesPaidBy = "recipient"`: the sponsor sent the request and the difference was deducted in transit, so AP settles in full. The paid payout then records what the payee received: net = remitted amount, fee = shortfall (recipient-borne), destination net = remitted amount at the locked rate, with the rate disclosed in the reason. Gross, withholding and the ledger are unchanged. When the org bears fees the shortfall is still owed to the payee and cannot be accepted. Overpayments cannot be accepted. A paid packet cannot be reconciled again. |
| `period.lock` | `{ period: "YYYY-MM" }` | controller | One-way. |
| `filings.generate` | `{ year? }` | organizer, controller | Draft 1099-MISC / 1099-NEC / 1042-S PDFs from paid payouts and YTD totals. |
| `demo.reset` | `{}` | organizer, controller (demo org only) | Deletes and reseeds only the demo org. |
| `demo.run` | `{}` | organizer, controller (demo org only) | Runs the agent pass and recomputes the scoreboard from actual results. |
| `agent.run` | `{ kind?: "claims"\|"chase"\|"all" }` | organizer, controller | Processes submitted claims; chases missing forms (notices). Logged as an agent run. |
| `flight.search` | `{ origin: "YYZ", date?, personId? }` | any non-auditor | Returns `data.offers` (fixtures; labeled). Each offer carries an `offerToken` to send back with `flight.request`. |
| `flight.request` | `{ offerId, origin, offerToken?, personId?, carrier?, departAt?, amountMinor?, currency?, cabin? }` | self, organizer | Price, carrier, times and cabin come **only** from the server offer: the fixture table (`fx_<ORIGIN>_<n>`) or the HMAC `offerToken` that `flight.search` returned with each offer (30 min TTL). Optional client copies are compared and returned as `data.mismatches`, never used. Unknown or forged offers -> 400; expired -> 409. Stored as a travel claim with category `org_booked_flight` that the agent never approves. Organizer `claim.review` approval records a **Simulated** booking (Dr 5000 / Cr 1000, claim -> `paid`) and never creates an attendee payout. One live request per person; the same offer replays. |

### Slack

Actions taken from Slack run through this same dispatcher as the linked member (`ActorContext.via = "slack"`), and every decision row they write records `facts.via: "slack"`.

| Action | Payload | Who | Effect |
| --- | --- | --- | --- |
| `slack.settings` | `{ onDutyMemberId?: id \| null, backupMemberId?: id \| null }` | organizer | Organizer on duty (must be an organizer) and backup approver (organizer or controller). `null` means every eligible linked person. |
| `slack.linkCode` | `{}` | organizer, controller | Returns `data.code` (`ABCD-EFGH`, 10 minutes, one use) to type as `/eve link CODE`. Only its hash is stored. |
| `slack.unlink` | `{}` | organizer, controller | Unlinks the caller's own Slack account. |
| `slack.disconnect` | `{}` | organizer | Forgets the workspace, its posted cards, queued alerts and every link, and revokes the bot token. |

## Service entrypoints (for workflows)

`lib/server/services.ts`:

- `runAuthorizedAction(actor, action, payload)` — the same path `/api/actions` uses (validation, permissions, transitions, decision log).
- `agentActor(orgId)` — the agent's ActorContext (role `agent`, cannot release).
- `processClaim(claimId, actor)` — (re)runs extraction-if-needed + checks for one claim.
- `recordNotice({ orgId, personId?, channel, title, body })`.
- `recordDecision(...)` — append to the decision log.

## Financial invariants (lib/server/payouts.ts)

- **Lock order** for every money path: `organization` (FOR NO KEY UPDATE, `lockOrgFinance`) -> `org_member` -> `person` -> `payout` -> award/claim -> payout method / sponsor packet. The action dispatcher takes the org lock first.
- **Tax year** is the payment's calendar year (the quote is recomputed at release), never the event's. A year with no effective rule holds; an earlier year's rule is never reused.
- **Books** are USD for every organization (`Organization.booksCurrency`). Amounts entered in another org currency (limits, travel cap, budget caps, prizes, CRA thresholds) are converted at the latest stored rate when compared. The rate and source are recorded.
- **Sponsor fee bearer** is captured on the packet when drafted (`sponsor_packet.fees_paid_by`). A policy change before submission withdraws the draft. Reconciliation uses the packet's value, never the current policy.
- **YTD** for reporting thresholds counts only finalized same-form payments: `processing`, `paid` and in-kind fulfillments. When one becomes final, or the tax form changes, every other unpaid payout for that person is re-quoted. A changed quote clears `releasedBy`, so its approval fingerprint changes.
- **Budget**: claim approval, payout proposal, release and in-kind fulfillment are refused (409 with cap, used and left amounts) when a line would be exceeded. Lines are matched by claim category, or `prizes` for awards. Without a line there is no cap.
- **Self-dealing**: requester and recipient checks run before any role exception. The recipient check matches `actor.personId` or the normalized email of the person record.
