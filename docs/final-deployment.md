# Final preview verification

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
