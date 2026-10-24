disposition: fix

# Eve finish review, round 3 (final verdict pass)

This pass scores the two fixes round 2 left partial (5 and 7) and checks that the six resolved fixes (1, 2, 3, 4, 6, 8) still hold. It is not a whole-surface, interaction or ceiling review.

Inputs:
- The 13 captures in `eve-final-manifest.md`. The three inbox files were cropped outside the repo so I could read the actual rail at 1440 and 1280 and both frozen rows at 390. The originals are unchanged.
- `eve-finish-review-r1.md`, `eve-finish-fixes-r1.md`, `eve-finish-review-r2.md` and `eve-finish-fixes-r2.md`.
- The FORM line of `.impeccable/surfaces/eve-application.md`.
- `git diff` scope checks on the fix batch, plus one spot read of `lib/client/derive.ts:561` to identify a truncated string.

Not used: the live preview, interaction behavior (I could not see what Details opens from a still capture), and the detector, which ran at `702af19` and does not cover this batch. I did not reread the craft floor because this pass does not need it.

Check 0 passed:
- All 13 files exist at their manifest dimensions. Desktop is 1440 or 1280 wide, mobile is 780 wide at @2x, and the prize detail is a 1440x1000 / 780x1688 viewport sheet.
- Each capture shows the correct route and persona, starts at the document top, and has no blank, loading or error region.
- `git diff 6ad750d da167e0` touches no code; only captures and docs differ, so the captures match the root code.
- `git diff fe74495 HEAD` shows only the three inbox PNGs changed. The other ten are byte-identical to the round 2 captures.
- The Next.js "N" badge is a dev tool and is excluded.

## persistence

Pass, so fix 1 still holds. FORM still says no new concept roll was performed for this code-led extension. It records `seed:7aeacbad04094ab8` as historical and not corroborated, and names the pinned Blue Hour mock and DESIGN.md as the visual authority.

## fidelity

Scored verdict, one line per round 1 fix:

1. **Seed provenance: resolved, preserved.** See persistence.
2. **Failed checks stated as failures: resolved, preserved.** The new inbox captures still read as failures:
   - "Over the $300.00 auto-approve limit: $423.81"
   - "Over the $500.00 travel cap: $618.40"
   - "Travel outside the event dates: Travel 2026-10-02; allowed 2026-10-21 to 2026-10-27"
   - "Matches claim C-2112 (approved)"

   This holds at 1440, and the phone rows match. The batch's code diff touches only the rail run-line functions in `derive.ts`, the agent feed, the inbox view, the item actions and the verify-code control. It does not touch claim copy.
3. **Distinct claim titles: resolved, preserved.** Rows lead with their failure and amount, and secondary failures follow as "Also: …" ("Also: Over the $300.00 auto-approve limit: $618.40", "Also: Close to the travel cap…").
4. **Neutral Team note: resolved, preserved.** At 1440 and 390, Settings → Team shows one muted line with no coral and no 401 text: "The sample organization has no member list, and invitations are off. Create your own organization to see and invite staff."
5. **Agent rail readable without expanding: partial, now narrow.** I read the rail crops at 1440 and 1280; both show the same entries.
   - **Fixed: names and amounts.** Every name and amount is whole and right-aligned in tabular figures: "Quinn Davis $600.00" (×5), "Hayden Young $1,000.00", "Aarav Rao $96.68", "Ishaan Nair $51.72", "Rohan Menon $51.73", "Sanya Menon $28.70".
   - **Fixed: status figures.** Status lines keep their figures: "Approved $600.00", "Paid $600.00 · ••9625", "Paid $600.00 · ••1246", "Drafted 2 filings", "No new filings to draft".
   - **Fixed: sponsor packet.** It now reads "Hayden Young $1,000.00 / Short $30.00", with "Escalated" beside it. The shortfall is whole.
   - **Fixed: waiting entries.** All four show their full name, "Awaiting controller", and the badge cut to "6:00 AM", so the badge no longer squeezes the name.
   - **Still open:** the second rail entry reads "Quinn Davis $600.00 / Release request close…" at 1440 and 1280. The source string is "Release request closed; quote changed" (`lib/client/derive.ts:561`). The truncation cuts the outcome mid-word and hides the reason.
   - **Why it is still partial:** round 1 named this exact case as the standard ("Quote changed, re-quoted $1,050.00" survives truncation). The fixes response says every collapsed entry shows its figure whole. That is true only because this entry has no figure; it still cannot be read without expanding. 11 of 12 visible entries now pass, so the fix is partial, not resolved.
   - **Not counted against the fix:** at 1280x800 the rail ends inside its scroll area at "Rohan Menon". That is the rail's scroll container, not a truncation.
