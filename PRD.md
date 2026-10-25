# Eve: PRD

Oct 23, 2026 · @Evan · Eve, event finance agent · Cal Hacks 13.0

## TL;DR

Eve is an autonomous finance agent that runs the money side of an event: travel reimbursements, flight suggestions, expense submission, cash and physical prizes, and the cross-border tax work behind all of it. Organizers set budgets and rules. Attendees submit receipts and claim prizes in a portal. The agent does the rest, and asks a human only when policy says it must.

**Seats it fills:** the travel coordinator who reviews receipts, the AP clerk who pays people, and the tax/compliance person who collects W-9s and W-8BENs and files 1099s and 1042-Ss.

**Why it wins:**

- **Hyphenate** wants autonomy inside a real finance corner, with limited access, a clean audit trail, sources that disagree, and a "moment." Event payouts have all of it: receipts vs. bank charges vs. policy, a university that controls the bank account, and foreign winners who can't legally be paid the way a naive organizer tries to.
- **Microsoft** (Built for the Real World) wants a production-minded agent in finance with clear customer understanding and measurable usefulness. We have a lived customer story and a hard number: TreeHacks took 9 months to pay one prize.
- **Scope rule for the weekend:** every flow exists end to end, but external money movement runs in test mode or behind a mock provider. The tax engine, ledger, agent, and audit trail are real.

## Problem

Paying people at events is a cross-border finance job that organizers run out of spreadsheets and email.

**The TreeHacks story.** Evan won a prize at TreeHacks. The organizers first tried to send the physical prize item, then found they couldn't, for tax reasons, because he's a Canadian citizen. They switched to a wire. Getting the right tax form, the right withholding, and a working international transfer took about 9 months of back and forth. Nobody did anything malicious. The org simply had no system that knew, at the moment he won, that a Canadian winner needs a W-8BEN, a withholding decision, and a cross-border payout rail.

The same failure repeats across every event:

- **Travel reimbursements** stall on missing receipts, receipts in other currencies, and caps nobody checks until after the flight is booked.
- **Prizes** are announced as items ("MacBook Air") without asking whether the item can be shipped to the winner's country, what duty it triggers, or whether its fair market value is reportable income.
- **Tax forms** are collected late or not at all. The 1099-MISC threshold for prizes is now $2,000 per payee for payments made in 2026, so organizers have to track cumulative totals per person, not per payment. Non-US winners need a W-8BEN and default to 30% withholding without a valid treaty claim.
- **Money is controlled by someone else.** Student hackathons usually run through a university or fiscal sponsor, so the team can request a payment but can't send it.
- **Nothing ties together.** Receipts, card charges, approvals, and payouts live in different tools, so year-end filings are rebuilt by hand.

