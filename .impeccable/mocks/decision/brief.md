# Shared brief for Eve decision sketches

You are writing ONE desktop mockup (HTML sketch) of Eve's organizer **Inbox**, the app's home page, in one assigned visual direction. Five sketches of the same screen are being written in parallel, one per direction, and the user will pick the visual world for Eve's design system from them. Same content, different world, so the comparison is fair.

Read /Users/evanyu/calhacks/PRODUCT.md for product truth (skim). Eve is an event finance agent: organizers set policy, attendees submit receipts and claim prizes, the agent prepares and explains, and a human controller releases money. The inbox shows only what needs a human, ranked by urgency.

## Hard file constraints
- One self-contained HTML file at the path you are given. Inline `<style>`, **no JavaScript**, nothing fetched except Google Fonts via `<link>`. Under 200 lines (dense lines are fine, minified is not).
- First viewport only: `html, body { width: 1440px; height: 900px; overflow: hidden; margin: 0 }`. Everything you show must fit in 1440 x 900 and nothing may be cut off awkwardly mid-row (clip cleanly at a row boundary or use a quiet fade-free crop by the bottom edge).
- No emoji. No gradients, glassmorphism, glows, drop-shadow theatrics, or decorative blobs. Icons only as tiny inline SVG (under 24px, a few paths) or none.
- Standard web controls only: nav that reads as nav, tabs, buttons, selects, a search input, rows/tables. The direction's world contributes **type, palette, density, and ONE signature move**. It never supplies the layout or turns controls into a costume.
- Money in tabular figures (`font-variant-numeric: tabular-nums`), right-aligned in amount columns. Keep a consistent 4/8px spacing rhythm, a real type scale, and aligned grid edges. Finish bar: the best product in the category (Linear, Ramp, Mercury, Stripe Dashboard level of craft).
- Body text at least 13px; secondary meta at least 12px. Contrast must pass WCAG AA for text.
- A small, quiet "Sample data" label in the shell (the content is synthetic).
- The decision page previews the file as a skeleton (text under 22px becomes bars), so composition, colour fields, and the larger type must carry the direction at thumbnail size. The user can also open the file at full size, so the copy must read well too.

## Shell content (same in every sketch)
- Product wordmark: **Eve**. Org/event switcher: **Cal Hacks 13.0** · Oct 24–26, 2026 · UC Berkeley.
- Nav items: Inbox (count 7), Claims, Prizes, Payouts, People, Budget, Sponsor, Audit trail, Filings, Agent, Settings.
- Signed-in user: **Dana Whitfield**, Organizer. (The controller is **Ari Novak**.)
- Now: Sunday Oct 26, 1:42 PM. Batch release scheduled 2:00 PM. Closing ceremony 3:00 PM.

## Page header
- Title: **Inbox**. Subline: "7 items need you. Eve auto-approved 23 in-policy claims today ($4,812.60)."
- Filter tabs: All 7 · Approvals 3 · Holds 2 · Exceptions 2. Sort control: "Sort: Urgency". A search input is optional.

## Inbox items (ranked by urgency; show as many as fit cleanly, at least the first 5)
1. **Payout frozen: bank details changed.** Jordan Okafor · 2nd place, Best Hardware Hack. CAD account ••4471 changed to ••9902 at 1:24 PM, 36 min before batch release. Eve emailed Jordan's original address to confirm and froze the payout. Amount $1,500.00. Due before 2:00 PM release (18 min). Actions: Keep frozen · Mark verified · View evidence. State: critical.
2. **Prize to a winner in Canada: MacBook Air.** First Overall · Priya Raman, Toronto, ON. Item FMV $1,299.00. Needs a W-8BEN (sent 1:31 PM, not signed yet). Default withholding 30% = $389.70 (Canada treaty rate unverified). Eve recommends **cash equivalent**: shipping + duty estimate $214 (estimate), buy-local CA$1,849 (≈ $1,338). Cash nets an estimated $909.30 after withholding. Due before closing ceremony 3:00 PM (1 h 18 min). Actions: Accept recommendation · Compare options · Ask winner.
3. **Payout batch #4 is ready for release.** 18 payouts · $12,450.00 gross · $1,124.70 withheld · est. fees $38.20. Release is **disabled for Dana** with the reason: "You requested this batch. A controller must release it (Ari Novak)." Due 2:00 PM (18 min). Actions: Release batch (disabled) · Remind Ari.
4. **Travel claim above the $300 auto-approve limit.** Marcus Lee · YYZ → SFO, Air Canada, economy. CA$679.40 → $495.12 (FX 0.72876, ECB, Oct 3). Cap $500 (Canada). Checks passed: name, dates, economy, under cap, no duplicate. Flag: within 1% of cap. Due Oct 28. Actions: Approve · Reject · Ask for info.
5. **Sponsor paid $970.00 on a $1,000.00 request.** Packet SP-0112 · Bayview Community Foundation (fiscal sponsor). Remittance shows a $30.00 wire fee deducted. Reconciliation exception, not closed. Due Oct 31. Actions: Accept with fee · Query sponsor.
6. **W-8BEN expired; stipend on hold.** Lukas Becker, Munich, DE · Judge stipend $250.00. Form signed 2022, lapsed Dec 31, 2025. Eve chased Oct 20 and Oct 22; next chase Oct 29. Due Oct 29. Actions: Send now · View chase log.
7. **Duplicate receipt held.** Sam Ortiz · Lyft $38.20 submitted twice (C-2231, C-2240). Eve approved the first and held the second. Due Nov 2. Actions: Reject duplicate · View both.

## Optional side context (use if your layout has a second column)
- Selected item detail (Priya's prize): gross $1,299.00 → withholding −$389.70 → fees $0.00 → est. net $909.30; rule "US → non-US individual, prize, 30% default, v2, treaty rate unverified"; "Eve prepares and explains. A human controller signs."
- Travel budget: $38,420 spent · $9,200 committed · $12,380 remaining of $60,000.
- Agent today: 23 claims auto-approved · 4 escalated · 0 payouts released (the agent cannot release money).

Write only the one file you are assigned. Do not touch any other file. When done, reply with the file path and a 2-line description of the composition.
