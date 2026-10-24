# Browser QA addendum: the four LOW accessibility recommendations

- **Scope:** an independent recheck of only L-A to L-D from [`browser-qa-final-verification.md`](browser-qa-final-verification.md). The route matrix, the axe sweep and the earlier fix list were not rerun. No visual or design review was done, and the Impeccable launcher and detector were not run.
- **Build:** preview `eve-calhacks-bnzqx9gf8-…` (source `81ae42a`), status Ready. Checked at about 13:42–13:44 UTC on 2026-10-24.
- **Browser:** headless Chromium shell 1248 (Playwright-core). I tried the T3 in-app preview first. `preview_open` redirected to `vercel.com/login` (Vercel SSO), the same wall the earlier rounds hit, so I switched to the fallback.
- **Access:** Vercel protection stayed on. I got a `_vercel_jwt` bypass cookie through `vercel curl --deployment … -H 'x-vercel-set-bypass-cookie: true'` into a mode-600 jar in a mode-700 directory. It was never printed. I signed in through the `/login` persona picker as Dana Whitfield (Organizer).
- **Mutations:** none. Tab changes only change the URL query. The export link was read with a GET request and not clicked. No accounts were created.

## Verdict

**Pass. All four recommendations are fixed on the deployed preview.** I found nothing new and nothing severe. There were 0 page errors.

## Results

| ID | Check | Result | Measurement |
| --- | --- | --- | --- |
| L-A | Text-only 200% at 1280, `/claims` and `/payouts` | **PASS** | The region wrapper now computes `position: relative`. The document `scrollWidth` is **1280 on both routes** (it was 1412 and 1659). The region still scrolls: 830 of 1151 on `/claims` and 830 of 1399 on `/payouts`. I focused the region and pressed ArrowRight 60 times. The region stopped at its end (`scrollLeft` 321 and 569, equal to the maximum), `window.scrollX` stayed 0 and the sidebar stayed at x 24. [Claims](../.impeccable/review/qa-a11y-r3-claims-1280-text200.png), [payouts](../.impeccable/review/qa-a11y-r3-payouts-1280-text200.png) |
| L-B | `LinkButton` role and keyboard | **PASS** | "Import people" on `/people` is an `<a>` with no `role` attribute and `href="/events/new?tab=import"`. The accessibility tree shows `link "Import people"`: 1 link and 0 buttons by that name. Focusing it and pressing Enter went to `/events/new?tab=import`. "Go to sign in" on an invalid invite (signed out) is also an `<a>` with no role: 1 link, 0 buttons. Enter went to `/login`. The external "Export CSV" on `/claims` is an `<a href="/api/export?type=claims">` with no role and keeps the button styling (`data-slot="button"`). A GET on that href returned 200, `text/csv` and `attachment; filename="claims.csv"`, so it downloads with no `download` attribute. Space is not needed: these are plain links and Enter activates them. |
| L-C | `/events/new?tab=import` at 390×844 | **PASS** | On load, "Attendee import" is selected and sits at x 255–374, fully inside the tablist (16–374) and the 390 viewport. The tablist's `scrollLeft` is 96 (it was 0, with the tab at 351–470). The document width is 390. Keyboard still works from the focused tab: ArrowLeft moved to Roles (`?tab=roles`), ArrowRight returned to Attendee import, End stayed on Attendee import (the last tab) and Home went to Basics (`scrollLeft` 0). After each key, focus and selection matched and the selected tab stayed fully visible. [Evidence](../.impeccable/review/qa-a11y-r3-setup-import-390.png) |
| L-D | Forced colors at 1440 | **PASS** | With `forced-colors: active` emulated, the selected inbox row (`button[data-id][aria-pressed=true]`) computes `2px solid` Highlight with `-3px` offset. An unselected row has `outline-style: none`. The selected filter tab ("All 67") and the selected Event setup tab ("Attendee import") get the same 2px Highlight outline, and an unselected tab has none. In the screenshot, the selected row and tab are outlined and nothing else is. With forced colors off, the selected row and tab have `outline-style: none`, and the Blue Hour row selection background (`rgb(44,50,96)`) is unchanged. [Forced](../.impeccable/review/qa-a11y-r3-inbox-1440-forced.png), [normal](../.impeccable/review/qa-a11y-r3-inbox-1440-normal.png) |

## Not covered

- A real screen-reader pass (VoiceOver or NVDA). Roles and names come from the DOM and `ariaSnapshot`.
- Real Windows High Contrast. Forced colors were emulated in Chromium, which resolves `Highlight` to its own system color.
- Clicking the export link in the browser or any other download. Only the GET response headers were checked.
- Everything outside L-A to L-D. Earlier results stand.
