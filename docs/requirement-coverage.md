# Requirement coverage

This records the implemented scope against `PRD.md` and `PRODUCT.md`. It is a demonstration build with real application persistence and simulated money. Final measured results and deployment details belong in `IMPLEMENTATION.md` and `demo-benchmark.json`; a screen existing is not proof that an external integration works.

| Requirement | Available behavior | Boundary or remaining work |
| --- | --- | --- |
| Organization setup | Real accounts create US or Canadian organizations, policies, an event, budgets and organizer membership atomically. | One current event per organization. No legal-entity verification or complete EIN/business-number setup. |
| Team access | Organizer, controller and auditor invitations; imported adult attendees receive person-bound portal invitations. | Copyable links, no invitation email; no member-role editing/removal. |
| Authentication | Better Auth email/password, protected cookies, explicit organization selection and demo personas. | Google and magic-link sign-in are not configured. Email ownership is not verified; an attacker can pre-register an invitee's address. |
| Adult eligibility | Import, portal invitation, claims, flight requests and payment checks use age at event start. | Imported minor records can remain visible for staff to resolve; they cannot receive payments. |
| Tax onboarding | Residency, citizenship, address, encrypted tax identifier, typed signature, signature PDF and form validity. | Demo-grade certification, not an official signed IRS form; entity onboarding for W-8BEN-E is incomplete. |
| First payout account | Attendees enroll their own first simulated account. | No real bank-ownership verification. A compromised attendee session can enroll the first account. |
| Bank replacements | Existing payouts freeze, codes go to the original contact through a configured email adapter, and fresh approval is required. | Without live email configuration the change stays pending. Codes appear in the app only in the labeled demo inbox. |
| Claims and receipts | Uploads, real Claude extraction, duplicate checks, evidence comparison, exact FX, policy, budgets, review and payout proposals. | Hand-entered or incomplete evidence requires a person. OCR accuracy is not guaranteed. |
| Travel policy | Economy, booking deadline, travel window, name, amount and event-wide cap checks. | Separate caps by origin region and market-fare intelligence are not implemented. |
| Flight suggestions | Event-relative dates, venue destination, filtered simulated inventory and signed offer tokens. | Fixture fallback; Duffel adapter has not been tested with a real sandbox. Unknown venues disclose the SFO fallback. |
| Organization-booked flights | Verified server offer, organizer approval, simulated booking and expense journal. | No airline purchase; never reimburses the attendee for an organization booking. |
| Cash prizes and stipends | Winner entry with an explicit Judge stipend choice, separate reporting-form totals, withholding, exact quote and controller release. | All settlements are simulated. Stipend classification still follows the track name; a track containing judge/mentor/speaker/stipend is treated as a stipend. |
| Team prizes | Split allocation, member confirmation and locks after a live payout exists. | No separate team-management product beyond the prize workflow. |
| Physical prizes | Ship/local/cash comparison; controller completion records non-cash income, withholding gross-up and ledger entries. | Fulfillment and shipping/duty estimates are simulated. No retailer order or carrier tracking. |
| Tax rules | Versioned deterministic rules, effective years, evidence links, backup withholding and default foreign-prize withholding. | Canadian, treaty, reimbursement and state treatments retain their documented uncertainty. No production tax-compliance claim. |
| Rule resolution | Controller-only, reason-required acceptance of an unverified rule or available verified default for one source. | Does not verify the rule or bypass age, form, bank, budget or separate release requirements. |
| Payout approval | Server roles, requester and beneficiary checks, exact quote fingerprints, locked recomputation and idempotent workflows. | Separate Stripe test adapter exists, but the application uses the simulated provider. |
| Budgets | Persisted caps, committed/spent/remaining views and approval-time enforcement under a finance lock. | Functional books are USD; CAD policy inputs are converted with recorded reference rates. Simulated domestic CAD payments still route through USD and destination FX estimates. No forecast model. |
| Sponsor packets | PDF/CSV, controller submission, exclusive payout ownership, cumulative remittance entry, aging notices and controller-only shortfall acceptance. Net, fee and destination estimates reflect the accepted remittance. | Simulated sponsor counterparty; no sponsor portal, automatic hybrid dollar routing or structured sponsor-specific policy language. |
| Ledger | Double entry, database balance constraints, immutable postings, linked reversals, idempotency and locked periods. | Opening sponsor-fund balances must be supplied for a full accounting installation. |
| Activity and evidence | Persisted decisions, rule versions, receipt facts, role reasons, grouped runs and linked records. | Polling, not streamed model tokens; no free-form financial agent with unrestricted tool access. |
| Automatic triggers | Receipt review, winner proposals, imported-attendee tax chases, changed-form recovery and approval hooks. | Policy/money actions are deterministic; the model is used for document extraction. |
| Reminders | Durable day 0/2/5/10 form chases, approval reminders, staff escalation, daily digest and sponsor aging. | No named backup-approver assignment. Real email/Slack/Discord delivery requires configuration. |
| Annual work | January 1 sweep drafts prior-year filings. | Vercel Preview needs a manual authenticated cron invocation; automatic cron is a production-deployment feature. |
| Filing outputs | 1099-MISC, 1099-NEC, 1042-S, annual 1042 summary, T4A and NR4 worksheets, CSV and downloads. | Custom drafts, not official fillable templates or certified filing-ready files. CRA drafts remain unverified. No e-filing or completed filing-signoff flow. |
| Accounting export | Balanced QuickBooks journal CSV, account mapping, plain ledger CSV and import manifest. | Documented CSV fallback; no live QuickBooks API or verified import into a company. |
| UI | Organizer screens, attendee portal, real onboarding/invite pages, mobile controls and evidence panes in the existing Blue Hour design. | Browser QA covers desktop/mobile routes, keyboard, focus, contrast and recovery; source-specific reports are linked in the [QA index](browser-qa-summary.md). No real screen-reader certification. |
| Demo proof | 300 people, 120 travel claims, 40 expenses, 25 awards, planted errors and a measured scoreboard. | `verify:demo --reset` is the reproducible benchmark; subsequent demo interactions change later results. |
| Try your own | Persisted synthetic winner entry and real receipt upload/review. | Payments still need the required profile, bank and controller actions. |

## Deliberate changes from the proposed architecture

- Prize and stipend reporting thresholds are tracked separately by reporting form, following the verified sources in `lib/tax/SOURCES.md`. The PRD's example combining them into one threshold is not used.
- Receipts and generated PDFs are stored in Postgres with organization-scoped access rather than a separate object-storage service.
- Sensitive values use an application-managed encrypted vault. The model and snapshots receive masked values, not raw identifiers.
- Files and money use exact minor units. Canadian filing worksheets use CAD, while internal financial books use USD; both currencies are labeled explicitly.
- External integrations use the fallbacks the user authorized. Platform credential authentication alone is not described as an end-to-end Stripe payout.

## Deferred stretch and presentation work

Historical flight-price tracking, peer fare anomaly detection, the fictional sponsor portal and computer-use stream, production filing, organizer interviews and a Devpost submission are outside this overnight build. A customer interview or claimed improvement in real payout time must not be inferred from the synthetic demonstration.
