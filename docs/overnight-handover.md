# Eve overnight handover

The implemented application is on GitHub `main`. It uses real Postgres persistence, authentication, evidence records and durable workflows. Money, flight bookings and physical fulfillment are simulated; filing documents are drafts.

## Open the app

- [Vercel preview](https://eve-calhacks-hj2fnowlg-badbird5907s-projects.vercel.app). Vercel deployment protection is retained; use your Vercel account to open it.
- [Local demo](http://localhost:3000). The development server is running. To restart it, run `pnpm dev` in `/Users/evanyu/calhacks` with the existing environment files.
- [GitHub main](https://github.com/uijincho/calhacks/tree/main).

The shared fictional event is ready for exploration: 300 people, 160 claims and 25 awards. Use the persona selector for Dana (organizer), Ari (controller), Mei (auditor) and the attendees. Real account setup and invite acceptance are available separately from the sample personas.

## A short demonstration

1. As Dana, open **Prizes** and inspect Priya Raman's MacBook Air. The evidence shows the delivery comparison and why the payout is blocked.
2. As Priya, open **My prizes** and choose cash. Complete her profile and W-8BEN with her typed name. Leave the treaty claim off to demonstrate the default 30% withholding.
3. Follow the automatic proposal in **Agent Activity**. Review gross, withholding, the organization-paid fee and the recipient amount. The agent proposes; it cannot release money.
4. As Ari, inspect and release that proposal. Wait for the persisted paid status, then inspect its decisions and ledger export. As Dana, the same release is forbidden.
5. Inspect Jordan's frozen payout. Only the labeled sample email inbox exposes his demo confirmation code. Real accounts never receive a bank-change code in the app, and an unconfigured email service leaves a replacement pending.
6. Open **Agent** for the benchmark, **Filings** for draft downloads, or **Settings → Accounting exports** for the QuickBooks CSV fallback.

The benchmark records the last evaluated run. Your actions change the sample state. To reproduce the baseline, keep the local server running and use `pnpm verify:demo --reset`; this replaces only the fictional organization and takes several minutes. Coordinate with anyone else using the shared demo first.

## Validation evidence

- [Fresh demo benchmark](demo-benchmark.json): **40/40 planted cases caught, zero false positives and zero wrongful payouts**, through HTTP, Postgres and Workflow execution, in 404 seconds. Source `680aeca`.
- Combined suite: **238 tests passed across 32 files**, including real Postgres tests. Typecheck and lint passed. The preview production build passed at source `1e36ec1`.
- [Deployed account acceptance](preview-account-acceptance.md): 56 HTTPS checks against the earlier `8d8ec80` preview.
- [Deployed Workflow acceptance](preview-workflow-acceptance.md): 21 HTTPS checks proving automatic proposal, controller release, settlement and idempotent replay against that earlier preview.
- [Current preview financial acceptance](preview-financial-acceptance.md): 31 checks over 34 HTTPS requests at `1e36ec1`. Two $1,500 prizes for a December 2025 event were paid under 2026 rules, withholding $0 and $360, with a $3,000 / $360 1099-MISC draft and four balanced journals.
- [Independent financial review, round 3](review-financial-r3.md): no high or medium findings on `81c4d73`. The two low Canadian threshold findings were fixed in `852be62`, with engine and real Postgres boundary tests.
- [Final deployment check](final-deployment.md): the `da167e0` preview built successfully; five desktop/mobile views loaded with no browser errors or horizontal overflow, and its protected API returned the settled 40/40 demo.
- [Final visual verdict](../.impeccable/review/eve-finish-review-r3.md): **`fix`**, with seven of eight assigned findings resolved. One closed-release status still truncates in the activity rail; its full text is available when expanded. This is a verdict on the listed fixes, not whole-surface approval. The two unattended correction batches are complete.
- [Implementation record](../IMPLEMENTATION.md) tracks later independent reviews and deployment validation. [Requirement coverage](requirement-coverage.md) records the implemented scope and remaining work.

## Boundaries to keep visible

Stripe recipient settlement, Duffel searches and QuickBooks company imports have not been validated against real sandbox accounts. The application uses the authorized wire, flight and CSV fallbacks. Notifications require a configured provider and the live-delivery switch; invitations currently use copyable links.

Real accounts do not yet verify email ownership, and first simulated bank enrollment does not prove ownership of that account. These are known limitations for a production rollout. Canadian and treaty rules remain visibly unverified and require a controller's recorded resolution where applicable. The internal books use USD; Canadian policy inputs and filing worksheets are labeled in CAD.

The review reports retain smaller limitations: a Canadian payout's reportable label can differ by a cent at an FX rounding boundary (the CAD filing calculation is authoritative); sponsor payments spanning a year end need further tax-date work; replacing an unverified bank change lacks a separate rejection timestamp for historical scoreboard analysis. These cases are outside the measured US sample scenarios.

This build supports one event per organization. Named backup approvers, origin-specific travel caps, automatic hybrid payout routing, official filing templates/e-filing, live sponsor portals and historical fare intelligence remain outside the completed scope. No real money was moved.
