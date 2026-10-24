# Browser QA: final verification of route and accessibility fixes

- **Scope:** an independent recheck of the fixes for the findings in [`browser-qa-routes-accessibility.md`](browser-qa-routes-accessibility.md), plus the final-build additions: the People → Import deep link and controller locks. This was a targeted check, not a full route matrix. That earlier matrix (19 routes × 3 widths, all 200, 38 axe runs, keyboard dialogs) was not rerun because nothing pointed to a regression. No visual or design review was done, and the Impeccable launcher and detector were not run.
- **Builds:** I first ran the checks on `eve-calhacks-4zeo75i3j-…` (source `92b6721`), about 13:20 UTC on 2026-10-24. I then ran the full fix matrix and the role checks again on the **final preview `eve-calhacks-qn8jim8zk-…` (source `dfbf030`)**, about 13:28–13:34 UTC. Every result below comes from the final preview unless it says otherwise. Both builds gave the same result for each fix.
- **Browser:** headless Chromium shell 1248 (Playwright-core). The T3 in-app preview was tried first: `preview_open` on a fresh incognito tab redirected to `vercel.com/login` (Vercel SSO). An in-page script cannot set the HttpOnly bypass cookie, so the preview was unusable and I switched to the fallback.
- **Access:** Vercel protection stayed on. I got a `_vercel_jwt` bypass cookie through `vercel curl --deployment … --header 'x-vercel-set-bypass-cookie: true'` into a mode-600 jar in a mode-700 directory. It was never printed. I signed in only through the `/login` persona picker: Dana Whitfield (Organizer), Ari Novak (Controller) and Priya Raman (Attendee).
- **Mutations:** none. No save, release, approve, submit, import, run or code entry was clicked. Pressing Enter on a locked button does nothing (focusable `aria-disabled`). The outage was my own `page.route` abort of `/api/app`. No accounts or organizations were created, and the CA agent owns the sponsor financial flow.

## Verdict

**Pass. Every listed fix holds on the final preview.** I found no blocker and nothing severe. Four new LOW findings are listed below as recommendations. The most useful is a one-class fix for the remaining document overflow when only the text is enlarged to 200%.

## Fix verification (final preview `dfbf030`)

