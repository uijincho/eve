# Eve design documentation pass

Role: Impeccable documenter (`.agents/skills/impeccable/agents/impeccable_documenter.toml`), following `reference/document.md`. Scope: an ordinary extension of the incumbent Blue Hour system (Operate, code-led). The surface brief's FORM line says no new concept roll was needed and that the historical seed is unverified.

**Result: No changes to DESIGN.md, `.impeccable/design.json` or PRODUCT.md.** The shipped build still matches the recorded system on every token and named rule. The drift below is either pre-existing or a layout measurement the build chose on purpose. The role says an ordinary extension preserves the incumbent and reports drift without repairing it. This report is the only file written.

Checked at worktree `87540a7` (captures), UI source `6ad750d` as carried into this tree (round 2 fixes `7ea6dc2`, `a60a3cd`, `6ad750d`; rail follow-ups `443ea2b`, `da167e0`). The round 3 finish review (`eve-finish-review-r3.md`, root commit `7f908ce`) was read from the root checkout after this report was drafted. It was not merged into this tree. Its outcome is recorded in "Final finish scope" below.

## Final finish scope

Round 3 disposition is **fix**. Fixes 1, 2, 3, 4, 6, 7 and 8 are resolved. Fix 5 (agent rail) is partial for one string only.

**The open defect.** At 1440 and 1280, the collapsed status "Release request closed; quote changed" (`lib/client/derive.ts:561`) truncates to "Release request close…" beside its "Done" badge, so the outcome and reason cannot be read without expanding the entry.

Everything else round 3 checked now fits:
- names and amounts
- the waiting entries' "6:00 AM" time and "Awaiting controller"
- the sponsor shortfall "Short $30.00"
- the phone frozen-row actions ("Confirm account | Reject | Details")

Round 3 saw no regressions.

The coordinator reports that both unattended fix batches are used up, so no more code edits will be made. The handover keeps this defect and makes no ship or pass claim. This documentation follows that scope:
- The defect is reported as a defect the build carries.
- It is not recorded as a system rule, and the collapsed rail status is not documented as something that may truncate.
- Nothing in DESIGN.md or the sidecar was changed to make it go away.

Round 3 did not cover the live preview, interactions or the detector, and neither does this report.

## Evidence checked

- **Specs:** `reference/document.md` in full, `DESIGN.md` (frontmatter and all eight sections), `.impeccable/design.json` (`generatedAt` 2026-10-24T09:00:09Z), `PRODUCT.md`, `.impeccable/surfaces/eve-application.md`, `.impeccable/config.json` (`buildPath: code`).
- **Review trail:** `eve-final-manifest.md`, `eve-finish-review-r1.md`, `eve-finish-fixes-r1.md`, `eve-finish-review-r2.md`, `eve-finish-fixes-r2.md`.
- **Stylesheet:** all of `app/globals.css` (237 lines): the `@theme` mapping, the `:root` palette, the type ramp, radius, `--ease-dusk`, the base layer, the themed native radio and checkbox, and reduced motion.
- **Source scans** over `components/app`, `components/eve`, `app/(organizer)`, `app/(attendee)`, `app/login`, `app/onboarding`, `app/invite` and `lib/client`:
  - literal colours
  - `shadow*`
  - dusk-hue consumers
  - `uppercase`, `tracking-wide*`, `font-bold`
  - `dark:` variants
  - `disabled:opacity`
- **Sampled components:**
  - `components/app/organizer-shell.tsx:88-97`
  - `components/app/inbox/inbox-view.tsx:77,140,200`
  - `components/app/agent-feed.tsx:60-140`
  - `components/app/sheet.tsx:30-50`
  - `lib/client/use-eve.tsx:158-170`
  - `lib/design/urgency.ts`
  - The two `components/eve` files changed after the `21cc0bc` foundation: `horizon.tsx` (`a86f2d9`) and `money.tsx` (`ff0ff76`).
- **Captures:** all 13 `eve-final-*.png` files had the dimensions in the manifest (checked with `sips`). I viewed:
  - `eve-final-inbox-desktop-1280x800.png` (full page)
  - `eve-final-prize-detail-desktop-1440x1000.png`
  - `eve-final-portal-prizes-mobile-390x844.png`
  - part of `eve-final-payouts-desktop-1440x1000.png` (a crop written to `/tmp`; the original is unchanged)
- **Reference:** `critique-reference-blue-hour.png`, used to compare against the world, not as a pixel comp.

Not done, as instructed: no detector or launcher run, no live preview, no code or screenshot edits, no new direction.

## System fidelity

