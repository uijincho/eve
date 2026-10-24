# Final validation record

## Browser QA follow-up, October 24, 2026

Current application source: `81ae42a`, deployed to [the protected preview](https://eve-calhacks-bnzqx9gf8-badbird5907s-projects.vercel.app). Later commits contain reports and documentation. See the [QA index](browser-qa-summary.md) for the journeys and all source-specific reports.

| Check | Result | Scope |
| --- | --- | --- |
| Combined Vitest suite | **273 passed, 37 files**, no skips, 576.18 seconds | Real Postgres enabled; source `dfbf030`, started 06:27:56 Pacific. |
| Sponsor destination correction | **4 new database tests and 2 existing sponsor regressions passed** | Later correction `f47017c`; full and shortfall amounts, USD/CAD, PDF input, fees and balanced journals. The broad suite was not rerun after this correction. |
| Final presentation and permission checks | **104 passed across 5 files** | Sponsor render, permissions, portal, client derivations and engines after the final changes. Sponsor render then passed 3/3 after its overpayment assertion. |
| Typecheck and lint | Passed | Final application source; Next route types generated first. |
| Vercel production build | Passed | Preview source `81ae42a`; protection retained. |
| Browser route matrix | **19 routes at 1440/390/320**, 38 axe runs | Earlier route report; defects were rechecked on later builds, not counted as passes on the original build. |
| Final preview and local API | **HTTP 200 on both** | Preserved sample: 300 people, 160 claims, 25 awards; saved 40/40 benchmark, zero false positives and wrongful payouts. |
| Final sponsor browser flows | **Full and shortfall settlement passed** | Exact `81ae42a` preview: PDF, recorded net/fee/CAD amounts, controller note, one journal each and balanced ledger; [report](browser-qa-sponsor-settlement-final.md). |
| Final accessibility fixes | **All four passed** | Independent `81ae42a` preview addendum: internal table scroll at 200% text, links, visible selected phone tab, forced-color outlines. |

The financial and account journeys are linked from the QA index, including their deliberate authorization probes and fixture-setup exceptions. Money, bookings and physical fulfillment remain simulated. A real screen reader and real Windows High Contrast were not tested.

All QA fixtures were cleaned up. Independent root reads confirm zero `orgtest_` organizations, zero `eve-browserqa-*` organizations and zero matching auth users; the retained Canadian credentials file is absent. The shared sample and local durable-workflow state were preserved. The final sponsor report retains two minor presentation observations rather than claiming every surface is flawless.

## Original overnight handover (historical)

Completed October 24, 2026, approximately 05:49 Pacific. The delivered application source is `da167e0`; subsequent commits contain only reports, documentation and screenshots.

| Check | Result | Scope |
| --- | --- | --- |
| Combined Vitest suite | **245 passed, 34 files**, 597.06 seconds, no skipped tests | Database configured; real Postgres suites ran. Started at `bf36ac8`, 05:38:35 Pacific. |
| Final rail-copy follow-ups | **30 client-derive tests passed** | `443ea2b` and `da167e0` followed the combined run's start; these presentation helpers were checked separately after each change. No financial code changed during the run. |
| Typecheck | Passed | `next typegen` followed by `tsc --noEmit`, final application source |
| Lint | Passed | Final application source |
| Vercel production build | Passed | Protected Preview at `da167e0`; [deployment evidence](final-deployment.md) |
| Final preview browser | Five settled views passed | Three desktop and two mobile views; no page errors or horizontal document overflow |
| Final local browser | Passed | `localhost:3000`; API 200, 300 people, scoreboard 40/40, neutral Team message and themed controls |
| Measured demo benchmark | **40/40 caught, 0 false positives, 0 wrongful payouts** | Earlier fresh reset/run at `680aeca`, [saved evidence](demo-benchmark.json). Final checks read that settled state; they did not rerun or reset it. |
| Deployed financial acceptance | 31 checks over 34 HTTPS requests | Earlier `1e36ec1` preview, [report](preview-financial-acceptance.md). Account and workflow reports cover another 56 and 21 checks on `8d8ec80`. |
| Final visual verdict | **fix: seven of eight resolved** | [Scoped verdict](../.impeccable/review/eve-finish-review-r3.md). One closed-release rail status still truncates. No whole-surface pass is claimed. |
| Design documentation | Completed; incumbent system preserved | [Documenter report](../.impeccable/review/eve-design-documentation.md). Existing context drift and component documentation debt are reported, not silently rewritten. |

The combined run emitted node-postgres's deprecation warning about concurrent queries on one client. It did not fail a test; future compatibility with pg 9 has not been validated.

## Cleanup and preserved state

The suites removed their disposable organizations. Two older interrupted-run fixtures were also removed through the guarded demo-org purge after checking their exact ids, names, creation timestamps, expected fixture members, synthetic email domains, lack of auth-user links, lack of agent jobs and absence of processing payouts. Only those two exact organizations were targeted. A final query found **zero `orgtest_` organizations**. No real account or shared-demo record was removed.

The final preview browser's temporary authentication cookie was deleted. It was never committed or printed. Preview protection remains enabled. The local demo server remains running on port 3000, with its database and durable workflow state preserved.

Money movement, flight bookings and physical fulfillment remain simulated; filing documents remain drafts. See [requirement coverage](requirement-coverage.md) and the [handover](overnight-handover.md) for remaining integration, account-verification and jurisdiction limits.