Sources: [1099 threshold, Patriot Software](https://www.patriotsoftware.com/blog/accounting/1099-reporting-threshold/) · [prizes on 1099-MISC box 3, Frankfurt Kurnit](https://advertisinglaw.fkks.com/post/102kyn8/)

## Users and roles

Every role gets the narrowest permissions that let it do its job. The agent is a role too, not a superuser.

| Role | Who | Can do | Cannot do |
| --- | --- | --- | --- |
| Attendee | Hacker, speaker, mentor, judge (18+ only) | Set residency, submit receipts and flights, file tax forms, pick payout method, claim prizes | See anyone else's data, change caps |
| Organizer (finance lead) | Hackathon finance director | Set budgets, caps, prize list, policies; approve escalations below their limit | Approve a payout they requested; edit the ledger directly |
| Controller | Org's treasurer or fiscal sponsor contact | Final approval above threshold, release payment batches, lock periods | Request payouts |
| Fiscal sponsor | University or nonprofit that holds the bank account | Receive payment requests, execute disbursements in their own system | (outside our system; we hand them a packet) |
| Agent | Our autonomous system | Review, classify, compute, propose, auto-approve within policy, chase people, draft filings | Release money above its limit, approve its own proposals, change policy, read raw bank or ID numbers |
| Auditor (read-only) | Judges, the org's accountant | Read every decision and its evidence | Change anything |

**Minors are blocked.** Onboarding requires a date of birth and refuses anyone under 18 at the event start date. Cal Hacks already checks government ID with DOB at check-in, so this matches existing practice.

## Organizer experience

Organizers spend most of their time in one place: an inbox of things only a human can decide. Everything else is setup they do once and a dashboard they glance at.

### Setup (one time per org, about 10 minutes)

A guided wizard at `/setup`. The agent prefills what it can and explains each choice in one line.

1. **Organization:** legal name, country (US or Canada), EIN or business number (vaulted), contact emails.
2. **How money moves:** direct (connect Stripe), sponsor packet (enter the sponsor's name, contact, packet format, turnaround, and rules like "no gift cards"), or hybrid with a dollar split.
3. **People and limits:** invite teammates as organizer, controller, or auditor. Set the agent's auto-approve limit (default $300), the organizer approval limit, and a backup approver for each. The UI blocks giving one person both requester and controller on the same flow.
4. **Accounting:** pick the starter chart of accounts or connect the QuickBooks sandbox and map accounts.
5. **Notifications:** connect the Eve Slack app (Add to Slack, which also picks the team channel such as `#eve-finance`), choose the organizer on duty and a backup approver, and have each organizer and controller link their own Slack account. A Discord webhook remains an option for digests.

### Event setup (per event)

At `/events/new`, organized as tabs the organizer can fill in any order. The agent reviews each tab and leaves warnings inline.

| Tab | What the organizer sets | What the agent adds |
| --- | --- | --- |
| Basics | Name, dates, venue, check-in and closing times, expected headcount | Converts times into travel windows for flight suggestions |
| Travel policy | Caps by origin region, economy only, booking deadline, book-for-them vs reimburse, receipt rules | Flags caps that are below typical fares from common origins |
| Budget | Lines (travel, prizes, food, swag) with amounts and funding source (sponsor, university, cash) | Live spent vs committed vs remaining per line |
| Prizes | Track, prize (cash or item + value), sponsor paying for it, team split rule | Pre-event warnings: items over $2,000, items hard to ship abroad, withholding the org will owe |
| Roles | Judges, mentors, stipends | Tax form needs for each paid role |
| Attendee import | CSV upload or a link attendees use to join | Starts onboarding and tax-form collection automatically |

### Dashboard screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Inbox | `/` | Everything waiting on this person, ranked by urgency, with the live agent feed in a collapsible right rail. Each card: what, why the agent escalated, the evidence, and Approve / Reject / Ask for info buttons |
| Claims | `/claims` | Every travel and expense claim; filters by status, flag type, origin; click through to receipt, extracted fields, and policy result |
| Prizes and winners | `/prizes` | Judges enter winners here; per winner: tax form status, ship/local/cash recommendation, net payout |
| Payouts | `/payouts` | Proposed batches with totals, withholding, and fees; the controller releases a batch here; live status per payout |
| People | `/people` | Every attendee with tax form status, residency, totals paid YTD, outstanding chases |
| Budget | `/budget` | Lines vs actuals, committed spend from approved but unpaid items, forecast to event end |
| Disburse | `/sponsor` | Packets submitted, aging, questioned, paid, and reconciliation exceptions (shown only in sponsor or hybrid mode) |
| Audit trail | `/audit` | Searchable decision log; any number links to its source documents and rules |
| Filings | `/filings` | Year-end packet: forms per person, totals, downloads |
| Agent | `/agent` | Full-page agent activity feed with filters, scoreboard against the answer key, the computer use stream when it runs |
| Settings | `/settings` | Everything from setup, plus rule overrides with a required reason |

**Design rules:** the inbox is the home page; every agent decision shows its evidence one click away; approval buttons are disabled with a reason when segregation of duties blocks the current user; mobile-friendly approvals so a controller can release a batch from their phone during closing ceremony.

### Agent activity feed

The feed shows the agent's work as it happens, so judges and organizers can see Eve acting without a prompt. It lives in the main app in two places, not as a separate page: a right rail on the Inbox (latest runs, collapsible) and the full view at `/agent`.

**Unit of display:** one entry per workflow run on a business object (a receipt, a winner, a payout), never per process or spawned agent. Expanding an entry shows its steps.

| Element | Content |
| --- | --- |
| Counters | Running, Waiting, Done today, Escalated. Waiting = workflows sleeping on a chase schedule or paused on an approval hook |
| Entry header | Object name and person ("Receipt C-2241 · Marcus Lee, YYZ to SFO") + status pill: Running (step n of m), Waiting (next action and time), Escalated, Frozen, Auto-approved, Paid |
| Step line | Timestamp, one plain-language sentence, tool name and rule version in small monospace (`checkPolicy · rule v3`) |
| Step icons | Done, in progress, sent to inbox |
| Filters | All, Running, Waiting, Escalated, Done; search by person or object id |
| Click-through | Any step opens the evidence drawer (source document, extracted fields, rule, model reasoning summary) |

**Behavior:**

- Running entries stay expanded and tick forward live; finished and waiting entries collapse to one line so auto-approvals don't flood the view.
- An escalation in the feed and its card in the Inbox link to each other.
- The computer use run shows here like any other run, with its VNC stream embedded in the expanded entry.

**Build:** the feed is a read-only view over `decision_log`, grouped by workflow run id. Poll every 2 seconds for the demo; upgrade to streaming steps from the workflow with Workflow DevKit's `getWritable()` if time allows. No new tables.

**Demo use:** inbox on the left, feed on the right. Trigger the bank-detail change live; the five steps appear in the feed, then the frozen card lands in the inbox.

### Organizer lifecycle

| When | What organizers do | What Eve does |
| --- | --- | --- |
| 6 to 8 weeks out | Setup, event tabs, import attendees | Onboards attendees, collects tax forms, warns about risky prizes |
| 2 to 6 weeks out | Approve flight bookings and out-of-policy requests | Suggests flights, books on approval, tracks fares, chases missing forms |
| Event weekend | Judges enter winners; controller approves prize batch | Builds payout plans, collects missing W-8BENs on the spot, flags fulfillment issues |
| Week after | Clear the inbox | Processes reimbursement claims, pays approved batches or submits sponsor packets, reconciles |
| Month after | Close the event | Final budget vs actuals, open items list, locks the period |
| January | Controller signs filings | Generates the year-end packet |

## Core flows

Five flows share one onboarding step, so the agent knows who someone is for tax before any money is promised.

### 1. Attendee onboarding (the tax profile)

1. Attendee signs in with the email they registered with.
2. Enters legal name, DOB (under 18 is refused), citizenship, country of tax residency, and mailing address.
3. The agent picks the form: US person gets a **W-9**; non-US individual gets a **W-8BEN** with the treaty article prefilled from their country; someone paid through their own company gets a **W-8BEN-E**.
4. Form is e-signed in the portal. The agent validates it (name matches, country matches address, form not expired; W-8s lapse after the third calendar year) and stores only a token for TIN/SSN fields.
5. Attendee picks a payout method from what's available for their country, with the fee and delivery time shown up front.

### 2. Travel: suggest, book, or reimburse

1. Organizer sets a travel policy: cap by origin region, economy only, booking window, required documents.
2. Attendee enters origin airport and dates. The agent suggests 3 flights under the cap, ranked by price and arrival time vs. check-in (1:30 PM Friday for Cal Hacks) and departure vs. closing ceremony.
3. Two paths:
   1. **Org books directly** (preferred): attendee picks a flight, it goes to the organizer for a one-click buy. No reimbursement, no foreign-currency receipt, no tax question.
   2. **Attendee books, then claims**: attendee uploads the e-ticket and receipt after the trip.
4. The agent checks the receipt against the policy: name on ticket matches the profile, dates fit the event, class is economy, amount is under the cap after FX conversion on the purchase date, and no duplicate claim exists.
5. Within policy and under the auto-approve limit → approved and queued for payout. Anything else → escalated with a one-line reason.

### 3. General expense submission

Same engine as travel claims, for anything else the policy allows (ground transport, baggage, team supplies bought by organizers). Receipt OCR extracts merchant, date, amount, currency, and line items. The agent categorizes it against the org's chart of accounts and budget line.

### 4. Cash prizes

1. Judges enter winners per track. The agent links each winner to their tax profile.
2. For each winner it computes: gross prize, withholding (see Tax engine), payout fee, FX, and net amount received.
3. Missing or invalid tax form → the agent chases the winner (email, Discord/Slack DM) on a schedule and holds payment, rather than defaulting silently.
4. Team prizes split evenly by default; the team can submit a different split, which all members confirm.
5. Payout proposals go to the approval queue as a batch.

### 5. Physical prizes (ship, buy local, or cash)

For each item prize and winner, the agent recommends one of three options and shows why:

| Option | When the agent prefers it | What it checks |
| --- | --- | --- |
| Ship the item | Winner is domestic, or the item ships cleanly to their country | Carrier availability, duty and import tax estimate, battery or export restrictions, delivery time |
| Buy it locally for them | Item is sold in the winner's country at a similar price | Local retail price, delivery through a local retailer, warranty region (e.g. a US Switch vs. a Canadian one) |
| Cash equivalent | Shipping is blocked, slow, or duty plus shipping exceeds a set % of value | Fair market value, the winner's preference, withholding on the cash amount |

Either way, the item's fair market value counts toward the winner's reportable prize total, so a physical prize still needs a tax form. The agent tells organizers this before the event, when they set the prize list, not after someone wins.

### 6. Stretch: unusually expensive flights

Catch a $495 YYZ to SFO claim on a $500 cap when that route usually costs about $300 on the booking date. The agent flags; it never auto-rejects.

**The timing constraint:** market price history is only available for upcoming travel dates, so we capture it before the event, not at claim time.

1. **Snapshot at intake.** When an attendee enters an origin airport, pull Google Flights price insights for their route and event dates (via SerpApi, free tier about 250 searches/month): typical price range, price level, and about 60 days of price history. Store it.
2. **Nightly tracker.** For each origin airport in the event, record the cheapest fare once a day until the event starts. This builds our own history.
3. **Peer baseline (no API).** Compare against other attendees on the same route for the same event. Build this first; it works on seeded data.
4. **At claim time.** OCR the booking date and fare from the receipt, then compare to the stored market price on that date and to the peer distribution.

**Flag rule (tunable):** fare more than 25% above Google's typical high on the booking date, or above the peer 75th percentile; plus a soft "cap-hugging" signal when the claim is within 5% of the cap.

**On a flag:** the agent asks the attendee one question ("This fare was about $180 above typical on your booking date. Anything we should know?") and routes the answer plus evidence to the organizer. Late waitlist acceptance, a nonstop, or a checked bag are valid reasons.

Note: Amadeus's free Flight Price Analysis API is gone (Self-Service shut down July 17, 2026), so don't plan around it. Add one planted cap-hugging claim to the answer key.

Sources: [SerpApi Google Flights price insights](https://serpapi.com/blog/how-to-scrape-google-flights.md) · [Amadeus Self-Service shutdown](https://airlabs.co/amadeus-self-service-api-shutdown)

## Tax and compliance engine

Tax logic lives in a versioned rules table, never in prompts. The LLM decides which facts apply; deterministic code does the arithmetic and cites the rule it used.

**How a rule is stored:** jurisdiction pair (payer country, payee residency), payment type (cash prize, item prize FMV, reimbursement, stipend), required form, withholding rate, reporting form, threshold, effective date range, source URL, and a `verified` flag. Every payout stores the rule version it used, so a decision made in March can be explained in June even after a rule changes.

### Starting rule set

| Payer | Payee | Payment | Form collected | Withholding | Year-end filing |
| --- | --- | --- | --- | --- | --- |
| US org | US person | Cash or item prize | W-9 | None with valid TIN; backup withholding without one | 1099-MISC box 3 when the payee's 2026 total reaches $2,000 |
| US org | US person | Judge or mentor stipend | W-9 | None with valid TIN | 1099-NEC at $2,000 |
| US org | Non-US person | Cash or item prize | W-8BEN (W-8BEN-E for entities) | 30% default; treaty rate if a valid claim applies | 1042-S per payee + annual 1042 |
| US org | Anyone | Substantiated travel reimbursement | Same profile form | None by default | None by default (flag for advisor review) |
| Canadian org | Canadian resident | Prize or stipend | SIN collected as token | None by default | T4A (exact box and threshold to verify) |
| Canadian org | Non-resident | Prize or stipend | Residency declaration | Part XIII or Reg. 105 may apply (to verify) | NR4 (to verify) |

### Things the engine must handle

- **Cumulative thresholds.** Track each payee's running total across all events run by that org in the calendar year. One person can cross $2,000 across a prize plus a stipend. The threshold is indexed for inflation from 2027, so it's a dated rule, not a constant.
- **Treaty claims.** The W-8BEN treaty article and rate are prefilled per country from the rules table. Canada's prize rate is marked unverified until a tax mentor or the Hyphenate team confirms it; until then the demo shows both the 30% default and the claimed rate.
- **State rules.** California may require nonresident withholding on payments for activity in the state. Model it as a state-level rule (to verify) so the demo can show the agent catching a second layer the organizer forgot.
- **Item prizes.** Fair market value counts as income. For a non-US winner, withholding on an item can't be taken out of the item, so the agent proposes the org pays the withholding on top (grossed up) or offers cash instead.
- **FX.** Store every amount in original currency and USD, converted at the rate on the payment date, with the rate source recorded.
- **Year-end packet.** Generate 1099-MISC, 1099-NEC, 1042-S, 1042 summary, T4A and NR4 drafts as PDFs plus a filing-ready export. Real e-filing is out of scope for the weekend; the packet is the deliverable.
- **Nudges to organizers.** When an organizer creates a prize list, the agent flags in advance: "3 of your 11 prizes are items over $2,000 FMV; international winners will need W-8BENs and you'll owe 30% withholding unless you offer cash."

**Disclaimer in product:** the engine prepares and explains; a human controller signs. We say this plainly in the UI and the pitch.

Sources: [1099 thresholds by form, TaxBandits](https://developer.taxbandits.com/docs/Form1099/FilingThresholdsandDeadlines) · [W-8BEN validity and treaty use, Wise](https://wise.com/ca/blog/form-w-8ben-canada) · [30% default without W-8BEN, taxbracketcalc](https://taxbracketcalc.com/tax-planning/form-w-8ben-treaty-rate-calculator/)

## Payouts and fee estimation

We stay provider-agnostic behind one interface, and every payout shows the winner what they'll actually receive before anyone approves it.

### Provider interface

```
interface PayoutProvider {
  supports(country, currency): Capability   // rails, min amount, delivery time
  quote(amount, fromCcy, toCcy, country): Quote // fee, FX rate, spread, net received
  createRecipient(profileToken): RecipientRef
  payout(recipient, quote, idempotencyKey): PayoutRef
  status(payoutRef): PayoutStatus            // pending, paid, failed, returned
}
```

| Provider | Weekend status | Notes |
| --- | --- | --- |
| Stripe Connect | Real, in test mode | Test mode needs no business verification. US platforms can send cross-border payouts to connected accounts in supported countries (Canada included); Global Payouts covers recipient-only accounts. No cross-border instant payouts. |
| Mock wire | Mocked | Simulates SWIFT with a sending fee, an intermediary bank deduction, and a receiving fee, so the demo shows why a $1,000 wire can land as less. |
| Fiscal sponsor packet | Real (PDF/CSV) | For orgs that can't move money themselves; see the fiscal sponsor section. |
| Wise, PayPal, gift cards | Stub only | Same interface, added if time allows. |

### Fee estimation

For each payout the agent builds a quote across every provider that supports the country, then shows:

- Gross amount, withholding, provider fee, FX rate and spread, expected intermediary and receiving fees, **net received**, and delivery time.
- Who bears fees, per org policy: org pays (winner receives the full announced amount) or winner pays.
- A recommendation, e.g. "Stripe to a CAD bank account: about 1 to 3 business days, lowest fees. A USD wire would likely lose an intermediary deduction."

Fee tables are seeded from providers' published pricing and stored as dated rules with a source link, same as tax rules. Estimates are labeled as estimates.

Sources: [Stripe cross-border payouts](https://stripe.com/docs/connect/cross-border-payouts) · [Stripe: pay out to other countries](https://support.stripe.com/questions/pay-out-to-connected-accounts-in-other-countries)

## Autonomous agent

The agent runs on events, not prompts, and can only move money inside limits a human set. Everything it does is a proposal with evidence until policy or a person approves it.

&#91;embedded content: approval flow · auto-approve, organizer review, controller release\]

In-policy claims under the limit skip organizer review, but every payout still waits for a controller release; an organizer can send a claim back for more information.

### Triggers

| Trigger | What the agent does |
| --- | --- |
| Receipt or e-ticket uploaded | OCR, policy check, duplicate check, FX, approve or escalate |
| Flight search requested | Suggest 3 flights under cap, timed to the event schedule |
| Winners entered by judges | Build payout plans, check tax forms, recommend ship/local/cash for items |
| Tax form missing or expiring | Chase on a schedule (day 0, 2, 5, 10), then escalate |
| Prize list created or edited | Pre-event tax and shipping warnings to organizers |
| Approval sits unanswered | Remind, then route to the backup approver (in Slack, a DM with the same buttons) |
| Payout failed or returned | Diagnose (bad bank details, unsupported rail), re-quote, ask the payee to fix |
| Bank details changed close to a payout | Freeze that payout, verify through the original contact channel, log it |
| Calendar: Jan 1 | Assemble the year-end filing packet |

### Permissions (enforced in code, not in the prompt)

- **Auto-approve:** in-policy reimbursements under a per-org limit (default $300) with a clean receipt match.
- **Organizer approval:** anything over the limit, out of policy, or flagged.
- **Controller approval:** every payout batch release, every prize payout, anything over $2,000.
- **Never:** the agent can't approve a payout it proposed, edit a posted ledger entry, change policy, or see raw TINs, SSNs, SINs or bank numbers (only tokens and the last 4 digits).
- **Segregation of duties:** whoever requested a payment can't approve it, human or agent. The approval API rejects it.

### Explaining itself

Every decision writes a record: input documents, extracted facts, rules applied (with version), the model's reasoning summary, the action taken, and who approved it. In the UI, any number can be clicked to show where it came from. If an approver asks "why did you hold this?", the agent answers from that record, not from fresh generation.

### Notifications

Email and portal notices for attendees. For staff, the **Eve Slack app** (below); a Discord or Slack incoming webhook still works for a plain daily digest.

### Slack app

What a Slack app adds over a webhook is interactivity: approve buttons, DMs to the right person, and a thread per item. Alerts are grouped by who has to act and how fast.

**Real-time, interactive (DM to the person who must act)**

| Alert | Who gets it | Buttons |
| --- | --- | --- |
| Payout batch ready for release | Every linked controller | Release, Hold, Open in Eve |
| Payout frozen: bank details changed | Controllers and organizers (never the recipient) | Keep frozen, Mark verified, View evidence |
| Escalated claim (over limit, out of policy, fare anomaly) | Organizer on duty (or every organizer); controllers when the claim is over the organizer limit. Never the requester or the claimant | Approve, Reject, Ask for info |
| Prize decision needed (ship, buy local, or cash) | Organizer on duty | Accept recommendation, Compare options |
| Approval sitting too long | Backup approver: a release batch waiting 48 hours, or a claim or prize past its due date | Same buttons as the original |

**Real-time, informational (team channel, batched every 15 minutes)**

- A payout failed or was returned, with the reason and the next step Eve takes.
- A sponsor reconciliation exception, like the $970 paid on a $1,000 request.
- A budget line crossed 80% or 100% (spent plus committed).
- A computer use run finished or got stuck, with screenshots in the thread.
- A tax rule marked unverified was used in a live decision (paid or submitted), or a controller accepted one.

**Digest (one message per day, plus one at the end of event weekend)**

- Auto-approved claims and totals.
- Payouts sent and amounts withheld.
- Tax forms still missing, and who is being chased (reminder n of 4).
- Inbox count by age (under a day, 1 to 3 days, older).
- Budget spent vs. committed vs. remaining per line.

**Event-weekend specials (team channel, time-sensitive, not batched)**

- Winners entered, with how many need tax forms (W-8BEN called out) before the closing ceremony. One message, edited as winners and forms change; each new winner is a thread reply.
- A countdown to the closing-ceremony payout release while anything still blocks it (missing forms, held or frozen prize payouts, payouts waiting for release, undecided item prizes, unconfirmed team splits). It starts 6 hours out and refreshes at 3h, 2h, 1h, 30m, 10m and at closing.

**Rules the Slack app follows**

- **Same permissions as the web app.** Each Slack user maps to one Eve member through a link they make themselves: Eve shows a one-time code in Settings, and the member types `/eve link CODE` in Slack. The role is re-read from the database on every Slack request; nothing about authority is stored on the link. Every button calls the same server functions as the web (`runAuthorizedAction`, `queueControllerRelease`). The Release button checks segregation of duties server-side, so a controller who requested a payout in the batch is told so and refused. Release is bound to the exact batch the controller saw; if any payout or its terms changed, nothing is released and the card refreshes.
- **No sensitive data in Slack.** Names, amounts and the last 4 digits only; never full TINs, bank numbers or tax forms. Free text is scrubbed, and the API client refuses any message whose visible text looks like a taxpayer ID or an account number. Evidence lives behind "Open in Eve".
- **Threads per item.** Each escalation is one message per recipient. Status updates go in its thread, and the original is edited into its outcome ("Approved by Dana Whitfield via Slack") when resolved, so the channel never fills with stale buttons. A claim sent back for information reopens the same card when the attendee answers.
- **Logged like everything else.** An approval from Slack writes the same `decision_log` row as one from the web, with `via: "slack"` recorded in its facts and shown as "via Slack" in the audit trail. Slack-only decisions (Hold, Keep frozen) are logged too and never change payout state.
- **Noise control.** Informational alerts batch every 15 minutes. Each person can mute direct-message categories in the app's Home tab or with `/eve mute`. If everyone who can act mutes a category, the card goes to the team channel instead of being lost.

**Build:** a reconciler (`syncSlack`) compares what Slack should show with what was posted and posts, edits, threads or resolves; every post is claimed by a unique row first, so concurrent runs never double-post. It runs after every action (web or Slack), at the end of agent runs, approval reminders and computer use runs, from the countdown timer, and in the daily cron. Batching and the countdown are Workflow `sleep` timers. Slack's 3-second limit is met by acknowledging immediately and doing the work after the response.

## Working inside a university or fiscal sponsor

We treat the fiscal sponsor as the system of record for cash and our product as the system of record for everything before cash moves. That way student orgs can use it without owning a bank account.

Three modes, set per org:

| Mode | Who moves money | What we produce |
| --- | --- | --- |
| Direct | The org, through a connected provider (Stripe in test mode) | Executed payouts + ledger entries |
| Sponsor packet | University office (e.g. a student government finance office) or a nonprofit fiscal host | A disbursement packet per payee: approved request, tax form, receipts, computed withholding, payout instructions, in the sponsor's format (PDF + CSV) |
| Hybrid | Sponsor pays big items; org pays small reimbursements from its own card or account | Both, split by rule |

In sponsor mode, the agent's job shifts from paying to **getting the sponsor to pay**:

- Packets are complete on the first submission, which is what usually stalls university reimbursements.
- The agent tracks each packet's status (submitted, questioned, paid) and nudges the sponsor contact when it ages past their stated turnaround.
- When the sponsor marks something paid, the organizer uploads or forwards the remittance and the agent reconciles it against the packet. A mismatch (paid $970 on a $1,000 request) is a reconciliation exception with an explanation, not a silent close.
- Sponsor rules (e.g. "no gift cards," "no payments to non-students without a W-8BEN on file") are stored as policy so the agent flags conflicts before submission.

This is the "sources that disagree" case from the Hyphenate brief: the sponsor's ledger, our ledger, and the payee's bank all say slightly different things, and the agent has to say which to trust and why.

### Bulk disbursement flow

The **Disburse** screen replaces per-payment packet creation with a batch release. Eligible approved payouts appear together with their recipients, gross, withholding and net totals; held items remain excluded with reasons. A controller reviews the selection and releases it once.

Eve records the authorized quotes, reserves the payouts, and generates all packets in ordinary durable code steps. It creates one ZIP containing a payment manifest and supporting PDFs, completes the payment checks, then starts **one Browser Use Cloud V4 run and one browser session per batch**. The hosted fictional portal accepts bundles up to 4 MB through a private, expiring batch link. There is no agent per recipient. The fictional portal supports up to 200 USD payments in one upload, with one review screen and one confirmation.

The hosted portal accepts only the exact generated bundle. Eve runs the complete payment policy check before the browser starts and verifies that the finance inputs have not changed when Submit is clicked. Browser Use credentials are supplied through a domain-scoped secret binding; its live view appears in Disburse. A matching batch proceeds under the existing controller authorization; changed details stop for review. Submission is recorded per payout, while payment remains pending until remittance is reconciled. Retrying the same portal batch ID returns the original confirmation rather than creating another request.

### Stretch: computer use on the sponsor portal

University finance portals may have no API. Eve operates a fictional portal in a sandboxed browser. The main demo uses its bulk upload flow; the individual form remains available for the W-8BEN retry and SSN-conflict scenarios.

**Demo setup (nothing real gets filed):** build a separate small app, a fake portal for a fictional school ("Westbrook University Student Org Finance"). Never imitate a real university's or the IRS's site.

- **Portal spec:** login, 2 to 3 page payment request form, account-code dropdown, payee search, file uploads (receipts, W-8BEN), a review page, a session timeout.
- **Agent:** a Vercel Workflow orchestrates it; an E2B Desktop sandbox (Linux desktop with screenshot, mouse, keyboard, and a VNC stream) is the computer; Claude's computer use tool picks each action. Steps: create sandbox → open portal → loop (screenshot → model → action, each iteration a durable step) → stop on review page → approval hook → submit → save screenshots → kill sandbox. The VNC stream URL is embedded live in the organizer dashboard.
- **Planted failure:** first submit is rejected with "Non-US payees require Form W-8BEN attached." The agent reads the error, attaches the form, and retries.
- **Planted conflict:** the portal demands an SSN for every payee. The agent refuses to invent one, explains the payee is a foreign person with a W-8BEN on file, and escalates to the controller.
- **Stop point:** individual runs halt on the final Submit button and request controller approval. Bulk runs use the earlier batch release, with a deterministic comparison of the imported batch and a fresh policy check before submission.

**Guardrails:** domain allowlist for the browser; raw TINs never pass through the model (filled from the vault or left for a human); screenshots of every step saved to the decision log.

**Cost:** about one person-day (half portal, half agent loop and screenshot stream). Start Saturday afternoon only if the core flows work; record a backup video since runs take minutes and can flake. IRS forms stay on pdf-lib, not computer use.

## Integrations: real vs mocked

The rule for judging: say exactly what's real and what's simulated. Hyphenate asks for this directly.

| Area | Weekend plan | Real or mocked | Fallback if blocked |
| --- | --- | --- | --- |
| Payouts | Stripe Connect test mode, US platform, test connected accounts in US and Canada | Real API, test money | Mock provider behind the same interface |
| Flights | Duffel test mode for search and "booking" | Real API, sandbox inventory | Static fixture of realistic fares |
| Receipt OCR | LLM vision extracting merchant, date, amount, currency, lines | Real | None needed |
| FX rates | Free daily reference-rate API (e.g. Frankfurter, ECB data) | Real | Cached rate table |
| Accounting export | QuickBooks Online sandbox company (free with an Intuit developer account): push bills and journal entries | Real API, sandbox books | CSV/IIF export |
| Notifications | Eve Slack app (OAuth install, Web API, interactivity, Events API, slash command); Discord incoming webhook; email via any transactional provider | Real | Portal notices and the in-app inbox |
| Tax form e-sign | In-app typed signature with timestamp and IP, stored as PDF | Real (demo grade) | None needed |
| Tax filing | Generated 1099/1042-S/T4A/NR4 PDFs and export files | Real output, not filed | None needed |
| Shipping and duty | Rules table of carrier availability and duty estimates for 5 to 10 countries | Mocked data | None needed |
| Fiscal sponsor | Packet generator + a fake sponsor inbox that "pays" with realistic errors | Simulated counterparty | None needed |

Get the Stripe and Intuit developer accounts set up tonight. Both are free; Stripe's test mode needs no business verification.

Sources: [Intuit sandbox companies](https://developer.intuit.com/app/developer/qbo/docs/develop/sandboxes/manage-your-sandboxes) · [Stripe cross-border payouts](https://docs.stripe.com/connect/cross-border-payouts)

## Data model and ledger

One Postgres database with a real double-entry ledger underneath; every screen is a view over it.

### Core tables

| Table | Key fields |
| --- | --- |
| `org` | country (US/CA), fiscal mode (direct/sponsor/hybrid), policies, approval limits |
| `event` | org, dates, location, travel policy, prize list |
| `person` | legal name, DOB, citizenship, tax residency, address, verified-adult flag |
| `tax_profile` | person, form type, form PDF, treaty claim, TIN token, signed\_at, expires\_at, status |
| `payout_method` | person, provider, recipient ref, currency, last 4, changed\_at |
| `claim` | person, event, type (flight/expense), documents, extracted fields, policy result, status |
| `prize_award` | event, track, team, item or cash, FMV, split, fulfillment choice (ship/local/cash) |
| `payout` | person, source (claim or award), gross, withholding, fees, FX, net, provider, quote, status |
| `approval` | object, requested\_by, approver, decision, reason, timestamp |
| `rule` | jurisdiction, payment type, rate, threshold, form, effective dates, source, verified, version |
| `decision_log` | object, inputs, facts, rules used, reasoning summary, action, actor |
| `journal_entry` / `journal_line` | date, memo, source object; lines with account, debit, credit, currency |
| `filing` | person, tax year, form type, amounts, generated file, status |
| `slack_installation` / `slack_user_link` | org's workspace, sealed bot token, team channel, organizer on duty, backup approver; member ↔ Slack user, muted categories |
| `slack_message` / `slack_alert` | one posted card per item and recipient (thread, state, fingerprint); queued channel alerts and their 15-minute batch |

### Ledger rules

- A database constraint enforces debits = credits per entry.
- Posted entries are immutable. Corrections are reversing entries with a link to the original.
- Starter chart of accounts: Cash (per provider or sponsor), Travel Expense, Prize Expense, Stipend Expense, Withholding Payable (federal, state), Payout Fees, FX Gain/Loss, Due from Sponsor, Accounts Payable (attendees).
- Example: a $1,000 prize to a Canadian winner at 30% → Dr Prize Expense 1,000 / Cr Withholding Payable 300 / Cr AP-Attendee 700; then on payout Dr AP-Attendee 700 / Cr Cash 700, plus a fee line.
- Periods can be locked by the controller. Locked periods reject new entries.

PII handling: TINs, SINs, and bank numbers go to an encrypted vault table; everything else (including the agent) sees tokens and last 4 digits.

## Architecture and stack

One TypeScript app on Next.js with Drizzle on Postgres, plus a durable job runner for the agent's triggers. Everything that touches money or tax is plain, tested code; the LLM only reads documents, picks which facts apply, and writes explanations.

&#91;embedded content: system architecture · app, jobs, model, data, external services\]

Both portals hit one Next.js app; agent work runs as Vercel Workflow runs that call Claude and the app's typed tools, and every write lands in Postgres. External webhooks (Stripe, Slack) come back in through the app's route handlers.

### Next.js or TanStack Start

Pick **Next.js (App Router)** for this weekend. TanStack Start is a good framework with nicer type-safe routing, but Next.js has more examples for every integration we need (Better Auth, Vercel Workflow, Stripe, AI SDK), and four people debugging at 3 AM benefit from that. If two or more teammates already ship with TanStack Start, use it instead; nothing below depends on the choice except the route folder layout.

### Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js App Router, server actions, route handlers for webhooks | Two portals (attendee, organizer) in one app |
| Language | TypeScript, strict | Shared types from DB to UI |
| DB | Postgres on PlanetScale (node-postgres; PgBouncer for the app, direct connection for migrations) | Constraints, triggers, `numeric`, row-level locks |
| ORM | Drizzle + drizzle-kit migrations | Typed queries, raw SQL when the ledger needs it |
| Validation | Zod everywhere (forms, API, LLM structured output) | One schema per object, reused by the agent's tools |
| Auth | Better Auth (Drizzle adapter), magic link + Google | Roles: attendee, organizer, controller, auditor |
| Jobs and triggers | Vercel Workflow (Workflow DevKit) | `"use workflow"` / `"use step"` durable functions inside the Next.js app; `sleep` for chase schedules, Zod-typed hooks for approvals, Vercel Cron routes that start runs for the nightly fare tracker and Jan 1 packet. No separate service |
| Agent | Vercel AI SDK with Claude, tool calling, structured output | Swap models freely (ask the Microsoft booth whether Azure earns points) |
| Receipt OCR | Same model with vision, Zod-typed extraction | No separate OCR service |
| Files | Supabase Storage or Cloudflare R2 | Receipts, signed forms, generated PDFs |
| PDFs | pdf-lib filling the official fillable IRS PDFs | W-8BEN, W-9, 1099-MISC, 1042-S look real |
| UI | Tailwind + shadcn/ui, TanStack Table | Fast, consistent dashboards |
| Payouts | Stripe Node SDK (test mode) behind `PayoutProvider` | Mock provider for wires |
| Flights | Duffel SDK (test mode), SerpApi for price insights | Search, sandbox booking, stretch fare check |
| Accounting | QuickBooks Online REST (sandbox) via `intuit-oauth` | Push bills and journal entries |
| Notifications | Eve Slack app over the Web API (no SDK), Discord webhook, Resend for email | Interactive approvals where staff already are |
| Tests | Vitest | Tax engine and ledger run against the answer key |
| Deploy | Vercel (app + Workflow) + PlanetScale + E2B | Deploy Saturday morning, not Sunday |

**Computer use (stretch):** Vercel Workflow + E2B Desktop + Claude computer use. E2B over Vercel Sandbox because E2B ships a ready desktop environment with screenshot, mouse, keyboard, and live VNC streaming APIs; Vercel Sandbox is built for running code, so we'd have to assemble a virtual display and streaming ourselves. Set the sandbox timeout longer than the expected approval wait; if it expires, the workflow refills the form from the packet before submitting.

### Money and data rules

- Store amounts as integer minor units (`bigint` cents) with a currency code. FX rates as `numeric(18,8)`. Never floats.
- The ledger balance check is a deferred constraint trigger in SQL (debits = credits per entry at commit), written as a custom drizzle-kit migration.
- Posted journal lines are append-only: no `UPDATE` or `DELETE` grants for the app role on those tables.
- PII (TIN, SSN, SIN, bank numbers) lives in a `vault` table encrypted with pgcrypto. The app and the agent get tokens and last 4 digits only.
- Every external call takes an idempotency key derived from the payout or claim id.

### How the agent is wired

1. Something happens (receipt uploaded, winners entered, form expiring) → the app starts a workflow run, or resumes a waiting one through its hook.
2. The workflow loads context in steps and calls the model with a small set of typed tools for that job.
3. Tools are server functions that check permissions in code before doing anything: `extractReceipt`, `checkPolicy`, `quoteFlights`, `computeWithholding`, `quotePayouts`, `proposePayout`, `requestApproval`, `messagePerson`, `postJournal`. There is no tool that approves or releases money.
4. Every tool call and model response writes a `decision_log` row.
5. Approvals resume the waiting workflow through its hook, and only a controller-signed approval can trigger `executePayout`, which is not an agent tool.

### Repo layout

```
app/
  (attendee)/       portal: onboarding, claims, prizes, payout method
  (organizer)/      dashboard: queue, approvals, budgets, audit trail, scoreboard
  api/webhooks/     stripe, slack (interactivity, /eve, events), hook resume
  api/slack/        Slack install and OAuth callback
lib/
  db/               drizzle schema, migrations (incl. raw SQL ledger trigger)
  ledger/           postJournal, reverse, period lock
  tax/              rules table loader, withholding, thresholds, filings
  payouts/          PayoutProvider interface, stripe.ts, mock-wire.ts, sponsor-packet.ts
  flights/          duffel.ts, price-insights.ts
  agent/            tools, prompts, per-job agent functions
  pdf/              form fillers
  slack/            Slack app: model (who gets what), blocks, sync, interactions, linking
slack/manifest.yml  Slack app manifest
workflows/          durable workflows (claims, payouts, chasing, computer use, Slack batches and countdown) + cron routes
scripts/seed.ts     300-person event + planted errors + answer key
tests/              vitest suites against the answer key
```

## Demo plan, proof it works, and track mapping

The demo opens with the TreeHacks story replayed live: what took 9 months should take minutes.

### The moment (first 60 seconds of the video and the live demo)

1. A judge enters "First Overall: MacBook Air" and picks a winner whose residency is Canada.
2. The agent immediately flags it: an item prize to a non-US winner needs a W-8BEN, 30% default withholding on fair market value, and duty on import. It recommends buying locally or offering cash, with the numbers side by side.
3. The winner gets a portal link, picks cash, fills a prefilled W-8BEN, and chooses a CAD bank account. The agent shows net received after withholding, fees, and FX.
4. The controller approves on their phone. A Stripe test payout fires. The ledger, the 1042-S draft, and the audit trail update in front of the judges.

**Second beat:** one minute later, a "winner" emails new bank details. The agent freezes the payout, explains why, and asks for confirmation through the original channel.

### Proof it works

- **Seeded event:** a fake 300-person hackathon with 120 travel claims, 40 expenses, and 25 prizes across 12 countries, generated by a script.
- **Planted errors with an answer key** (target about 40): duplicate receipts, a flight on the wrong dates, a business-class ticket, a receipt in EUR above the cap after conversion, a name mismatch, an expired W-8BEN, a W-9 from someone with a foreign address, a winner who crosses $2,000 across two payments, a sponsor that "paid" $970 on $1,000, a bank-detail change before payout, and an attendee under 18.
- **Scoreboard in the UI:** caught X of 40, false positives Y, wrongful payouts 0. Shown on the demo and in the README.
- **"Try your own" button:** judges can upload any receipt or type any winner scenario (country, prize, amount) and watch the agent decide live.

### Track mapping

| Criterion | Where we answer it |
| --- | --- |
| Hyphenate: Is it real enough? | Real ledger, real Stripe test payouts, seeded event with planted errors and a scored answer key |
| Hyphenate: Would you hire it? | Seats: travel coordinator, AP clerk, tax/compliance. Limited permissions, decision log, chases and escalates |
| Hyphenate: Something new? | Event finance, cross-border prizes, and fiscal sponsors are a corner nobody has automated |
| Hyphenate: The moment | TreeHacks replay + bank-detail freeze |
| Microsoft: Customer understanding | Lived story; quote at least one organizer we talk to this weekend (Cal Hacks directors) |
| Microsoft: Measurable usefulness | Days to pay a foreign winner (9 months vs. same day), claims auto-processed %, errors caught |
| Microsoft: Path to production | Provider interface, sponsor mode, rules table with sources, QuickBooks sync |
| Microsoft: Responsible design | Segregation of duties, PII tokenized, human signs filings, adult-only |
| Microsoft: End-to-end | Onboarding → claim → payout → ledger → year-end packet in one run |

Submission also includes the one line Hyphenate asks for: *"Fills the travel coordinator, AP clerk, and tax/compliance seats for event organizers."*

## Weekend build plan

Four workstreams in parallel, one integration point (the database schema), and a draft on Devpost by Saturday night. Submission closes Sunday 9:00 AM; judging runs 10:30 AM to 12:30 PM.

**Stack:** Next.js + Drizzle + Postgres + Vercel Workflow + AI SDK, as set out in Architecture and stack. Schema and the `PayoutProvider` interface get merged first (Phase 0 below), so all four workstreams build against them.

| Workstream | Owns |
| --- | --- |
| A. Ledger + tax | Schema, ledger trigger, rules table, withholding, thresholds, PDFs and filings, QuickBooks push, tests |
| B. Agent + claims | Workflows, OCR, policy checks, flights, chasing, escalations, decision log, recommenders, computer use |
| C. Payouts + sponsor | `PayoutProvider`, Stripe test mode, mock wire, quotes, approval queue, sponsor packets and reconciliation |
| D. UI + demo | Attendee portal, organizer dashboard, setup wizard, seed data and answer key, scoreboard, video, README |

### Tonight's checklist

- [ ] Go to the Hyphenate workshop (7 PM, in person) and ask which event or AP edge cases they'd test us on
- [ ] Ask a Hyphenate or mentor tax person to confirm the Canada prize treaty rate and the California rule
- [ ] Create Stripe and Intuit developer accounts
- [ ] Ask the Microsoft booth whether Azure or Foundry use earns points
- [ ] Talk to a Cal Hacks director about how they actually pay international winners and reimburse travel

## Implementation order

Build one thin path end to end first (a Canadian winner paid, with tax, ledger, and audit), then widen. Each phase ends in a milestone that must work on the deployed URL before the next phase starts. Times are Saturday into Sunday; submission closes Sunday 9:00 AM.

### Phase 0: Foundation (Sat 12:30 AM to 3 AM)

Everything else depends on this, so all four people do it together, then split.

- Next.js repo, PlanetScale Postgres database, Vercel project, Workflow DevKit installed, first deploy.
- Drizzle schema for the core tables; the ledger balance trigger and append-only grants as a raw SQL migration.
- Better Auth with the four roles; a role switcher in dev for testing.
- Interfaces stubbed and merged: `PayoutProvider`, the rules table shape, agent tool signatures, `decision_log` writer.
- Seed script skeleton: one org, one event, five attendees in three countries.

**Milestone M0:** deployed app, login works, a test journal entry posts and an unbalanced one is rejected.

### Phase 1: The spine (Sat 3 AM to 11 AM, sleep in shifts)

One flow, end to end, ugly UI is fine.

| Order | Feature | Owner | Depends on |
| --- | --- | --- | --- |
| 1 | Attendee onboarding: residency, DOB check, form selection | D + A | M0 |
| 2 | W-9 / W-8BEN filled with pdf-lib, e-signed, stored | A | 1 |
| 3 | Tax engine: withholding by jurisdiction from the rules table | A | M0 |
| 4 | Prize entry for one winner → payout proposal with withholding, fees, net | C | 2, 3 |
| 5 | Approval workflow: proposal waits on a hook, controller approves | B | 4 |
| 6 | Stripe test payout to a Canadian connected account + journal entries | C + A | 5 |
| 7 | Receipt upload → OCR → policy check → auto-approve or escalate | B | M0 |
| 8 | Decision log written by every step above | B | 4 to 7 |

**Milestone M1 (11 AM):** the TreeHacks replay works live: winner announced, W-8BEN collected, withholding computed, controller approves, Stripe test payout lands, ledger and decision log update.

### Phase 2: Breadth (Sat 11 AM to 5 PM)

| Feature | Owner | Notes |
| --- | --- | --- |
| Organizer setup wizard + event tabs | D | Basics, travel policy, budget, prizes, attendee import |
| Inbox, Claims, Prizes, Payouts, People screens | D | Inbox first; it is the home page |
| Chase workflow (`sleep` schedule) + Slack/Discord webhooks | B | Missing or expiring tax forms |
| Ship / buy local / cash recommender | B | Rules table of countries and duty estimates |
| Payout batches + quotes across providers + mock wire | C | Controller releases a batch |
| Cumulative thresholds ($2,000) and team prize splits | A |  |
| Flight suggestions (Duffel test mode, fixture fallback) | B | Org-books-it path |
| Full seed: 300 attendees, 12 countries, 40 planted errors, answer key | D | Start early; tuning depends on it |
| Scoreboard on `/agent` | D | Reads answer key vs agent decisions |

**Milestone M2 (5 PM):** a full run on the seeded event from organizer setup to paid batch, scoreboard showing results. Deploy and record a rough backup video now.

### Phase 3: Differentiators (Sat 5 PM to 11 PM)

1. Bank-detail change freeze and verification (second demo beat).
2. Sponsor packet generator, fake sponsor inbox, and reconciliation exceptions.
3. Audit trail click-through: any number links to its evidence.
4. "Try your own" input for judges.
5. Year-end packet: 1042-S and 1099-MISC first, others if time.
6. Budget screen and QuickBooks sandbox push.
7. Pre-event organizer warnings on the prize list.

**Milestone M3 (11 PM):** Devpost draft submitted with screenshots and the real vs simulated table.

### Phase 4: Stretch (Sat 11 PM to Sun 4 AM, only if M2 passed on time)

- Computer use on the fake Westbrook portal (one person: portal first, then the E2B loop).
- Fare anomaly check: peer baseline first, SerpApi snapshots second.

### Phase 5: Freeze and ship (Sun 4 AM to 9 AM)

- 4 AM feature freeze. Only bug fixes after this.
- Run the answer key; fix the worst misses; record the scoreboard number.
- Demo video that opens with the moment; README with setup, seats filled, and what's real vs simulated.
- Rehearse the 2-minute pitch twice; reset script tested.
- Final Devpost submit by 8:30 AM.

### If we fall behind, cut in this order

1. Computer use
2. SerpApi fare snapshots (keep peer baseline)
3. QuickBooks push (keep CSV export)
4. Duffel (keep fare fixtures)
5. T4A, NR4, and 1099-NEC drafts (keep 1042-S and 1099-MISC)
6. Mock wire provider (keep Stripe)

Never cut: the M1 spine, the decision log, segregation of duties, the planted-error scoreboard.

## Risks and open questions

The biggest risk is scope: "everything" only works if each flow is thin but real, so cut depth before cutting a flow.

| Risk | Mitigation |
| --- | --- |
| Scope too wide for 40 hours | Each flow ships happy path + 2 planted errors first; depth after Saturday noon |
| Tax rules stated wrong in front of judges | Rules table carries a `verified` flag and a source; unverified rules are labeled in the UI |
| Stripe cross-border setup eats time | Mock provider behind the same interface from hour one |
| Duffel or QuickBooks signup stalls | Fixtures and CSV export are ready fallbacks |
| Demo breaks live | Recorded video backup; seed script resets state in one command |
| LLM makes up a number | All amounts computed in code; the model only selects facts and writes explanations |

### Open questions

- What US withholding rate applies to a hackathon prize paid to a Canadian resident under the treaty, and which article? (Default to 30% until confirmed.)
- Are substantiated travel reimbursements to attendees (not employees or contractors) reportable income? (Default: not reported, flagged for advisor review.)
- Does California nonresident withholding apply to prizes from a contest held in San Francisco?
- For Canadian organizers: which T4A box and threshold apply to prizes, and when does Part XIII withholding apply to non-resident winners?
- Which payout rail do Cal Hacks and TreeHacks actually use today, and what do they hate about it?
