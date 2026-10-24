disposition: fix

# Eve finish review, round 1

Not read or not verified: the live preview URL, interaction states (hover, focus order, agent rail collapse, motion), and the seed roll output, which was not in the packet. The review used the 13 captures, the manifest, the critique reference, the surface brief, the craft floor's Refuse list, and spot reads of `lib/engines/policy.ts`, `components/app/prize-comparison.tsx` and `app/api/members/route.ts` to locate sources. The detector result `[]` ran at `702af19`, and `git diff 702af19 680aeca -- components app lib/client` is empty, so it covers the reviewed code.

Check 0 passed. All 13 captures exist, use the right routes and personas, show no blank or loading regions and start at the document top. The mobile captures are 780 px wide, and the prize detail is the viewport sheet. The Next.js "N" badge is excluded as a dev tool. It covers part of the persona select at desktop (lower left) and some text at mobile; this has no product impact.

## persistence

Status: pending until the seed is corroborated.

- PRODUCT.md, DESIGN.md and `.impeccable/design.json` exist. This is an extension, and DESIGN.md predates the build.
- The build is code-led, so `.impeccable/build/` is not expected.
- `.impeccable/mocks/` holds only `decision/`, which is exempt, so no approval record is owed.
- FORM carries `seed:7aeacbad04094ab8` (16 hex characters). `impeccable concept-seed --check-seed seed:7aeacbad04094ab8` exited 1 here with SEED UNKNOWN. The roll output was not in the packet, so neither source corroborates the seed (see fix 1).

## fidelity

The build is code-led. The Blue Hour PNG is a critique reference, not a spec, so the rows below are judged against the OWN-WORLD and FIRST VIEWPORT promises.

| Element | Verdict | Evidence |
| --- | --- | --- |
| TYPE | match | Hanken Grotesk throughout. Amounts use tabular figures, right-aligned, in the inbox, payouts, the prize sheet and the portal. Monospace appears only for rule IDs (`us-nonus-prize v1`), which is data, not costume. |
| MATERIAL | contradicted (form controls only) | Hairline structure with no page shadows holds everywhere. Native checkboxes and radios render as OS gray (neutral, not indigo) squares and circles in the payouts selection column (desktop and mobile) and the Settings "How money moves" radios. These are off-world chrome on the controller's main surface. |
| GROUND | match (judged by eye, not sampled) | The deep indigo field and the darker rail and header bands read the same as the reference on every capture. There is no drift toward slate or cream. |
| Left navigation rail | match | Compact, with counts, a "Sample data" tag and an event card. On phones it becomes a hamburger plus breadcrumb, as promised. |
| Deadline horizon before the inbox | match at desktop; adaptation at 390 | Desktop labels (Jordan +12, Noah +52, Sponsor) sit on a log scale from Now to 2 weeks. On mobile the dots have no labels. The packet cites the prior label pile-up fix, but the dots now carry no meaning on a phone. |
| Inbox rows | contradicted (truth and scanability) | 51 of 67 rows are titled "Travel claim needs a decision". Their reason lines state the passing check label beside a failing fact: "Within the agent's auto-approve limit: $423.81 against a $300.00 limit.", "18 or older at event start: Age 17 on 2026-10-24.", plus the same pattern for booking, cabin and duplicate checks. The source is `lib/engines/policy.ts:311`: the label is pass-phrased, and the row prints it with the detail for failures. This breaks the THESIS ("few decisions… legible") and STORY ("understand what needs attention"). |
| Evidence pane beside the selection | match (1440 and 1280) | Simulated tag, gross/withholding/fees/net ladder, code entry, cool-white "Confirm new account", disabled reason. The 1280 pane fits without clipping. |
| Collapsible agent rail | contradicted (content) | The structure and collapse icon are present. Entries read "Payout", "Payout", "Payout", lowercase "filings" twice, "Drafted 0 filing(s) for 2…", and four "This exact…" truncations. A reader cannot tell runs apart or learn anything from the rail. |
| Cool-white primary action | match | "Confirm new account", "Release all 115", "Sign your W-8BEN": one per view. Mobile inbox rows use the indigo-filled secondary for Approve/Confirm, which is acceptable at row level. |
| Deadline color | match | Dusk dots and dates. Coral means frozen or blocked. Mint is unused in these captures. |
| Prize detail sheet | match | Needs-form status, deadline, cash ladder, recommendation table, fulfilment options, and a locked "Propose payout" with the reason "Held until Priya signs the W-8BEN." The mobile sheet scrolls inside its panel. |
| Payouts table | match, apart from the controls | Tabular columns, est. FX secondary line, net in bold, due color, and a release summary that reconciles with the inbox batch ($21,518.01 − $480.00 = $21,038.01). |
| Settings, Team | contradicted (color semantics) | A coral warning icon and "Sign in with your account to view members." show on desktop and mobile. This is the expected demo state, already explained neutrally in the line below it. OWN-WORLD reserves coral for blocked or critical, and STORY wants disabled things explained, not raised as errors. The text is the raw 401 message from `app/api/members/route.ts:9`. |
| Portal voice | contradicted | Priya's own portal reads "What Priya receives as cash", "Est. net to Priya" and "counts toward Priya's reportable prize total". The organizer copy from `components/app/prize-comparison.tsx:42` is reused for the attendee. |
| Portal overview task row | contradicted (density) | "Choose how to receive your MacBook Air" carries the full 6-line recommendation paragraph on desktop and 12 lines on mobile inside a to-do row, burying the deadline and the chevron. |
| Mobile inbox actions | adaptation with a defect | Actions are reachable and unclipped, as promised. In every row the fifth action, "Details", wraps alone onto a second line, which adds about 90 px per row across 67 rows (31,986 px page). |
| Portal messages | minor | One notice appears twice (email and portal copies) with the same title and body. |

