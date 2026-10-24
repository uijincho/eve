---
name: Eve
description: "Daylight: the interface of an event finance agent. Warm paper, white cards, money in lime, time in dusk hues."
colors:
  dusk-1: "#1f6aa5"
  dusk-2: "#5450c8"
  dusk-3: "#8e3bab"
  dusk-4: "#b8365a"
  dusk-5: "#a3500e"
  critical: "#b42318"
  positive: "#3d6b10"
  money: "#a3cf5b"
  pending: "#f2a65a"
  rail: "#ffffff"
  background: "#f3f3ef"
  surface: "#ffffff"
  surface-hover: "#ebebe5"
  border: "#e4e4de"
  input: "#8e8f86"
  chart-4: "#b9b9b0"
  foreground: "#17181a"
  muted-foreground: "#5d5e57"
  faint: "#6b6c64"
  ring: "#17181a"
typography:
  display:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 600
    lineHeight: "2.75rem"
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: "2.125rem"
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: "1.75rem"
    letterSpacing: "-0.01em"
  subheading:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1.5rem"
  body:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  small:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.125rem"
  caption:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1rem"
  code:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1rem"
rounded:
  sm: "5px"
  md: "7.5px"
  lg: "10px"
  xl: "12.5px"
  2xl: "15px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.foreground}"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-primary-hover:
    backgroundColor: "#17181acc"
  button-secondary:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-hover}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-destructive:
    backgroundColor: "#b423181a"
    textColor: "{colors.critical}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-disabled:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.faint}"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "4px 10px"
  badge-critical:
    backgroundColor: "#b423181f"
    textColor: "{colors.critical}"
    rounded: "{rounded.full}"
    height: "20px"
    padding: "2px 8px"
  badge-positive:
    backgroundColor: "#3d6b101f"
    textColor: "{colors.positive}"
    rounded: "{rounded.full}"
    height: "20px"
    padding: "2px 8px"
  badge-pending:
    backgroundColor: "#f2a65a40"
    textColor: "{colors.dusk-5}"
    rounded: "{rounded.full}"
    height: "20px"
    padding: "2px 8px"
  badge-secondary:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.full}"
    height: "20px"
    padding: "2px 8px"
  truth-label:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.sm}"
    height: "20px"
    padding: "0 6px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.2xl}"
    padding: "20px"
  release-card:
    backgroundColor: "{colors.money}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.2xl}"
    padding: "16px"
  inbox-row:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    padding: "16px"
  inbox-row-hover:
    backgroundColor: "{colors.surface}"
  inbox-row-selected:
    backgroundColor: "{colors.surface-hover}"
  tooltip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.lg}"
    padding: "6px 10px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.lg}"
    padding: "6px 10px"
  nav-item-current:
    backgroundColor: "{colors.foreground}"
    textColor: "#ffffff"
---

# Design System: Eve

## Overview

**Creative North Star: "Daylight"**

Eve looks like a well-kept ledger on a desk: warm off-white paper, white cards laid on it, hairline edges, and ink-black figures. Colour is scarce and every hue has a job. Lime fills money that has arrived or cleared, apricot fills money that is pending, and a hatched fill marks any figure that is an estimate. Five dusk hues, cool blue to burnt apricot, still say only one thing: how soon something is due. Brick red marks critical state and moss green marks passed state as text.

The organizer starts on the **Overview**, a dashboard of cards that answers "where does the event's money stand, and what stops the next release?", and works in the **Inbox**, a dense list of decisions. The two share one system: cards and generous figures for orientation, compact 32px controls and 14px rows for work. Depth comes from the paper-to-card step and 1px hairlines; nothing attached to the page casts a shadow.

Daylight is built for a hackathon closing night as much as for a desk. The figures that matter are large, the blockers are named, and anything that is not real money, real data or a verified rule says so.