| Area | Recorded system | Shipped build | Verdict |
| --- | --- | --- | --- |
| Palette | 19 colour tokens in the DESIGN.md frontmatter | `app/globals.css:107-148` declares the same hex values: rail through ring, five dusk hues, critical, positive, and chart-3/4. shadcn roles alias them (`--primary: var(--foreground)`, `--popover: var(--surface-hover)`, `--destructive: var(--critical)`). | Match |
| Type ramp | Hanken Grotesk at seven steps; Geist Mono for code only; weights 400/500/600 | `globals.css:78-98` matches the frontmatter exactly. The only `uppercase` in product code is the IATA airport field (`claim-form.tsx:212`, `portal/travel.tsx:133`). That transforms input data, not a label style. There are no bold or tracked labels. | Match |
| Colour Means Time | Dusk hues only on deadlines | `lib/design/urgency.ts` is the only map from band to hue. Its only consumers are `due-chip.tsx`, `horizon.tsx`, `temperature-scale.tsx` and `/design`. No product file names a dusk class directly. In the captures, dusk appears only on due chips and horizon marks. | Match |
| Two States | Coral for critical, mint for positive | Coral appears only on Frozen and blocked states in the captures. Round 1 removed the coral 401 from Settings → Team. | Match |
| Flat Page, Float | Shadows only on floating layers, using the Float recipe with a hairline | The only two shadows in product code are the Float recipe on the modal sheet (`sheet.tsx:35`, with a `border`) and the toast (`use-eve.tsx:161`, `bg-surface-hover` plus `ring-border`). Panels, rows and tables have none. | Match |
| One Primary, Says-Why, Truth Label | One Cool White primary per view; blocked actions stay visible and give a reason; truth labels | Prize sheet: a locked full-width "Propose payout" with "Held until Priya signs the W-8BEN". Portal: one "Sign your W-8BEN" primary. "Estimate", "Simulated" and "Sample data" labels are present. | Match |
| Figures Rule | Tabular, right-aligned, true minus, "est." in Haze Lavender | Prize ladder `−$389.70`, `est. $909.30`, payouts net column, foreign `est. CA$300.03` line. The `money.tsx` change adds a `US$` prefix when the organization's currency is not USD, which is consistent with the rule. | Match |
| Controls | 16px checkbox with 4px corners that fills Cool White | `globals.css:189-227` draws every native radio and checkbox from the palette: a Field Edge hairline, a Cool White fill when checked, a Border edge when disabled, and the global Pale Halo focus outline. | Match. The radio is undocumented; see debt item 2. |
| Motion | 150/200ms on `ease-dusk`; near-zero for reduced motion | `--ease-dusk` at `globals.css:100`; sheet at `duration-200 ease-dusk`, gated with `motion-safe:`; rail rows at 150ms; reduced-motion block at `globals.css:229-237`. | Match |
| `dark:` and disabled | No `dark:` variants; no opacity fade on disabled | Neither appears in product scope. | Match |

The prohibitions were checked against the world's own materials. No recorded "Don't" bans something the build uses natively. The Float shadow, the dashed empty-state border (`agent-feed.tsx:94`) and the radio's inset knockout (`globals.css:217`) are all inside rules DESIGN.md already states.

## Drift found and not repaired

### Pre-existing documentation drift (predates this finish pass)

1. **PRODUCT.md describes a repository that no longer exists.**
   - `PRODUCT.md:7` says the repository "currently contains the PRD and development skills, with no application scaffold."
   - `PRODUCT.md:83` says "No binding visual direction, palette, typography, logo assets, or broader brand system has been supplied."
   - `PRODUCT.md:88` says no seed data, results or runnable demo exist.
   - All three are now false. The Next.js app exists, DESIGN.md records the Blue Hour world, and the manifest cites a settled 300-person demo (40/40 caught, 0 false positives, 0 wrongful payouts).
   - This is product-context drift, not design-system drift. Updating it needs the owner's confirmation, because PRODUCT.md is "confirmed by the project owner".
2. **DESIGN.md's shell measurements describe the `/design` example, not the shipped Operate shell.**
   - DESIGN.md Layout gives a 160px rail (from 1280px) and a 304px detail pane (from 768px). Those are the values in `app/design/_components/inbox-example.tsx:68,128` (`10rem`, `19rem`).
   - The shipped organizer shell, which landed after the sidecar was generated (`03fa55b`), uses:
     - an 11rem (176px) rail at `xl` (`organizer-shell.tsx:88`)
     - a 20rem detail pane at `md` and 22rem at `lg` (`inbox-view.tsx:140`)
     - a third column the system does not record: the agent rail, 16rem at `xl`, 19rem at `2xl`, collapsing to 3rem (`inbox-view.tsx:77`)
   - The direction contract's FIRST VIEWPORT asks for this three-column arrangement, and finish rounds 1 and 2 said to keep it. So the build made a deliberate choice; it is not a defect. The documentation is what lags.

### Intentional implementation choices (not defects, not yet recorded)

3. **The modal sheet sits on Deep Indigo Ground, not Lifted Indigo.**
   - DESIGN.md Elevation says floating layers "step up to surface-hover so they read as nearer."
   - `sheet.tsx:35` uses `bg-background` with the Float shadow and a hairline, over a `bg-rail/70` scrim. Popovers and the toast do step up.
   - The sheet carries raised panels and secondary controls of its own, which are legible on the ground. On surface-hover they would lose a ladder step.
   - I record this as an undocumented exception, not drift to repair.
4. **Horizon clustering.** `a86f2d9` merges coincident deadlines into one dot labelled "+N", caps the number of label lanes, and drops labels past the cap while keeping their dots. DESIGN.md says labels are "stacked into lanes so labels never overlap", which is still true, but it does not mention clusters or the cap.