| # | Prior finding | Result | Measurement |
| --- | --- | --- | --- |
| 1 | H1 `/setup` reflow (was 564px wide at 320/390) | **PASS** | `scrollWidth` equals the viewport at 320, 390 and 1280. No unclipped element extends past the right edge. HTTP 200. [320 evidence](../.impeccable/review/qa-final-setup-320.png) |
| 2 | M1 inbox critical badge contrast (was 4.06:1) | **PASS, 5.05:1** | "Frozen" badge, 12px. Foreground `rgb(255,122,133)`. The rendered background, sampled from a screenshot with the badge text hidden, is `rgb(57,45,78)` in all 40 of 40 pixels, giving **5.047:1**. The result was the same with the row selected (`aria-pressed=true`), selected and hovered, and after hovering again. The badge background is now an opaque `color-mix` with `--background`, so row hover and selection cannot change it. [Evidence](../.impeccable/review/qa-final-badge-selected-1440.png) |
| 3 | Rail "Quote changed; closed" clipped | **PASS** | `clientWidth = scrollWidth = 123` at 1440 and 1280. [1280 evidence](../.impeccable/review/qa-final-rail-1280.png) |
| 4 | Empty `/login` submit left focus on the button | **PASS** | After Enter on Sign in, focus is on the Email input, which has `aria-invalid="true"` and is described by "Enter an email address like dana@example.org." |
| 5 | Invalid invite was a dead end | **PASS** (role note L-B) | "Go to sign in" (`href="/login"`) appears at 1440 and 320 with no overflow. Enter on it navigates to `/login`. [320 evidence](../.impeccable/review/qa-final-invite-invalid-320.png) |
| 6 | Try again left focus on `<body>` | **PASS** | With `/api/app` aborted, `/claims` shows the `role=alert` text "Eve could not load this page … Try again". After unblocking, Enter on Try again loads the list, and focus goes to the `<h1>` "Claims" (`tabIndex=-1`, inside `main`). [Evidence](../.impeccable/review/qa-final-claims-after-retry-focus-1440.png) |
| 7 | M2 text-only 200% tables cut off | **PASS for the table.** Leftover document overflow, L-A | At 1280 with the root at 200%, the table sits in a `role=region` named "Claims table" or "Payouts table", with `tabIndex=0` and `overflow-x:auto` (830px wide for a 1151px or 1399px table). It is reached by Tab (stop 31 on claims, 24 on payouts) and gets a solid 2px `#c3c7f0` outline that matches `:focus-visible`. ArrowRight ×6 scrolls 240px. Holding ArrowRight reaches the maximum scroll (321 and 569), and the last column, "Due", ends fully inside the region. All money columns can be reached by keyboard. |
| 8 | L2 portal account button label at 320 | **PASS** | The visible text is "PR". `aria-label` = "PR — Priya Raman, switch demo persona", so the accessible name starts with the visible label. No overflow at 320. [Evidence](../.impeccable/review/qa-final-portal-320.png) |
| 9 | Settings radio focus visibility (Not verified before) | **PASS** | Tab reaches the checked radio ("Hybrid") at stop 23, and it matches `:focus-visible`. The label wrapper gains a 3px ring (`oklab(0.84 0.011 -0.056 / 0.5)`) and a brighter border, and neither appears when the radio is blurred. Visually clear in the screenshot; the ring's contrast was not measured from pixels. [Evidence](../.impeccable/review/qa-final-settings-radio-focus-1280.png) |
| 10 | Duplicate `main` after `/login` → `/` | **PASS (not a defect)** | There are 2 `<main>` elements in the DOM, but the second ("Sign in") is `display:none`, a preserved hidden route. Exactly **1 visible** and **1 in the accessibility tree** (`ariaSnapshot`). This agrees with the US report's F5, so it is not flagged. |

### Final-build additions (`dfbf030`)

| Check | Result | Measurement |
| --- | --- | --- |
| People → Import deep link | **PASS** (L-C at 390) | The organizer's "Import people" on `/people` points to `/events/new?tab=import`. Enter lands there with **"Attendee import"** selected (`aria-selected=true`, roving `tabIndex` 0 only on that tab) and the import panel shown ("Columns: name, email, country…"). Reload keeps the tab. Home on the tablist moves to Basics and updates the URL to `?tab=basics`. `?tab=bogus` falls back to Basics. There is no overflow at 1440 or 390. [390 evidence](../.impeccable/review/qa-final-import-tab-390.png) |
| Controller organizer-only actions locked | **PASS** | Ari Novak. `/settings`: Save organization, limits, money movement, travel policy and notifications are all locked with "Only an organizer can do this." `/events/new`: Save basics is locked the same way. `/agent`: Ask Eve is locked, and the receipt form is replaced by "Organizers, or the attendee who paid, submit receipts. Controllers review them." `/people`, `/prizes` and `/budget`: the Import, award entry and budget edit controls are not rendered. Locked buttons are focusable, `aria-disabled="true"`, show a visible `:focus-visible` ring and are described by their reason. Enter does nothing. [Agent evidence](../.impeccable/review/qa-final-controller-agent-1440.png), [People evidence](../.impeccable/review/qa-final-controller-people-1440.png) |
| Controller Run Eve and filings still allowed | **PASS** | `/agent` "Run the answer key" (the demo-mode Run Eve, `canManage`) is enabled. `/filings` "Generate 2026 drafts" and "Filings CSV" are enabled. `/settings`: "Lock 2026-10", the CSV exports and "Reset sample data" are enabled. `/payouts` "Release all 115" is enabled. None of these were clicked. |
| Before final build (`92b6721`), for contrast | — | On the older preview the controller still had "Run Eve on this receipt" and "Ask Eve" unlocked. That confirms the gate is new in the final build and that the test can tell the two builds apart. |

