# Eve final captures

Source: root `main` at `680aeca`, served by the root dev server at `http://localhost:3000`, against the settled shared demo produced by `pnpm verify:demo --reset` (300 people, 160 claims, 25 awards; 40/40 caught, 0 false positives, 0 wrongful payouts). Captured 2026-10-24 about 12:05 UTC with headless Chromium (playwright-core 1.58, chrome-headless-shell 1248), after two T3 preview snapshot timeouts. Nothing was mutated: each capture only set a demo persona cookie and navigated.

Every capture waited for its route's ready text, then 2.5 s to settle, and starts at the top of the page. Desktop captures use device scale 1; mobile captures use an iPhone-class 390 x 844 viewport at device scale 2, so their files are 780 px wide.

| File | Route | Persona | Viewport | Capture |
| --- | --- | --- | --- | --- |
| `eve-final-inbox-desktop-1440x1000.png` | `/` | Dana Whitfield, organizer | 1440 x 1000 | full page |
| `eve-final-inbox-desktop-1280x800.png` | `/` | Dana Whitfield, organizer | 1280 x 800 | full page |
| `eve-final-inbox-mobile-390x844.png` | `/` | Dana Whitfield, organizer | 390 x 844 @2x | full page |
| `eve-final-prize-detail-desktop-1440x1000.png` | `/prizes?award=awd_demo_1` | Dana Whitfield, organizer | 1440 x 1000 | viewport |
| `eve-final-prize-detail-mobile-390x844.png` | `/prizes?award=awd_demo_1` | Dana Whitfield, organizer | 390 x 844 @2x | viewport |
| `eve-final-payouts-desktop-1440x1000.png` | `/payouts` | Ari Novak, controller | 1440 x 1000 | full page |
| `eve-final-payouts-mobile-390x844.png` | `/payouts` | Ari Novak, controller | 390 x 844 @2x | full page |
| `eve-final-settings-desktop-1440x1000.png` | `/settings` | Dana Whitfield, organizer | 1440 x 1000 | full page |
| `eve-final-settings-mobile-390x844.png` | `/settings` | Dana Whitfield, organizer | 390 x 844 @2x | full page |
| `eve-final-portal-desktop-1440x1000.png` | `/portal` | Priya Raman, attendee | 1440 x 1000 | full page |
| `eve-final-portal-mobile-390x844.png` | `/portal` | Priya Raman, attendee | 390 x 844 @2x | full page |
| `eve-final-portal-prizes-desktop-1440x1000.png` | `/portal/prizes` | Priya Raman, attendee | 1440 x 1000 | full page |
| `eve-final-portal-prizes-mobile-390x844.png` | `/portal/prizes` | Priya Raman, attendee | 390 x 844 @2x | full page |

Notes for the reviewer:

- Prize detail is a fixed sheet over the prize list, so it is captured at the viewport. A full-page capture showed the sheet's overlay over only the first screen and cut the mobile sheet mid-panel; those were rejected. It shows Priya Raman's unresolved First Overall MacBook Air (needs form, fulfilment undecided, payout locked until the W-8BEN is signed).
- The round "N" badge in the lower left of every capture is the Next.js development indicator from the dev server, not part of the product.
- One portal desktop capture showed a transient development "1 Issue" badge during the persona switch; it did not reproduce on two clean loads and was recaptured clean.
- Settings shows the Team section's real demo-mode response: member lists need a real account, so the sample organization shows "Sign in with your account to view members."
- The pinned Blue Hour reference (`critique-reference-blue-hour.png`) and the mock are unchanged.
