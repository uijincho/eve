# Bulk disbursements with Browser Use Cloud

Disburse groups eligible approved/proposed payouts into a batch. A controller releases the selected recipients once. Eve records their exact quotes and reserves the payouts, then returns while a durable workflow prepares the documents.

`workflows/disbursement.ts` creates one ZIP and runs the payment checks before opening a browser. It starts **one Browser Use Cloud V4 run and one session for the entire batch**. That run signs in, uploads the bundle, reviews the totals and submits once. There is no per-recipient agent. Durable polling observes Cloud status and live-view events; it does not start additional model tasks.

The fictional Westbrook bulk portal is hosted at a private, expiring, batch-scoped URL in Eve. It uses a separate HttpOnly login cookie and a run-scoped secret binding. The agent never receives the password in its prompt. The bundle contains the manifest, generated supporting PDFs and available W-8 forms. The hosted upload limit is 4 MB and 200 payments; this stays below Vercel's request-body ceiling. No real funds are sent.

## Release integrity

Before starting Cloud, Eve runs the existing settlement gate in a rolled-back transaction, including interactions between payouts. A SHA-256 fingerprint captures the finance inputs before and after that check. Each phase gets a separate workflow execution window. Tax rules are loaded once per batch transaction; recipient and payout checks remain individual.

At upload, the portal accepts only the exact SHA-256 of the generated ZIP. At Submit it locks the organization, verifies the uploaded batch and checks the finance fingerprint again. Changed amounts, bank details, tax forms, permissions, rules, budgets, sources, accounting periods or date-sensitive gates refuse submission. The link and preflight expire after 15 minutes.

The portal stores one receipt per batch. Repeating Submit returns that receipt. Eve verifies the receipt and records every associated sponsor packet in one atomic transaction, running the policy gates again. Payouts stay processing until remittance reconciliation marks them paid.

Failure before submission can be retried by the releasing controller. Retry keeps the batch identity and rotates the portal capability, invalidating an older agent's link. Unknown Cloud launch outcomes are not automatically re-dispatched. Once a receipt exists, reservations stay in place and blind retry/cancellation is refused. The old single-payment computer-use lab remains separate.

## Setup

Set these server-only variables locally and in Vercel:

- `BROWSER_USE_API_KEY`: create a key in [Browser Use Cloud](https://cloud.browser-use.com/settings?tab=api-keys).
- `EVE_APP_URL`: the public HTTPS deployment URL. The hosted browser cannot reach localhost. The portal route must be reachable without Vercel deployment protection; its own batch capability and login still apply.
- `EVE_VAULT_KEY`: the existing stable key that derives private portal credentials.
- `EVE_BROWSER_USE_MAX_COST_USD`: defaults to `0.50` per Cloud run; this is the provider's run cost cap, not a guarantee of final billed cost.
- `EVE_BROWSER_USE_MODEL`: optional. Empty uses the standard V4 default; do not choose a restricted early-access model without account access.

No Browser Use SDK package is needed: the server uses the documented V4 REST API. Bulk disbursements no longer require an E2B desktop or a separate Anthropic key. Keep those keys if using the existing single-packet lab or other Claude features.

After deploying, release a small batch first. Watch the live browser in Disburse, then verify its portal confirmation and processing payouts. The prior interrupted 49-payment batch remains reserved for retry; it was not submitted.

## Verification

`pnpm exec vitest run tests/browser-use-client.test.ts tests/batch-packet.test.ts tests/db/disbursement-batch.db.test.ts` covers the Cloud transport, a 50-recipient ZIP, authorization, exact upload checks, stale financial inputs, concurrent duplicate Submit, one Cloud launch, atomic accrual and remittance. Database tests use disposable organizations and mocked provider calls, without Cloud credits.

`pnpm verify:browser-use` runs the real Cloud flow for two synthetic payments through a local HTTP server and a temporary HTTPS tunnel. It uses Cloud credits and removes its disposable organization afterward. Start the server and script with the same `WORKFLOW_TARGET_WORLD=local`, `WORKFLOW_LOCAL_DATA_DIR` and `WORKFLOW_LOCAL_BASE_URL`; set `EVE_LOCAL_URL` to that local server and `EVE_APP_URL` to its public tunnel URL. Explicitly setting the workflow world keeps Next's plugin from replacing the isolated data directory. Do not point the check at the shared production organization.

Large batches still perform individual database policy checks during preparation and settlement. One Cloud run reduces model usage; it does not make those database phases instantaneous.

Live acceptance verified on October 25, 2026: one Browser Use Cloud task uploaded and submitted two synthetic payments, received portal confirmation, and produced exactly two processing payouts and two accrual entries. The task completed, and the test organization and temporary local server were removed. A live 49-payment Cloud run has not been benchmarked.

Provider reference: [V4 agent quickstart](https://docs.browser-use.com/cloud/agent/quickstart), [workspaces and files](https://docs.browser-use.com/cloud/agent/workspaces), [events and live preview](https://docs.browser-use.com/cloud/agent/observability).
