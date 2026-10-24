# Eve finish review round 2: changes response

Response to `.impeccable/review/eve-finish-review-r2.md`, which left fixes 5 and 7 partial. Code: `7ea6dc2` and `a60a3cd` (both integrated into root). Captures: the same 13 files and viewports in `eve-final-manifest.md`, retaken from `a60a3cd` on a fresh `:3210` dev server against the settled shared demo database, with no mutations. The six fixes already resolved (2, 3, 4, 6, 8 and the finding 1 documentation) are unchanged.

| # | Round 2 finding | Resolution |
| --- | --- | --- |
| 5 | Agent rail titles truncated the amount; status lines cut their figures; the "Waiting · 6:00 AM" badge squeezed the name | Each entry is now two lines. Line one is the subject name, which may truncate, with the amount right-aligned and non-shrinking in tabular figures ("Quinn Davis $600.00", "Hayden Young $1,000.00"); the redundant "payout" word is gone. Line two is a short status that keeps its figure ("Paid $600.00 · ••9625", "Approved $600.00", "Release queued $…", "Drafted 2 filings", "No new filings to draft", "Awaiting controller"), followed by the badge. The waiting badge shows only its time ("6:00 AM", announced as "Waiting until 6:00 AM"), so it no longer competes with the name. The sponsor packet entry is subjected by the person with the requested amount, and its status leads with the shortfall ("Sponsor short $30.00 · paid $970.00"). Run grouping, order and behaviour are unchanged; the full summary stays in the expanded steps and in the line's title. |
| 7 | The two frozen bank-change rows at 390 wrapped "Details" alone | Phone rows pass Details into the bank-change control's own button row. The concise phone labels "Confirm account" and "Reject" are each the button's accessible name, so label-in-name holds. The pane and desktop keep "Confirm new account" and "Reject change". Measured at 390: both frozen rows show "Confirm account \| Reject \| Details" on one line, and Details opens the item sheet with "View evidence". When verification is locked for a persona, the locked button keeps Details beside it. |

Known remainder, stated rather than hidden: at 1440 and 1280, the one escalated sponsor-packet entry still truncates its status line to "Sponsor short $3…" beside the wider "Escalated" badge. The person and the $1,000.00 amount on line one are intact, and the full text is in the line's title and the expanded step. The waiting entries' "Awaiting controller" fits completely.

## Test scope

- Client unit tests: 37 pass. The agent-rail cases cover the subject with an intact amount, "Awaiting controller", "Paid $600.00 · ••9625" and "No new filings to draft". Typecheck and lint are clean.
- Measured on the fresh server at 390: the frozen rows fit on one line, and every claim row (45) still fits on one line. The two multi-line rows are the batch release, which wraps its lock reason, and the prize hold, both unchanged holds.
- Captures: 13 files. The three inbox captures changed; the other ten re-rendered byte-identical, as expected. Each file was opened once: correct route and persona, top of page, no blank, loading or error state.
