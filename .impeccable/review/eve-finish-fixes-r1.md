# Eve finish review round 1: changes response

Response to `.impeccable/review/eve-finish-review-r1.md`. Root resolved finding 1 (FORM seed provenance) in `7c60b16`. The UI agent resolved findings 2 to 8 in two commits on top of `a9a46ec`, both already cherry-picked into root:

- `aea3c7d`: findings 2, 3 and 4.
- `8fc803e`: findings 5, 7 and 8.

Finding 6 needed no new code (see below). The 13 captures in `eve-final-manifest.md` were retaken from that source at the same paths, viewports and personas.

| # | Finding | Resolution |
| --- | --- | --- |
| 2 | Inbox rows printed the passing check label beside a failing fact | `failedCheckText` in `lib/client/derive.ts` restates every failed check as a failure from its code and detail: "Over the $300.00 auto-approve limit: $423.81", "Under 18 at event start: age 17", "Booked 2026-10-14 after the 2026-10-10 deadline", "Business cabin, economy only", "Matches claim C-2112 (approved)", "Name mismatch: …", "Over the $500.00 travel cap: … after conversion". The check list in evidence sheets and every claim reason line (claims page, claim form result, portal claims, travel, overview) use the same wording through `claimReasonText` while a claim awaits review; once decided, the reviewer's reason shows. The server's `reason` string, which pairs pass-phrased labels with failing details, is no longer shown for pending claims. |
| 3 | 51 identical "Travel claim needs a decision" titles | Escalated claim rows are titled by their most decisive failure, ordered age, duplicate, name, evidence, cap, cabin, booking deadline, travel dates, budget, agent limit, cap proximity, receipt. Further failures follow on the detail line as "Also: …". At 390, 45 claim rows each lead with what differs. |
| 4 | Coral raw 401 in Settings → Team for the sample organization | In the sample organization, Team renders one neutral muted line and makes no member request: "The sample organization has no member list, and invitations are off. Create your own organization to see and invite staff." Coral stays for real failures in real organizations. |
| 5 | Agent rail entries indistinct and truncated | `runSubject` and `runLine` give each run a sentence-case subject with the person and amount or the filing year ("Quinn Davis · payout $600.00", "Filing drafts 2026", "Sponsor packet · Hayden Young $1,000.00"). The person comes from any step of the run, since workflow resumes have none. The status line survives truncation ("Awaiting controller release $350.00", "Released $600.00 to ••9625", "Release queued …"). "0 filing(s)" now reads "No new filings to draft"; otherwise "Drafted 2 filings". The full summary stays in the expanded steps and in the line's title attribute. |
| 6 | OS-gray checkboxes and radios on payouts and settings | No code change was needed. `app/globals.css` (in `main` since `3208570`) already draws every radio and checkbox from the palette: `appearance: none`, a Field Edge (#626aa8) hairline, Cool White fill with an indigo check or dot when checked, Border when disabled, and the global Pale Halo focus outline (radio cards use a label ring). The reviewed captures came from the root `:3000` dev server, which was serving a stale CSS chunk without those rules (measured: `appearance: auto`). A fresh `:3210` server with a cleared `.next` serves them (measured: `appearance: none`, border rgb(98,106,168), checked fill rgb(236,238,248) with the check mark). Root will restart `:3000` with only `.next` cleared, and the Vercel build is fresh. The new payouts and settings captures show the resolved controls. |
| 7 | "Details" wrapped alone on each phone inbox row | Phone rows drop the separate "View evidence" button, because "Details" opens the full item, whose action pane carries "View evidence". Desktop rows and the detail pane are unchanged. Measured at 390: all 45 claim rows keep Approve, Reject, Ask for info and Details on one line. The page shrank from 31,986 to 25,746 px. |
| 8 | Attendee prize view spoke about Priya; overview task held the full rationale | `PrizeComparison` takes `self` in the attendee portal: "What you receive as cash", "Est. net to you", "counts toward your reportable prize total" (and the in-kind equivalents). The organizer view keeps the name. The overview task now reads "Eve recommends: buy it locally · est. $909.30 cash value"; the reasoning stays on Prizes. |

Kept: the layout, Blue Hour tokens, one cool-white primary per view, and the dusk deadline colors. No ceiling items (horizon legend, relative clock, rail summary) were added. The detector was not rerun.

## Test scope

- Client unit tests: 37 pass (`pnpm vitest run tests/client-*.test.ts`). New cases cover the failed-check wording (agent limit, age, cabin, cap after conversion, booking deadline), inbox titles and details led by the decisive failure, and agent-rail subjects and lines including "No new filings to draft". Typecheck and lint are clean.
- Keyboard, on the fresh `:3210` server:
  - Settings radios move with the arrow keys (Hybrid → Sponsor packet) and show the label focus ring.
  - A payouts checkbox toggles with Space, keeps a solid focus outline, and shows the Cool White fill and mark.
  - The phone inbox Details button is reachable in each row.
- Captures: all 13 files were retaken and each was opened once. Routes, personas and the top of each page are correct, and nothing is blank, loading or erroring. The shared demo database was not mutated.
