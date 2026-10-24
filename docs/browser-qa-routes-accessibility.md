# Browser QA: routes, errors and accessibility

- **Scope:** read-only route matrix for every organizer and attendee route, plus login, onboarding and invalid-invite pages. Keyboard, focus, network-failure and export checks, and WCAG 2.2 A/AA findings. This is not a design review. The Impeccable detector was not run.
- **Builds tested:** first pass on `https://eve-calhacks-hj2fnowlg-…` (source `da167e0`), matrix 12:54:44–12:57:41 UTC. Full rerun on `https://eve-calhacks-ovu33bdeg-…` (source `b28f559`), matrix 13:03:26–13:06:31 UTC with interaction runs until about 13:08 UTC, 2026-10-24. Both builds gave the same results for everything below except the activity-rail label, which is fixed in `b28f559`.
- **Browser:** headless Chromium shell 1248 (Playwright-core). The T3 in-app preview was tried first on a fresh incognito tab against `localhost:3000/login`. `preview_snapshot` timed out twice with `Preview automation snapshot timed out after 15000ms`, so I switched to the fallback as instructed.
- **Access:** Vercel protection stayed on. A private `_vercel_jwt` bypass cookie was loaded from a mode-600 jar and never printed. I signed in by clicking a persona on `/login`: Organizer, Controller (payouts checkbox only) and attendee Priya Raman. No API shortcuts were used to drive the UI. API traffic was observed only.
- **Viewports:** 1440×1000, 390×844 and 320×844 for every route. 1280×800 and 1024×768 for the rail and sheet. 640×400 stood in for 200% page zoom at 1280. Text-only 200% was simulated by setting the root `font-size` to 200%. That doubles all rem-based text (h1 went from 28px to 56px).
- **Automated audit:** axe-core 4.14.0, injected from `/tmp` with tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`. 38 runs at 1440 and 320.
- **Mutations:** none to shared financial data. No release, approve, reject, submit, save or code entry was clicked. The settings radio was changed by keyboard and then reloaded; the reload showed the original value (`hybrid`), so nothing persisted. The payout "Select all releasable payouts" checkbox was toggled with Space and then toggled back. That is a selection only, with no request. Persona sign-in sets only a demo session cookie. No accounts or organizations were created, so there is no cleanup to do.
- **Machine-readable results:** [`.impeccable/review/qa-routes-results.json`](../.impeccable/review/qa-routes-results.json): 75 route records and 28 interaction checks.

## Verdict

**Block (accessibility) on `b28f559`. Both causes are fixed at root and not yet re-measured on a deployed preview.** Neither blocks a task with a pointer at desktop widths. One HIGH remains on the deployed build: WCAG 1.4.10 Reflow on `/setup`. One MEDIUM remains: a 1.4.3 contrast failure on the inbox critical badge. Root reports both fixed locally (eed4051 follow-up: `/setup` shows zero overflow at 320/390/1280, and the badge pair is #ff7a85 on #392d4e = 5.05:1). Neither fix has been re-measured by this agent on a deployed preview yet.

No route returned an HTTP error. No route logged a page error, console error or failed request, apart from the expected cases listed under Network and console below. Every route has exactly one `<h1>`, one `<main>`, a "Skip to content" link as its first focusable element, and a specific `<title>`.

## Route matrix (b28f559)

19 routes × 3 widths = 57 navigations, plus 18 records for 1280, text-200% and 640px. All returned status 200 and stayed on the requested path.

| Route | 1440 | 390 | 320 | axe (1440 / 320) | Notes |
| --- | --- | --- | --- | --- | --- |
| `/` Inbox | ok | ok | ok | color-contrast (see M1) / 0 | Row reasons truncate at 1440/1280 (L1) |
| `/claims` | ok | ok | ok | 0 / 0 | Text-only 200% clips the table (M2) |
| `/prizes` | ok | ok | ok | 0 / 0 | |
| `/payouts` | ok | ok | ok | 0 / 0 | Text-only 200% clips the table (M2) |
| `/people` | ok | ok | ok | 0 / 0 | |
| `/budget` | ok | ok | ok | 0 / 0 | |
| `/sponsor` | ok | ok | ok | 0 / 0 | No export control on this page |
| `/audit` | ok | ok | ok | 0 / 0 | |
| `/filings` | ok | ok | ok | 0 / 0 | |
| `/agent` | ok | ok | ok | 0 / 0 | 12 truncated lines at 390/320; all have `title` (L1) |
| `/settings` | ok | ok | ok | 0 / 0 | |
| `/setup` | ok | **overflow 174px** | **overflow 244px** | 0 / 0 | H1 |
| `/events/new` | ok | ok | ok | 0 / 0 | |
| `/portal` and `/portal/{claims,payouts,prizes,profile,travel}` | ok | ok | ok | label-content-name-mismatch (L2) | File chooser label truncates at 320 on `/portal/claims` (L3) |
| `/login` | ok | — | — | 0 | |
| `/invite/<invalid>` | ok | — | ok | 0 | |
| `/onboarding` (signed out) | redirects to `/login?next=/onboarding` | | | | |

"ok" means `documentElement.scrollWidth <= innerWidth` and no element outside a scroll or clip container extends past the viewport.

## Findings

### Survive zoom and reflow

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH (fixed at root, deployed build not yet re-measured) | `components/app/views/setup-view.tsx:33-35` | At 390 and 320 the page is 564px wide. The grid has no base column template, so its implicit column sizes to the stepper's min-content (547.7px). `nav` has no `min-w-0`, so `ol.overflow-x-auto` never scrolls, and the H2, form and helper text spill to the right. Evidence: [viewport](../.impeccable/review/qa-routes-setup-320-viewport.png), [scrolled right](../.impeccable/review/qa-routes-setup-320-scrolled-right.png). | Base `grid-cols-[minmax(0,1fr)]` and `min-w-0` on the nav (root's fix). | **1.4.10 Reflow (AA).** At 320px a user has to scroll horizontally to read and fill the setup form. |
| MEDIUM (recommendation; 1.4.4 is met through page zoom) | `/claims`, `/payouts` desktop tables (`table.max-md:hidden`) | With text-only 200% at 1280, the table grows to 1151px (claims) and 1399px (payouts) inside an 830px `overflow-x: hidden` parent. The Amount, Due, Withheld and Net received columns are cut off. Evidence: [claims](../.impeccable/review/qa-routes-claims-1280-text200-b28f559.png). The 640px "200% page zoom" check passes because the layout switches to cards. | Make the table wrapper `overflow-x-auto` with a labelled, focusable region, or switch to cards based on container width rather than viewport width. | 1.4.4 Resize Text is satisfied, because browser zoom works. Users who enlarge only text (Chrome font-size setting) lose the money columns. |

### Pair color with a second cue, and contrast

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM (fixed at root, deployed build not yet re-measured) | Inbox row critical badge, `[data-slot=badge][data-variant=critical]` on the selected (`bg-surface-hover`) row | #ff7a85 on #453b64 at 12px = **4.06:1**, measured by axe with the mouse parked at (0,0) on b28f559. | Root composites the badge over the fixed page background: #392d4e, 5.05:1. | **1.4.3 Contrast (AA)**, which needs 4.5:1 for 12px text. |
| Not verified | Inbox horizon (`.transition-opacity …absolute`) | During the first matrix pass, axe flagged two more nodes at 1.93:1 (#4a4c84 on #1e2246) inside an opacity-transition layer. They were not flagged once the pointer was parked away from the page. | — | Probably hover labels caught mid-fade. Recheck with the pointer over the horizon if it matters. |

### Accessible names

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| LOW | `components/app/portal-shell.tsx:38-48`, portal account button | `aria-label="Priya Raman, switch demo persona"`. Below `sm` the only visible text is the initials "PR", which are `aria-hidden`. axe flags it on all six portal routes at both 1440 and 320. | At 1440 the name starts with the visible "Priya Raman", so speech input works there. At 320, consider a visible "Account" text label, or keep the initials out of the visible-label contract. | 2.5.3 Label in Name (A). This is an axe heuristic hit. The narrow-width case is the real risk for speech-input users. |

### Errors that announce

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| LOW (recommendation) | `/login` empty submit | Both fields get `aria-invalid="true"`, with `aria-describedby` pointing at visible errors ("Enter an email address like dana@example.org.", "Use at least 12 characters."). Focus stays on the Sign in button. [Evidence](../.impeccable/review/qa-routes-login-empty-submit-1440.png). | Focus the first invalid field on submit. | 3.3.1 is met. Moving focus is the skill's recommended pattern, so screen-reader users hear the first error right away. |
| LOW (recommendation) | Page error state, "Try again" | After recovery, focus falls back to `<body>`. | Move focus to the page `<h1>` once data loads. | 2.4.3 Focus Order: keyboard users restart from the top of the page. |

### Truncation and small polish

- **L1:** At 1440/1280, the inbox row reason line uses an ellipsis with no `title`. Example: "A valid W-8BEN is missing or expired. Payment is held, not defaulted. Withholdin…". The full text is in the detail panel when the row is selected, so no information is lost. On `/agent`, the 12 truncated lines at 390/320 all have a `title`, but a `title` is mouse-only.
- **L2:** see Accessible names above.
- **L3:** `/portal/claims` at 320: the file chooser label "Choose a photo or PDF" truncates to 69px of 135px.
- **L4:** `/invite/<invalid>` is a dead end. It shows "Invitation not found" with no sign-in or home link. [Evidence](../.impeccable/review/qa-routes-invite-invalid-320.png).
- **Activity-rail closed-release label: fixed in b28f559.** The rail now reads "Quote changed; closed" with `clientWidth = scrollWidth = 123` at both 1440 and 1280, so nothing is clipped. [Evidence](../.impeccable/review/qa-routes-inbox-rail-1280-b28f559.png). On da167e0 it still had the old copy, which root had already fixed.

## Interaction checks (b28f559)

| # | Check | Result | Assertion |
| --- | --- | --- | --- |
| 1 | Persona picker click → inbox | PASS | Landed on `/` |
| 2 | Skip link | PASS | First Tab stop, visible when focused, Enter sets `#main` |
| 3 | Inbox: first 25 Tab stops | PASS | Every stop has a solid 2px outline or a ring box-shadow |
| 4 | Inbox filter tabs | PASS | ArrowRight moves selection and focus (All → Approvals). End → Exceptions, Home → All. Roving tabindex. Note: no `role=tabpanel` or `aria-controls`; the tabs act as a filter (recommendation only). |
| 5 | Inbox search, no match | PASS | "No items match" |
| 6 | Inbox search, 600 characters | PASS | No document overflow |
| 7 | Inbox row → detail at 1440 | PASS (test corrected) | Rows are `button[aria-pressed]` and open an in-page detail panel, not a modal. Enter toggles `aria-pressed`, and Escape leaves focus on the row. My first assertion expected a modal drawer, which was wrong. |
| 8 | Inbox row at 390 | PASS | Rows expand inline with labelled actions (code field, Confirm account, Reject, Details); [evidence](../.impeccable/review/qa-routes-inbox-row-sheet-390.png). No dialog is expected. |
| 9 | Agent activity sheet at 1024 | PASS | Enter on "Agent" opens `role=dialog` named "Agent activity". Focus moves inside and stays trapped after 40 Tabs. Escape closes it and focus returns to "Agent". The button is `xl:hidden`, so at 1280 the rail is always visible and there is no button (first assertion wrong). [Evidence](../.impeccable/review/qa-routes-inbox-agent-sheet-1024.png). |
| 10 | Network failure and retry on `/claims` (my own `page.route` aborting `/api/app`) | PASS | The page shows "Eve could not load this page. Could not reach Eve. Your data is unchanged; try again in a moment." in a `role=alert`, with a "Try again" button ([evidence](../.impeccable/review/qa-routes-claims-network-fail-1280.png)). After unblocking, Enter on Try again loads the claims list with no page reload ([evidence](../.impeccable/review/qa-routes-claims-after-retry-1440.png)). Focus then falls to body (LOW above). The first assertion counted `tr`/`li` and was wrong. |
| 11 | Claims search, no match | PASS | "No claims match" |
| 12 | Claim-type radiogroup arrows | NOT RUN | The form only appears after "Submit a claim". I didn't open it, to stay away from submit paths. |
| 13 | Settings native radios | PASS | ArrowDown changes `hybrid` → `direct`. Reloading shows `hybrid`, so nothing persisted. The input itself has `outline: none`. The ring is on the label wrapper. The ring's visibility was not measured, so it is **Not verified** for 2.4.7. |
| 14 | Payouts checkbox (Controller) | PASS | Named "Select all releasable payouts". Space toggles it, and the outline is solid 2px #c3c7f0. Toggled back. No disabled buttons were present to check disabled reasons. |
| 15 | Portal nav at 320 | PASS | Travel, Prizes and Payouts start off-screen behind a right-edge fade mask. Focusing the last link scrolls the nav (`scrollLeft` 156) and the fade moves to the left edge. Keyboard users can reach every tab. The fade is the only visual cue: no scrollbar or arrow. [Before](../.impeccable/review/qa-routes-portal-nav-320.png) and [after](../.impeccable/review/qa-routes-portal-nav-320-last-focused.png). Recommendation, not a failure. |
| 16 | Portal account dialog | PASS | Enter opens it with focus inside. Escape closes it and focus returns to the trigger. |
| 17 | Exports (read-only GET `/api/export`) | PASS | `eve-ledger.csv` (4,509 B, header `entry_id,entry_date,…`), `filings.csv` (244 B), `payouts.csv` (19,900 B), `claims.csv` (32,887 B). Downloaded files were deleted after their headers were read. |
| 18 | PDF download | NOT RUN | No PDF control was found on `/audit`, `/filings`, `/payouts`, `/sponsor` or `/claims`. |
| 19 | Invalid invite | PASS | "Invitation not found" is explicit, with no 320 overflow and 0 axe violations. |
| 20 | `/onboarding` signed out | PASS | Redirects to `/login?next=/onboarding` |
| 21 | `/payouts` signed out | By design | It does not redirect: demo mode serves the sample org, labelled "Sample data", to anonymous visitors. My "redirect" assertion assumed the opposite. Root should confirm this is intended for a protected preview. |
| 22 | `/login` labels | PASS | Email (`autocomplete=email`) and Password (`current-password`) are labelled |

## Network and console (b28f559)

Across all 75 route records the totals were 0 page errors, 0 console errors, 0 failed requests and 0 HTTP ≥ 400. All entries logged during the interaction run are expected:

- `GET /api/invitations/lookup?token=…` returned 404 on the invalid invite (expected).
- `GET /api/onboarding` returned 401 when signed out on `/invite/…` and `/onboarding`, each with a matching "Failed to load resource" console line. These are expected, but they add console noise for a normal signed-out visit. Consider not calling `/api/onboarding` before a session exists.
- `net::ERR_FAILED` on `/api/app` came from my own injected outage.

Root ran a shared DB suite during the rerun. No timeouts were seen, and no slowness is attributed to the product.

## Not covered

- Signup and the authenticated `/onboarding` form, including organization creation. I created no accounts. Root and other agents covered real-account flows.
- Valid invite acceptance.
- Real screen-reader passes (VoiceOver/NVDA). Names and roles come from the DOM and axe only, which is **not** screen-reader certification.
- Forced-colors mode, `prefers-reduced-motion`, and 2.5.8 target-size measurement beyond axe.
- The visibility of the settings radio label focus ring.
- A recheck of H1 and M1 on a preview containing root's fixes. It is pending the refreshed preview.
