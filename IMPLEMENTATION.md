# Eve overnight implementation

Approved October 24, 2026 at 02:18 Pacific. Target handover around 07:18 Pacific, with feature freeze around 06:10. Push tested milestones directly to `main`; deliver a Vercel preview and a working local demo. Use Claude Code-backed Opus 5.5 workers, high effort, Fast mode off, at most three concurrent workers. Existing Blue Hour design and mockup are binding; use Impeccable and Better UI.

## Shared contracts

`lib/contracts.ts` is the JSON boundary between the UI and server. Money crosses JSON as integer minor-unit strings; calculation uses bigint and exact decimals. `GET /api/app` returns a role-filtered snapshot. `POST /api/actions` validates and authorizes named actions. Database schema, server services and authorization have one owner; UI and deterministic engines build independently against these contracts.

## Milestones

- [ ] Foundation: schema, migrations, permissions, auth, vault, document storage, balanced immutable ledger, deployment.
- [ ] International prize: profile and form, item/cash comparison, deterministic tax and quote, controller release, test payout, ledger and evidence.
- [ ] Product breadth: all organizer routes, attendee portal, setup, import, claims, travel, awards, team splits, payouts, budget, settings.
- [ ] Automation: receipt extraction, checks, chases, reminders, freeze and re-verification, sponsor packets and reconciliation, filing drafts and exports.
- [ ] Proof: seeded 300 people, 120 travel claims, 40 expenses, 25 prizes, approximately 40 planted errors, actual-run scoreboard and reset.
- [ ] Handover: independent financial and design review, browser verification, tests/build, Vercel preview, local demo, README and coverage report.

## Acceptance and scope

Never cut the complete prize flow, role separation, controller-only money release, ledger integrity, decision log, or measured scoreboard. Replay the winner journey and bank-change freeze through the UI. Test real Postgres constraints, unauthorized access, duplicate/retried payments, locked periods, and known planted exceptions. Every major screen must perform real persisted operations, with loading/error/empty and mobile behavior.

Use existing `.env` database and Anthropic credentials without printing or committing them. External money stays test or simulated. Stripe sandbox is preferred; documented payout, flight, FX, notification, shipping and accounting fallbacks are allowed. Verify proposed tax rules against authoritative sources; preserve versions and visibly identify unresolved assumptions. Core internal financial behavior must not be replaced by cosmetic fixtures.

Optional account setup may use the user's logged-in Helium Stripe account or contact@badbird.dev, with credentials saved to 1Password. Prefer existing services and fallbacks over spending the night on signups. Computer use and historical fare tracking remain stretch work.

## Ownership

- Financial backend worker: relational schema, migrations, auth, API/services, seed, audit, ledger, documents.
- Engine worker: exact money, tax and policy engines, payout providers, fulfillment/flight recommendations, engine tests; later durable workflows and integration adapters.
- UI worker: organizer and attendee routes, app shell, interactive flows and design fidelity.
- Coordinator: shared contracts, merges and pushes, deployment, environment setup, end-to-end acceptance, independent review and remaining gaps.

Workers use isolated worktrees and commit small milestones. The coordinator integrates and pushes each tested milestone to main. No worker rewrites another worker's files or changes shared contracts without coordination. Keep progress and substantive validation evidence below.

## Progress

- Planning baseline: 16 tests pass; lint and typecheck pass. Postgres is reachable and empty; direct connection needs the libpq `sslrootcert=system` option normalized for node-postgres while retaining certificate verification. Vercel is authenticated. Runtime Anthropic credentials pass a read-only authentication check.
