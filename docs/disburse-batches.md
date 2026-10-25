# Bulk disbursements

The Disburse page groups eligible approved/proposed payouts into a reviewable batch. The controller releases the selected recipients once. The request records their exact displayed quote keys and reserves those payouts, then returns while a durable workflow prepares the documents.

`workflows/disbursement.ts` runs deterministic preparation steps, creates one ZIP, opens one E2B desktop, and starts one computer-use conversation. There is no per-recipient agent fan-out. The browser gets only the bundle path, batch ID, recipient count and expected net total. The portal task has a fixed 24-turn ceiling, independent of the number of recipients.

The bundle contains `manifest.json` plus supporting PDFs and available W-8 forms. The fictional Westbrook portal accepts up to 200 USD payments and 30 MB per upload. It validates every row, integer-cent arithmetic, document SHA-256 hashes and totals, and presents one review screen with expandable recipient details. It retains the single-payment form for the existing lab scenarios.

Before the final click, Eve reads the portal-owned imported manifest, compares all its contents and its fingerprint to the released bundle, rechecks controller access and the existing payout policy gates, and enables that exact batch on the portal. The agent cannot authorize a batch itself. The initial controller release supplies the authorization; the bulk path does not ask for a second approval.

The portal stores one confirmation for the batch ID. Repeating the same submission returns that confirmation. Reusing the ID with changed contents is rejected. Eve verifies the portal's receipt, then submits every associated sponsor packet in one database transaction using the existing accrual and withholding logic. Payouts remain processing until remittance reconciliation marks each paid.

Failed preparation or upload can be retried as the same batch by its releasing controller, or cancelled so the payouts can enter a new batch. After submission is enabled, failed/uncertain outcomes keep their reservations and confirmation evidence; they cannot be retried or cancelled blindly. A changed quote, recipient, policy or controller permission stops submission. Existing direct release, single-packet creation and individual portal starts cannot take a payout reserved by a batch.

Apply migrations with `pnpm db:migrate`. Bulk runs require the same E2B, Anthropic and vault configuration as the existing portal workflow. External money movement remains simulated.

## Verification

- `pnpm exec vitest run tests/batch-packet.test.ts tests/db/disbursement-batch.db.test.ts` checks a 50-recipient ZIP against the real Python validator, quote binding, controller authorization, exclusive reservations, retry identity, exact import comparisons, atomic accrual, and remittance settlement. Database tests use disposable organizations; workflow launches and desktop/model calls are mocked.
- Browser QA used the local fictional portal with a 50-recipient bundle: upload, validation, pre-authorization rejection, authorized submission, repeated submission returning the same confirmation, and desktop/mobile layout.
- The Disburse screen was inspected at 1440px and 390px. No paid LLM/E2B end-to-end run was used for this change.