## ceiling

- **Horizon legend.** The reference ties dusk hues to time bands (over a week / this week / 2 days / today / within the hour). The build uses deadline color on dots and dates but never shows the scale, so the color's meaning stays implicit.
- **Relative deadline.** The reference pairs each date with "in 2 days" or a countdown. The build shows only "• Oct 27", so urgency between rows is not scannable at a glance.
- **Rail summary line.** The reference's footer ("23 claims auto-approved · 4 escalated · 0 payouts released. The agent cannot release money.") turns the rail into evidence. The build keeps only the last sentence plus raw counters ("Waiting 154").

## material_fixes

1. **Contract.** Corroborate `seed:7aeacbad04094ab8` against the original roll output, or run `--check-seed` on the machine that rolled it. If neither confirms it, record the honest seed state in FORM. This is paperwork, not pixels, but it is open.
2. **Truth.** In inbox rows (desktop and mobile), print the failed check in its failed form, e.g. "Over the $300.00 auto-approve limit: $423.81", "Under 18 at event start: age 17", "Booked after the 2026-10-10 deadline", "Business cabin, economy only", "Matches claim C-2113". No row may state the passing condition next to the failing fact.
3. **Scanability.** Use that failed-check phrase as the row title, so 51 identical "Travel claim needs a decision" rows each lead with what makes them different. The sample row "Travel claim above the $300 auto-approve limit" in `lib/design/sample.ts:112` already shows the intended pattern.
4. **Color semantics.** Settings Team: replace the coral warning and raw 401 text in the demo organization with a neutral muted line ("The sample organization has no member list; create your own organization to see and invite staff."), merged with the invitation line. Keep coral for real failures only.
5. **Agent rail.** Give each entry a distinct subject (person or packet, plus the amount or count) in sentence case. Show a description that survives truncation ("Quote changed, re-quoted $1,050.00"), and fix "0 filing(s)". The rail must be readable without expanding every row.
6. **Material.** Theme checkboxes and radios to the world (indigo hairline box, cool-white check or dot, visible focus) on payouts and settings, e.g. `accent-color` plus border tokens, replacing the OS gray.
7. **Mobile inbox.** Fit each row's actions on one line at 390 by moving the secondary action ("Details" or "View evidence") into the other, so no single action wraps alone.
8. **Portal.** Use second person in the attendee view of the prize comparison ("What you receive as cash", "Est. net to you", "your reportable prize total"). Cut the overview task row to a one-line summary ("Eve recommends buying it locally · est. $909.30 cash value") and leave the rationale on Prizes.

## keep

The indigo ground and hairline structure, tabular Hanken numerals, one cool-white primary per view, dusk deadline dots, and the nav / horizon / inbox / evidence / agent-rail layout that already holds at 1440 and 1280. Fix copy and controls inside it; do not add cards, color or new layout.