**Key Characteristics:**
- Warm paper ground (#f3f3ef) under white cards with 15px corners and hairline borders.
- Ink (#17181a) for text, figures, the primary button and the current navigation item.
- Lime and apricot are fills, never text. Hatching means "estimate".
- Dusk hues mean time and appear only on deadlines.
- Compact controls inside calm, card-sized groups.

## Colors

### Primary
Money, as fills.
- **Lime Ledger** (#a3cf5b, `money`): money received, cleared or ready to release. The release console card, the readiness gauge, received and spent bars, the count badge on the current nav item.
- **Apricot Pending** (#f2a65a, `pending`): money committed but not settled. Solid for committed amounts; hatched with #fbddbe (`hatch-pending`) when the amount is an estimate. `hatch-money` does the same for lime.

Neither clears text contrast on white; they never carry text by themselves. Text on a lime fill is Ink.

### Time
The dusk scale. Bands are fixed by time remaining; overdue items take the warmest band.
- **Burnt Apricot** (#a3500e, `dusk-5`): under an hour, and overdue. Also the text on an apricot pending pill.
- **Rose** (#b8365a, `dusk-4`): under a day.
- **Violet** (#8e3bab, `dusk-3`): under two days.
- **Iris** (#5450c8, `dusk-2`): under a week.
- **Harbour Blue** (#1f6aa5, `dusk-1`): a week or more.

Every dusk hue clears 4.5:1 on the ground and on white, so a due chip stays legible in any row. `tests/design.test.ts` enforces it.

### State
- **Brick** (#b42318, `critical`): frozen, failed, over cap, blocked totals. The destructive action and field errors.
- **Moss** (#3d6b10, `positive`): passed, paid, verified, ready.

Both appear as text on a 12% tint of themselves in pills, and as plain text in errors and summaries.

### Neutral
- **Paper** (#f3f3ef, `background`): the page. Also the browser theme colour, the inside of selected chart columns and the fill of avatars.
- **Card White** (#ffffff, `surface`, `rail`): cards, the navigation card, popovers, tooltips.
- **Stone** (#ebebe5, `surface-hover`): row hover, selected rows, secondary buttons, segmented-control track, empty bar tracks.
- **Hairline** (#e4e4de, `border`): every 1px divider and card edge.
- **Field Edge** (#8e8f86, `input`): field boundaries and the dashed border of an unverified label, at 3:1 on white.
- **Pebble** (#b9b9b0, `chart-4`): a neutral fourth series in budget bars.
- **Ink** (#17181a, `foreground`, `ring`): primary text, every figure, the primary button, the current nav item, focus rings, spent segments.
- **Graphite** (#5d5e57, `muted-foreground`): secondary text, meta lines, captions, placeholders.
- **Ash** (#6b6c64, `faint`): tertiary text on paper or white only.

### Named Rules
**The Fill Not Text Rule.** Lime and apricot are fills. When a pill needs that meaning as text, it uses Moss on a lime tint or Burnt Apricot on an apricot tint.

**The Hatch Means Estimate Rule.** A hatched fill is an estimate: projected withholding, fees, FX, pending claims, committed spend. Settled amounts are always solid.

**The Colour Means Time Rule.** Dusk hues appear only on deadlines: due chips, horizon marks and the temperature scale. Never on links, buttons, icons, chart series or decoration. Burnt Apricot on a pending pill is the one shared use, and it still means "not yet".

**No Trend Theatre.** A hackathon lasts a weekend. Compare figures against a cap, a pledge or a request ("62% of the travel cap"), never against "last month".

## Typography

**Display and body:** Hanken Grotesk (next/font, `--font-hanken`). **Code:** Geist Mono, for token names and hex values only.

One humanist grotesk carries everything. Its figures line up in columns, which matters most in a finance tool.

### Hierarchy
- **Display** (600, 2.5rem / 2.75rem, −0.025em): the single headline figure on a dashboard card, and the design page title.
- **Title** (600, 1.75rem / 2.125rem, −0.02em): page titles and secondary headline figures (totals, release amount).
- **Heading** (600, 1.25rem / 1.75rem, −0.01em): the wordmark, stage counts, section headings in long pages.
- **Subheading** (600, 1rem / 1.5rem): card titles, dialog and detail-pane titles.
- **Body** (400, 0.875rem / 1.25rem): default UI text and navigation. Row titles and key amounts take 600.
- **Small** (400, 0.8125rem / 1.125rem): meta lines, help, card links.
- **Caption** (400, 0.75rem / 1rem): the label under or above a figure, legends, pills (at 600), axis labels.

**The Big Figure Rule.** A card leads with one figure in Display or Title and explains it with a Graphite caption beneath ("Budget left after spent and committed, of $75,500.00"). The caption says what the number is compared against.

**The Figures Rule.** Every amount renders through `Money`: tabular figures, Ink, right-aligned in columns, a true minus (−) for deductions and an "est." prefix for estimates. Amounts are integer minor units, never floats.

## Layout

Space runs on a 4px rhythm (4, 8, 12, 16, 20, 24, 32, 48). Cards pad 20px and sit 16px apart.

**Organizer shell.** From 1280px a 240px navigation card floats 12px in from the left edge (white, hairline, 15px corners): the Eve mark and wordmark, the event card with the closing-ceremony time, primary navigation, records, setup, and the persona switcher at the foot. Under 1280px it becomes a top bar with the same navigation in a sheet.

**Overview.** A title row with the event-phase control (Before · During · After), then two columns that wrap: a wide work column (`flex: 999 1 620px`) and a 300–384px side column. The work column holds the budget hero beside a three-figure stack, the prize pipeline, travel budget beside the agent finding, and a responsive grid of budget lines, payout readiness and funding sources. The side column holds the release console and recent activity. Below roughly 960px the side column drops beneath; every card reflows, and nothing scrolls sideways.

**Work pages** (Inbox, Claims, Prizes, Payouts…) keep the compact list layout: a page header with a hairline beneath, a list on paper, and a 304px detail pane beside the list from 768px.

## Elevation & Depth

Two layers: paper, and white cards on it. Inside a card, Stone marks hover, selection and empty tracks. Rows divide with Hairline. Tooltips and menus float with a soft shadow (`shadow-lg` at 10% black) and a hairline ring; nothing attached to the page uses it.

**The Flat Card Rule.** Cards never cast shadows. Separation is the paper step plus a hairline.

## Shapes

`--radius` is 10px. Truth labels and bar segments use 5px, buttons and fields 10px, inner tiles and selected chart columns 12.5px, cards 15px. Pills, avatars, count badges and the gauge's caps are fully round. A squared label is a statement about truth; a pill is state.

Bars are 8px tall (26px for a featured single bar). A dashed border means "not yet confirmed": unverified rules and empty states.

## Components

shadcn on Base UI, themed through the tokens, plus Eve's patterns in `components/eve/` and the Overview's card parts in `components/app/views/overview-view.tsx`. Daylight is the only theme; the root carries no `.dark` class, so `dark:` variants never apply. Icons are lucide-react at 16px, `aria-hidden` beside a label.

Motion is 150ms colour and opacity on `ease-dusk` (`cubic-bezier(0.16, 1, 0.3, 1)`); floating layers fade and zoom from 95%. Reduced motion cuts all of it. Focus is a 2px Ink outline offset 2px.

### Brand
The Eve mark (`components/eve/logo.tsx`, `app/icon.svg`) is two mirrored chevrons, an E and a V, in white on an Ink tile with 22% corners. It sits left of the wordmark at 28px in the navigation card and 24px in compact headers. Never recolour it or place it on lime.

### Buttons
- **Primary:** Ink fill, white text, 32px, 10px corners. One per view; hover lowers the fill to 80%.
- **Secondary:** Stone fill. The first action in a row.
- **Ghost:** no fill until hover (Stone). Further actions in a row.
- **Outline:** paper fill with a hairline, for utilities and "Dismiss".
- **Destructive:** Brick text on a 10% Brick tint. Never solid.
- **Disabled:** white fill and Ash text, no opacity fade.

### Navigation
Body-size links in Graphite, 10px corners. The current item is an Ink pill with white text at 600; its count becomes a lime badge with Ink figures. Other counts sit in Stone badges. Hover fills Stone.

### Cards
White, hairline, 15px corners, 20px padding. A card head is a Subheading title, a Graphite caption, and an optional "Open X →" link at the right in Small 600.

### Pills and Truth Labels
- **Pills:** 20px, caption at 600. Positive: Moss on a 25% lime tint. Pending: Burnt Apricot on a 25% apricot tint. Critical: Brick on a 10% tint. Neutral: Graphite on Stone.
- **Truth labels:** 20px squared labels with a hairline and Graphite caption: "Sample data", "Test mode", "Simulated", "Estimate"; "Unverified rule" takes a dashed Field Edge border. The Overview title always carries "Simulated".

**The Truth Label Rule.** Anything that is not real money, real data or a verified rule carries a truth label. Simulation is never implied by colour alone.

### Overview patterns
- **Budget hero:** remaining budget in Display, then one column per budget line on a shared scale: the cap as a Stone column, spent in Ink at the bottom, committed hatched apricot above it. Clicking a column selects it (paper fill behind it) and shows its spent, committed, cap and funding source beneath a hairline.
- **Figure stack:** three Title figures with captions: paid out, awaiting release, blocked from release (Brick when non-zero).
- **Prize pipeline:** a tab row of stage tiles (Ready, Tax form or hold, Team split, Frozen, Paid), each a count in Heading with its amount in a toned pill. The selected tile takes a 1.5px Ink ring; the list beneath names each recipient, their prize, the real hold reason and the amount.
- **Release console:** a lime card with the amount waiting for the controller, then four square shortcut tiles, then "Waiting on a winner" avatars whose 2.5px ring takes the blocker's tone.
- **Readiness gauge:** a 22px half ring, Stone track and lime fill, with the percentage in Title and a key of blocker counts beneath.
- **Agent finding:** a paper-filled card naming one escalation group with Review and Dismiss. It states that Eve has not approved or rejected the items.

### Due Chip, Horizon and Temperature Scale
Unchanged in behaviour: a 6px dusk dot with time remaining in Small 600 and its context in caption; the horizon plots open deadlines from now to two weeks on a compressed, fully labelled axis, sharing hover with its list. Marks wear a paper-coloured halo so they knock out of the axis.

### Money, Evidence and Bars
- **Evidence:** any derived figure is a link with a dotted Ash underline that opens its source.
- **Breakdown bar:** gross to net on one scale; net in Ink, withholding and fees in neutral fills.
- **Capacity bar:** spent (Ink), committed (hatched apricot), remaining (Stone) against a cap. Over the cap, the overflow turns Brick.

**The Fixed Scale Rule.** Bars meant for comparison share one scale.

### Inbox Row, Blocked Action, Tables, Empty States
Rows: title in body 600, a Graphite meta line and the reason, amount, due chip, actions beneath; hover lifts to white, selection to Stone. A blocked action stays visible, disabled but focusable, with the reason beside it ("Ari Novak is the controller"). Tables right-align figures and become stacked lists under 768px. Empty states are a dashed hairline box with one sentence saying what will appear.

## Do's and Don'ts

### Do:
- **Do** lead each card with one figure and say what it is measured against.
- **Do** use lime for money in or ready, apricot for pending, hatching for estimates.
- **Do** name the blocker: a missing W-8BEN, a frozen bank change, an unconfirmed split.
- **Do** keep one Ink primary per view.
- **Do** put a truth label on anything sample, simulated, test-mode, estimated or unverified.
- **Do** route every amount through `Money`.
- **Do** keep dusk hues for deadlines.

### Don't:
- **Don't** put text in lime or apricot on white; it fails contrast.
- **Don't** show month-over-month trends, sparklines without a baseline, or invented figures.
- **Don't** add a blue "brand" accent or a gradient.
- **Don't** shadow cards; only floating layers get the soft shadow.
- **Don't** use solid fills for estimates.
- **Don't** write `dark:` variants as if a theme switch exists. Daylight is the only theme.
