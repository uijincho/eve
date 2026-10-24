disposition: fix

# Eve finish review, round 2 (verdict pass)

This pass scores only the eight round 1 material fixes. It is not a new full-surface or interaction review. Inputs were the 13 recaptures listed in `eve-final-manifest.md` (source `8fc803e`, fresh `:3210` server), with analysis crops taken outside the repo and the originals unchanged, plus `eve-finish-review-r1.md`, `eve-finish-fixes-r1.md`, the FORM line of `.impeccable/surfaces/eve-application.md` and `components/app/team-section.tsx`. The calling brief asked for the five contract sections, so the scored `verdict` list is in `fidelity` and `remaining` is in `material_fixes`. I did not read the live preview, the interaction states, the detector output or the craft floor; this pass does not need them.

Check 0 passed. All 13 files exist at their manifest dimensions: desktop 1440 or 1280 wide, mobile 780 wide at @2x, and the prize detail as a 1440x1000 / 780x1688 viewport sheet. Each shows the correct route and persona from the document top. No capture has a blank, loading or error region. The Next.js "N" badge is a dev tool and is excluded.

## persistence

Pass for fix 1. FORM now says no new concept roll was performed for this code-led extension. It records `seed:7aeacbad04094ab8` as historical, uncorroborated and not verified provenance, and names the pinned Blue Hour mock and DESIGN.md as the visual authority. That is the honest seed state the fix asked for.

## fidelity

Scored verdict, one line per round 1 fix:

1. **Seed provenance: resolved.** The honest FORM record is in place (see persistence).
2. **Failed checks stated as failures: resolved.** Desktop and mobile rows read "Over the $300.00 auto-approve limit: $423.81", "Under 18 at event start: age 17", "Booked 2026-10-15 after the 2026-10-10 deadline", "Over the $500.00 travel cap: $618.40" and "Matches claim C-2112 (approved)". No captured row puts a passing label next to a failing fact.
3. **Distinct claim titles: resolved.** Each escalated row now leads with its decisive failure and amount (agent limit, age, booking, travel dates, duplicate, cap). Secondary failures follow on the detail line as "Also: …". The generic "Travel claim needs a decision" title is gone from the inbox captures.
4. **Neutral Team note in the demo organization: resolved.** Settings → Team shows one muted line at 1440 and at 390, with no coral icon and no 401 text: "The sample organization has no member list, and invitations are off. Create your own organization to see and invite staff."
5. **Agent rail readable without expanding: partial.**
   - Fixed: subjects are now in sentence case, and the rail shows "Filing drafts 2026 · Drafted 2 filings" and "No new filings to draft".
   - Still open at 1440 and 1280: five consecutive entries read "Quinn Davis · payou…", so the amount is cut off and the subjects still look the same. Status lines cut at "Release approved $60…" and "Released $600.00 to ••…". "Sponsor packet …" loses its subject.
   - Still open in the four Waiting entries: they show only "Aarav Ra… / Awaiting c…", "Ishaan N…", "Rohan M…" and "Sanya M…" because the "Waiting · 6:00 AM" badge takes the width.
   - Result: neither the amount nor the status survives truncation, which was the quality the finding named.
6. **On-world checkboxes and radios: resolved.**
   - Payouts (desktop and mobile): checkboxes are rounded indigo hairline boxes, not OS gray.
   - Settings: the checked "Hybrid" radio shows a cool-white ring and dot inside a highlighted card, and "Economy only" shows a cool-white checked fill. The QuickBooks multicurrency checkbox has the same hairline box.
7. **Phone inbox actions on one line: partial.**
   - Fixed: claim rows keep Approve, Reject, Ask for info and Details on one line, and hold rows keep "Review tax rule" or "Open X's profile" plus Details on one line. The page is 25,746 px tall.
   - Still open: both "Payout frozen: bank details changed" rows at the top of the phone inbox show "Confirm new account" and "Reject change" on one line, with "Details" wrapped alone onto a second line. The finding's condition was that no single action wraps alone, and it still fails on the first two rows a phone user sees.
8. **Attendee voice and one-line task: resolved.**
   - Portal Prizes (1440 and 390) reads "What you receive as cash", "Est. net to you" and "counts toward your reportable prize total".
   - The overview task reads "Eve recommends: buy it locally · est. $909.30 cash value". That is one line at 1440 and two short lines at 390, and the deadline and chevron stay visible.

Regressions from the fix batch: none seen in the captures.
- Dropping "View evidence" from phone rows is acceptable because Details opens the evidence.
- The layout, ground, type and primary-action treatment did not move.

## ceiling

Not scored in this pass. The horizon legend, relative clock and rail summary were never requested fixes, and none were added.

## material_fixes

Still open:

1. **Fix 5 (agent rail): partial.**
   - The subject must keep the amount at 1440 and 1280, for example a person-first subject on line one ("Quinn Davis") with "payout $600.00" leading line two, or by dropping the redundant "payou…" word.
   - The status line must keep its decisive figure; trim the verb, not the number.
   - Waiting entries must not lose the person's name to the "Waiting · 6:00 AM" badge. Shorten the badge to the time, or move it to line two.
2. **Fix 7 (phone inbox): partial.** On the frozen bank-change rows at 390, fit "Details" on the same line as "Confirm new account" and "Reject change". Shorter labels work, or fold Details into the row tap, as was done for "View evidence" on other rows.

## keep

Keep the indigo ground and hairline structure, tabular Hanken numerals, one cool-white primary per view, dusk deadline dots, and the nav / horizon / inbox / evidence / agent-rail layout. Also keep the new failure-led claim titles with their "Also:" lines, the neutral Team note, the themed controls and the second-person portal copy. Fix only the rail text and the frozen-row actions, with no new layout.

disposition: fix. Fixes 1, 2, 3, 4, 6 and 8 are resolved. Fixes 5 and 7 are partial. This verdict covers only the eight scored fixes, not the whole surface.