## New reusable documentation debt

These patterns ship, recur, and are missing from DESIGN.md and the sidecar. Recording them means a refresh or merge of DESIGN.md, which document.md says needs the user's choice. I have not done it.

1. **Agent rail** (`components/app/agent-feed.tsx`): a Night Rail column with a run list in a 10px hairline container.
   - Each entry is two lines. Line one is the subject in small 500, truncatable, with the amount right-aligned in tabular figures that never shrink.
   - Line two is a short caption status in Haze Lavender that keeps its figure, then a status badge. The waiting badge shows only its time.
   - Rows hover to Raised Indigo with a chevron that rotates over 150ms.
   - Filter chips are 28px with 6px corners; the active chip is Lifted Indigo.
   - This is the Operate surface's third signature component and the main undocumented one.
   - When it is recorded, the rule to carry is the one the finish rounds enforced: the collapsed status keeps its outcome and figure whole. The round 3 "Release request close…" truncation is a known defect, not the pattern.
2. **Radio and radio card.** A 16px round Field Edge control. When checked, it fills Cool White with a 3px Deep Indigo Ground inset knockout, so it reads as a ring and dot. A radio card shows a label ring on focus. DESIGN.md documents only the checkbox.
3. **Sheet** (`components/app/sheet.tsx`):
   - Placement: a bottom sheet under `sm` (`max-h-[88dvh]`, 10px top corners), a 26rem right panel at `sm` and up, and a 16rem left variant for phone navigation.
   - Surface: Float shadow and a 70% Night Rail scrim.
   - Motion: a 200ms `ease-dusk` slide of 6 units, limited to `motion-safe`.
   - Its relation to the Float rule is item 3 above.
4. **Toast / announcer** (`lib/client/use-eve.tsx:158-170`): a Lifted Indigo bar with 8px corners, the Float shadow, a hairline ring, small text and a text Dismiss button. It is `role="status"` and `aria-live="polite"`. It fits the Float rule but is not listed.
5. **Layout values** from drift item 2, plus the phone rule the finish rounds set: a phone inbox row keeps its actions and Details on one line, using shorter phone labels ("Confirm account", "Reject") that stay as the accessible names.

There are no new colour, type, radius or spacing tokens. Every value in the build resolves to an existing frontmatter token, so the frontmatter needs no change.

## Not canonized

I found no craft-floor refusal in the build that would need keeping out of the system:

- no eyebrows or kickers
- no glyph icons (icons are lucide SVGs)
- no hard offset shadows
- no system display face

The capture artifacts are not part of the system:

- The Next.js "N" development badge.
- The organizer prize sheet's third-person "What Priya receives as cash". This is the intended organizer voice; the attendee view says "you".

The truncated agent-rail status "Release request close…" (round 3, fix 5 partial) is a defect the build carries. It must not be read as permission for rail statuses to truncate.

The finish reviews flagged that the horizon legend, relative clock and rail summary from the reference are missing. Those are ceiling gaps, not system rules. They stay out of DESIGN.md until they ship.

## Real limitations

- I opened four of the 13 captures; for the other nine, only their dimensions were checked against the manifest. The phone inbox (780×25570) was not opened. The mobile assertions in this report rely on the round 2 changes response, not my own viewing.
- No computed styles were sampled from a live server. The token match is source to source (`globals.css` against the frontmatter). Ground and hue fidelity in the captures were judged by eye.
- The sidecar was not regenerated or diffed field by field. Its `generatedAt` predates the organizer shell, so the layout drift in item 2 and the debt above apply to it as well.
- The historical seed `seed:7aeacbad04094ab8` was not checked. FORM already records it as unverified.
- The round 3 verdict comes from the root report at `7f908ce`. I did not recrop the rail myself to confirm the truncation.

## System summary

- **Palette:** a Blue Hour indigo ladder (rail #191c3b → ground #1e2246 → surface #252a52 → surface-hover #2c3260, hairline #343a6b, field edge #626aa8); five dusk hues for time only; coral and mint for state; Cool White primary.
- **Type:** Hanken Grotesk only, in seven steps (display 40, title 28, heading 20, subheading 16, body 14, small 13, caption 12) at weights 400/500/600, with tabular figures. Geist Mono is for code and token names.
- **Shape and depth:** radii 4/6/8/10px and full pills; flat page with 1px hairlines; the Float shadow only on floating layers.
- **Named rules:** Colour Means Time, Two States, Faint Floor, One Family, Figures, Flat Page, Halo, One Primary, Truth Label, Fixed Scale, Evidence, Says-Why.
- **Open defect, not canonized:** round 3 left fix 5 partial on one truncated rail status. No more code edits are planned, and the build is not claimed as shipped or passed.
- **Drift and debt:** stale PRODUCT.md repository and brand statements; shell widths recorded from `/design`; the sheet's ground surface; horizon clusters; the agent rail, radio, sheet and toast not yet documented. All reported and none repaired, because this pass is an ordinary extension, and changing DESIGN.md or PRODUCT.md needs the user's refresh or merge decision or the owner's confirmation.