6. **On-world checkboxes and radios: resolved, preserved.**
   - Payouts at 1440: the header and row checkboxes are indigo hairline boxes.
   - Settings at 1440 and 390: the "Hybrid" radio has a cool-white ring and dot inside a highlighted card, and "Economy only" has a cool-white checked fill.
   - The QuickBooks multicurrency checkbox uses the same hairline box.
7. **Phone inbox actions on one line: resolved.** At 390 (780 px @2x), both "Payout frozen: bank details changed" rows (Jordan Okafor $1,500.00 and Ruby Kelly $1,000.00) show "Confirm account | Reject | Details" on one line under the code field. Nothing wraps alone.
   - Claim rows keep "Approve | Reject | Ask for info | Details" on one line.
   - Hold rows keep "Open X's profile | Details" on one line.
   - The shorter phone labels are acceptable: the desktop pane keeps "Confirm new account", "Reject change" and "View evidence".
   - That Details still opens the evidence is the worker's claim; a still capture cannot show it.
8. **Attendee voice and one-line task: resolved, preserved.**
   - Portal Prizes at 1440 and 390 reads "What you receive as cash", "Est. net to you" and "counts toward your reportable prize total".
   - The overview task reads "Eve recommends: buy it locally · est. $909.30 cash value". That is one line at 1440 and two short lines at 390, and the Oct 25 deadline and chevron stay visible.
   - The organizer's prize sheet correctly stays in third person ("What Priya receives as cash").

Regressions from this fix batch: none seen.
- The phone frozen-row button keeps the indigo-filled secondary treatment.
- The desktop evidence pane keeps one cool-white primary ("Confirm new account").
- The rail keeps its hairline cards, "Done" / "Escalated" badges and footer line "The agent cannot release money."
- Layout, ground and type did not move.

## ceiling

Not scored in this pass. The horizon legend, relative clock and rail summary from round 1 were never requested fixes, and none were added.

## material_fixes

Still open:

1. **Fix 5 (agent rail): partial.**
   - The problem: the closed-release status "Release request closed; quote changed" truncates to "Release request close…" at 1440 and 1280.
   - What a fix must do: the outcome and reason must fit in the collapsed line beside the "Done" badge, by putting the reason first and dropping the redundant words.
   - One option: "Quote changed; closed". That fits the space the other entries' statuses use, such as "Awaiting controller".
   - It is a one-string change. The fix stays partial until a recapture shows it whole at both widths.

## keep

Keep:
- The indigo ground and hairline structure.
- Tabular Hanken numerals.
- One cool-white primary per view.
- Dusk deadline dots.
- The nav / horizon / inbox / evidence / agent-rail layout.
- The two-line rail entry with the name truncating, the amount fixed, and the status plus badge on line two.
- The phone frozen-row action line.
- The failure-led claim titles with their "Also:" lines.
- The neutral Team note, the themed controls and the second-person portal copy.

Change only the one rail status string.

disposition: fix. Fixes 1, 2, 3, 4, 6, 7 and 8 are resolved. Fix 5 is partial: one rail status still truncates. This verdict covers only the eight scored fixes, not the whole surface, and makes no claim about the live preview or about later detector coverage.
