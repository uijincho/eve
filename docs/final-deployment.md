# Final preview verification

## Browser QA deployment

Current deployment: [Eve preview](https://eve-calhacks-bnzqx9gf8-badbird5907s-projects.vercel.app), application source `81ae42a`, built October 24, 2026 at approximately 06:42 Pacific. Vercel’s production build passed; deployment protection remains enabled. Later commits are reports and documentation. No production-domain promotion was made.

A protected `/api/app` read and the local `http://localhost:3000/api/app` both returned HTTP 200 after deployment: 300 people, 160 claims, 25 awards, and the saved scoreboard of 40/40 caught, zero false positives and zero wrongful payouts. These were reads of the preserved benchmark, not another reset or benchmark run.

The [final sponsor browser recheck](browser-qa-sponsor-settlement-final.md) passes on this exact deployment: two new CAD packets, correct full and shortfall settlement amounts, balanced journals and verified cleanup. Two minor presentation observations remain in that report.

The [final accessibility addendum](browser-qa-accessibility-final-addendum.md) independently verifies the last four corrections on this exact deployment, with no script errors. The [browser QA index](browser-qa-summary.md) links the complete US, Canadian, receipt, team, route and recovery evidence and its source builds. Earlier reports are retained below as historical proof, not presented as reruns of the final application.

## Original overnight preview (historical)

Deployment: [Eve preview](https://eve-calhacks-hj2fnowlg-badbird5907s-projects.vercel.app), source `da167e0`, built October 24, 2026 at approximately 05:41 Pacific. Later report and screenshot commits do not change application code. Vercel's production build and TypeScript check passed; deployment protection remains enabled.

At approximately 05:42 Pacific, headless Chromium opened the protected deployment using the authenticated Vercel CLI's temporary bypass cookie. This did not disable protection or change project settings. The browser loaded these settled routes:

| Route | Persona | Viewport | Result |
| --- | --- | --- | --- |
| `/` | Sample organizer | 1440 × 1000 | Loaded; names, amounts and sponsor shortfall visible in the rail |
| `/settings` | Sample organizer | 1440 × 1000 | Loaded; themed radios and neutral sample-Team note |
| `/payouts` | Sample controller | 1440 × 1000 | Loaded; themed checkboxes and persisted payout amounts |
| `/` | Sample organizer | 390 × 844 | Loaded; frozen-account row actions fit together |
| `/portal` | Priya's sample attendee | 390 × 844 | Loaded; own prize, tasks and messages |

All five returned HTTP 200, with no browser page errors or horizontal document overflow. Each screenshot was opened and checked. Evidence is in `.impeccable/review/eve-preview-final-{inbox-desktop,settings-desktop,payouts-desktop,inbox-mobile,portal-mobile}.png`. These are viewport captures, at device scale 1. The full 13-screen visual-review packet is separate and has its own source manifest.

The protected `/api/app` returned HTTP 200 with 300 people, 160 claims, 25 awards, and the previously measured scoreboard of 40/40 caught and zero wrongful payouts. This was a read of the settled benchmark, not a new benchmark run. Only sample persona cookies and navigation were used; no claim, prize, bank, payout or financial record was changed.

The latest financial HTTPS acceptance remains the [31-check payment-year run](preview-financial-acceptance.md) on source `1e36ec1`; that report does not claim to cover the later Canadian threshold correction or UI changes. The Canadian correction has separate real-Postgres boundary tests. This browser check verifies the final deployment's presentation and reads, not a second financial acceptance run.

T3's preview had already failed twice with `Preview automation snapshot timed out after 15000ms.` The established headless Chromium fallback was used. No production-domain deployment was made; use the preview link above, not the older production alias.