### Optional quick pass: forced colors and reduced motion

The inbox at 1440 and the portal at 320 were checked with `forced-colors: active` and `prefers-reduced-motion: reduce` emulated. Both media queries matched. No infinite animation and no transition longer than 300ms was running. Text, borders, badges and buttons stay readable, with no overflow. See [inbox](../.impeccable/review/qa-final-inbox-1440-forced-colors.png) and [portal](../.impeccable/review/qa-final-portal-320-forced-colors.png). One state gap is listed as L-D.

## New findings (all LOW, recommendations only)

| ID | Location | Observation | Suggested fix |
| --- | --- | --- | --- |
| L-A | `components/app/data-table.tsx:62` | With text-only 200% at 1280, the table region scrolls, but the **document** still scrolls sideways by 132px on `/claims` and 379px on `/payouts` (`scrollWidth` 1412 and 1659). The cause is the absolutely positioned `sr-only` "Due Oct 27" spans in the Due cells. Their containing block is outside the scroll region, which is not positioned, so they escape it and widen the page. Holding ArrowRight past the region's end then scrolls the whole page, which moves the sidebar off-screen ([evidence](../.impeccable/review/qa-final-claims-1280-text200-scrolled.png)). | Add `relative` to the region wrapper. Injecting `position:relative` on the deployed page brought the document to exactly 1280 on both routes, with the region unchanged (830 of 1151 and 830 of 1399). |
| L-B | `components/app/link-button.tsx` (16 files use it) | Base UI `Button` with `nativeButton={false}` gives the anchor `role="button"`. "Go to sign in" and "Import people" are therefore announced as buttons, even though they navigate (the accessibility tree has 0 links and 1 button by that name). Enter works. | Give navigation anchors the link role, for example by rendering `<Link className={buttonVariants(...)}>` instead of `Button` with `render`, or by passing `role={undefined}` if Base UI allows it. |
| L-C | `/events/new?tab=import` at 390 | The selected "Attendee import" tab starts outside the scrolling tablist: tab at x 351–470, list at 16–374, `scrollLeft` 0. Only "At" is visible next to the edge. | Call `scrollIntoView({ inline: "nearest" })` on the selected tab when the page mounts or the tab changes. |
| L-D | Inbox rows and filter tabs in forced colors | In forced colors the selected row and an unselected row compute the same (transparent background, no outline). Every filter tab gets the same 2px `CanvasText` bottom border, because a transparent border turns visible in forced colors. `aria-pressed` and `aria-selected` are still announced, but sighted high-contrast users cannot see which item is selected. | Use `forced-colors:` variants, for example an `outline`/`Highlight` border on `[aria-pressed=true]` and `[aria-selected=true]`, and `forced-colors:border-b-[Canvas]` on unselected tabs. |

## Network and console

Final run: 0 page errors and 0 unexpected failed requests. The only entries were expected:

- `/api/onboarding` returned 401 on signed-out pages (already reported).
- `/api/invitations/lookup` returned 404 for the invalid token.
- `net::ERR_FAILED` came from my own injected outage.

## Not covered

- A real screen-reader pass (VoiceOver or NVDA). Names, roles and states come from the DOM, `ariaSnapshot` and computed styles only. This is tested coverage, not screen-reader certification.
- A full 19-route matrix and a new axe sweep on `dfbf030`. Prior results stand, and only the listed fixes were rechecked.
- Clicking any enabled controller action (Run the answer key, Generate drafts, Lock period, Release, Reset), because those mutate the shared sample.
- The sponsor remittance and FX flow (owned by the CA agent), and the Judge stipend choice and residency wording.
- Real Windows High Contrast. Forced colors were emulated in Chromium.
