---
name: Eve
description: "Blue Hour: the interface of an event finance agent. Quiet indigo structure; dusk hues that mean time."
colors:
  dusk-1: "#62b6f2"
  dusk-2: "#9d9bf6"
  dusk-3: "#cf86e3"
  dusk-4: "#f08ba0"
  dusk-5: "#f5a962"
  critical: "#ff7a85"
  positive: "#6fcf9e"
  rail: "#191c3b"
  background: "#1e2246"
  surface: "#252a52"
  surface-hover: "#2c3260"
  border: "#343a6b"
  input: "#626aa8"
  chart-3: "#6e75a8"
  chart-4: "#4a5185"
  foreground: "#eceef8"
  muted-foreground: "#a7acd2"
  faint: "#8b91be"
  ring: "#c3c7f0"
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
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "10px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.background}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-primary-hover:
    backgroundColor: "#eceef8cc"
  button-secondary:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-secondary-hover:
    backgroundColor: "color-mix(in oklch, #2c3260, #eceef8 5%)"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-ghost-hover:
    backgroundColor: "{colors.surface}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-destructive:
    backgroundColor: "#ff7a851a"
    textColor: "{colors.critical}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-destructive-hover:
    backgroundColor: "#ff7a8533"
  button-disabled:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.faint}"
  button-sm:
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 10px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "4px 10px"
  tab-line:
    backgroundColor: "transparent"
    textColor: "#eceef899"
    rounded: "{rounded.md}"
    padding: "2px 8px"
  tab-line-active:
    textColor: "{colors.foreground}"
  badge-critical:
    backgroundColor: "#ff7a851f"
    textColor: "{colors.critical}"
    rounded: "{rounded.full}"
    height: "20px"
    padding: "2px 8px"
  badge-positive:
    backgroundColor: "#6fcf9e1f"
    textColor: "{colors.positive}"
    rounded: "{rounded.full}"
    height: "20px"
    padding: "2px 8px"
  badge-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
    height: "20px"
    padding: "2px 8px"
  badge-secondary:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
    height: "20px"
    padding: "2px 8px"
  truth-label:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.sm}"
    height: "20px"
    padding: "0 6px"
  inbox-row:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    padding: "16px"
  inbox-row-hover:
    backgroundColor: "{colors.surface}"
  inbox-row-selected:
    backgroundColor: "{colors.surface-hover}"
  list-container:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.xl}"
  panel-raised:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "16px"
  tooltip:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.lg}"
    padding: "6px 10px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
  nav-item-current:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
---

# Design System: Eve

## Overview

**Creative North Star: "Blue Hour"**

Eve is set at dusk. The ground is deep indigo, never black, and the structure is built from a short ladder of indigo steps that grow lighter as surfaces come forward. Against that quiet field, colour has exactly one job: telling you how soon something is due. Five dusk hues run from cool blue (a week or more) to warm apricot (under an hour), and they appear only on deadlines. Coral marks critical state and mint marks passed state. Nothing else is coloured.

The system is clean and minimalist by instruction and compact by necessity. Organizers work an inbox of money decisions, so controls are 32px tall, body text is 14px, rows are dense, and figures sit at full contrast in tabular columns. Depth comes from lightness steps and 1px hairlines; the page casts no shadows. The signature is the horizon, a single line from now to two weeks out where every open deadline lands as a dusk-coloured mark, with due chips carrying the same hues into rows and tables.

Blue Hour refuses two category defaults by name: the white dashboard with a blue accent and KPI tiles, and the near-black dashboard with a single neon accent. Dark is the only theme; a light "daylight" theme is deferred until a screen needs one.

**Key Characteristics:**
- Deep indigo ground (never black) with lighter indigo steps for raised and selected surfaces.
- Colour means time: dusk hues appear on deadlines and nowhere else.
- Coral (critical) and mint (positive) are the only other hues.
- One typeface, Hanken Grotesk, at every size; hierarchy from size and weight (400, 500, 600).
- Flat page: hairline borders and tonal steps, with shadows reserved for floating layers.
- Compact density on a 4px rhythm; full-contrast tabular figures.
- Honesty is visible: truth labels, traced evidence, and blocked actions that say why.

## Colors

A quiet indigo ladder for structure and text, five dusk hues that encode time remaining, and two state colours.

### Primary
The dusk scale. It is the system's only voice, and it speaks only about deadlines. Bands are fixed by time remaining; overdue items take the warmest band.
- **Apricot Horizon** (#f5a962, `dusk-5`): under an hour, and overdue.
- **Sunset Rose** (#f08ba0, `dusk-4`): under a day.
- **Afterglow Violet** (#cf86e3, `dusk-3`): under two days.
- **Periwinkle Dusk** (#9d9bf6, `dusk-2`): under a week.
- **Last-Light Blue** (#62b6f2, `dusk-1`): a week or more.

Every dusk hue clears 4.5:1 on the ground, on surface, and on surface-hover, so a due chip stays legible in a selected row.

### Secondary
State, kept to two colours.
- **Signal Coral** (#ff7a85, `critical`): frozen, failed, over cap. Also the destructive action, the error text under a field, and the overflow segment of a capacity bar.
- **Cleared Mint** (#6fcf9e, `positive`): passed, paid, verified.

Both appear as text on a 12% tint of themselves in badges, and as plain text in field errors and capacity summaries.

### Neutral
The indigo ladder, darkest to lightest, then text.
- **Night Rail** (#191c3b, `rail`): the app's navigation rail and sunken areas. The darkest value in the system.
- **Deep Indigo Ground** (#1e2246, `background`): the page. Also the browser theme colour, and the halo ring around horizon marks.
- **Raised Indigo** (#252a52, `surface`): raised panels, row hover, the current nav item, the disabled button fill.
- **Lifted Indigo** (#2c3260, `surface-hover`): selected rows, secondary buttons, popovers and tooltips, the empty track of a capacity bar.
- **Hairline Indigo** (#343a6b, `border`): every 1px divider and container edge.
- **Field Edge** (#626aa8, `input`): field boundaries, the horizon axis and ticks, the dashed border of an unverified label. It is the lightest structural line, at 3:1 on the ground.
- **Dusk Slate** (#6e75a8, `chart-3`) and **Deep Slate** (#4a5185, `chart-4`): neutral data fills. Withholding and committed spend use Dusk Slate; fees use Deep Slate. Deep Slate is also the text-selection background.
- **Cool White** (#eceef8, `foreground`): primary text, every figure, the primary button fill, the spent segment of a bar.
- **Haze Lavender** (#a7acd2, `muted-foreground`): secondary text, meta lines, placeholders, help text.
- **Faint Lavender** (#8b91be, `faint`): tertiary text such as axis labels and token specs; the disabled button label.
- **Pale Halo** (#c3c7f0, `ring`): focus rings only.

### Named Rules
**The Colour Means Time Rule.** Dusk hues appear only on deadlines: due chips, horizon marks, and the temperature scale that keys them. If something has a hue, it is due. Never use a dusk hue for a link, button, icon, chart series, or decoration.

**The Two States Rule.** Coral and mint are the only other hues, and they mark state, never emphasis. Every other distinction is made with indigo lightness and text weight.

**The Faint Floor Rule.** Faint text sits on the ground or the rail (5.0:1 and 5.4:1). The disabled button label on surface is the one exception, at exactly 4.5:1. Faint never goes on surface-hover, where it falls to 4.0:1.

## Typography

**Display Font:** Hanken Grotesk (loaded through next/font as `--font-hanken`, falling back to the system sans)
**Body Font:** Hanken Grotesk
**Label/Mono Font:** Geist Mono, for code and token names only

**Character:** One humanist grotesk carries everything, from the page title to the axis labels. It reads calm and exact at 14px, and its figures line up in columns, which is what a finance tool needs most.

### Hierarchy
- **Display** (600, 2.5rem / 2.75rem, −0.025em): reserved for a single defining title. Today only the design system's own page uses it; Operate screens start at Title.
- **Title** (600, 1.75rem / 2.125rem, −0.02em): page titles.
- **Heading** (600, 1.25rem / 1.75rem, −0.01em): section and panel headings ("Inbox", "Payout batch #4") and the wordmark.
- **Subheading** (600, 1rem / 1.5rem): group labels, dialog and detail-pane titles. Set at 400 in muted text, it also serves as a lede.
- **Body** (400, 0.875rem / 1.25rem): the default UI size, applied on `body`. Row titles and key amounts take 600; buttons, tabs, and field labels take 500. Running prose holds to 48–62ch.
- **Small** (400, 0.8125rem / 1.125rem): meta lines, help and error text, navigation links. Due chips use it at 600.
- **Caption** (400, 0.75rem / 1rem): due context, axis labels, tab counts, legends. Badges, truth labels, horizon mark labels, and the temperature-scale legend set it at 500.
- **Code** (Geist Mono, 0.75rem): token names and hex values, nothing else.

### Named Rules
**The One Family Rule.** Hanken Grotesk at every size. Hierarchy comes from the seven-step scale and three weights (400, 500, 600). There is no bold, no uppercase, and no letter-spaced label style.

**The Figures Rule.** Every amount renders through the Money component: tabular figures, full-contrast Cool White, right-aligned in columns, a true minus sign (−) for deductions, and an "est." prefix in Haze Lavender for estimates. Amounts are stored as integer minor units and never formatted through floats.

## Layout

Space runs on a 4px rhythm (4, 8, 12, 16, 24, 32, 48), tight inside a group and generous between groups. Inside a row or control, gaps are 4–8px; between a label and its field, 6px; between blocks inside a panel, 24px; between specimens and between page sections, 56px, with a hairline rule on top of each section.

Density is compact. Default controls are 32px tall, small buttons 28px, badges and truth labels 20px. Inbox rows pad 16px; compact rows and table cells pad 12px vertically and 16px horizontally.

The app shell is a 160px rail of navigation on the left (from 1280px up), a main column, and a 304px detail pane beside the list (from 768px up). Full inbox rows lay out as a three-column grid (content, 8rem amount, 9rem deadline) with actions on a full-width line beneath. Reference pages use a 176px sticky section index beside a single column, capped at 80rem with 20 / 32 / 40px gutters.

Responsive behaviour changes structure, not just size:
- Under 768px, compact rows and the detail pane give way to full rows that carry their own actions, and tables become stacked lists with the amount and due chip at the right.
- Under 1024px, the sticky section index becomes a jump menu in a sticky top bar.
- The horizon measures its own width: under 560px it drops mark labels and keeps only the Now, 1 day, and 2 weeks ticks.
- Under 640px, the temperature scale's per-band labels become a wrapped key with dots.

## Elevation & Depth

The page is flat. Depth comes from the indigo ladder: rail, ground, surface, and surface-hover each step up in lightness, and 1px Hairline Indigo borders separate regions that share a value. Lists, tables, and the app shell sit on the ground inside a hairline-bordered container; hover lifts a row to surface, and selection lifts it one step further to surface-hover. Only layers that float over the page, tooltips and menus, cast a shadow, and they also step up to surface-hover so they read as nearer before the shadow registers.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.3), 0 4px 6px -4px rgb(0 0 0 / 0.3)`, plus a 1px ring in Hairline Indigo): tooltips, popovers, and menus. Nothing attached to the page uses it.

### Named Rules
**The Flat Page Rule.** Panels, cards, rows, and containers never cast shadows. If a surface needs to separate, step it up the indigo ladder or give it a hairline.

**The Halo Rule.** Horizon marks wear a 2px ring in the ground colour so they cut cleanly out of the axis line. It is a knockout, not a shadow.

## Shapes

Corners are gently curved and scale with the size of the object: 4px for small rectangles (truth labels, bar segments, swatches, skeleton lines), 6px for small controls and nav items, 8px for buttons, fields, and tooltips, and 10px for containers, lists, tables, and panels. State badges are full pills; deadline dots, horizon marks, and the temperature-scale bands are fully round. The two badge shapes carry meaning: a pill is state, a squared label is a statement about truth.

Lines are 1px hairlines. A dashed border means "not yet" or "not confirmed": an unverified rule's truth label, and an empty state's outline. Bars are 8px tall with 2px gaps between segments; the temperature scale is a 4px ribbon. Horizon stems are 1px lines in the mark's hue at half opacity.

## Components

Components come from shadcn on Base UI, themed through the tokens, plus Eve's own patterns in `components/eve/`. Blue Hour is the only theme and the root carries no `.dark` class, so the `dark:` variants inside the shadcn files never apply; style for Blue Hour with plain utilities. Icons are lucide-react SVGs at 16px (12–14px in small controls and table headers), always `aria-hidden` beside a text label. Their stroke weight against Hanken is still provisional.

Motion is brief and functional: colour and opacity transitions at 150ms (rows, links, underlines) and 200ms (horizon dimming and mark scale) on the `ease-dusk` curve, `cubic-bezier(0.16, 1, 0.3, 1)`. Floating layers fade and zoom in from 95%. Reduced-motion users get every animation and transition cut to near zero.

Focus is always visible: a 2px Pale Halo outline offset 2px by default, and on controls a Pale Halo border with a 3px ring at 50%.

### Buttons
Restrained and solid, never coloured by hue.
- **Shape:** gently curved (8px; 6px at the small size).
- **Primary:** Cool White fill with Deep Indigo Ground text, 32px tall, 10px side padding, body size at 500. One per view.
- **Hover / Focus:** hover lowers the fill to 80%; focus adds the Pale Halo border and ring; press nudges the button down 1px.
- **Secondary:** Lifted Indigo fill; hover mixes in 5% Cool White. The first action in a row is secondary.
- **Ghost:** no fill until hover, which shows Raised Indigo. Every further action in a row is ghost.
- **Outline:** ground fill with a hairline, for utility actions such as export.
- **Destructive:** coral text on a 10% coral tint, 20% on hover. Never a solid coral fill.
- **Disabled:** Raised Indigo fill with Faint Lavender text and a not-allowed cursor. No opacity fade.
- **Pending:** sets `aria-busy`, keeps its fill, spins a loader icon before the label, and names the action in progress ("Releasing").

**The One Primary Rule.** One Cool White button per view. In a row, the first action is secondary and the rest are ghost; in a detail pane, the primary spans the pane's width.

### Chips
- **State badges:** 20px pills, caption at 500. Critical and positive are their colour on a 12% tint; Outline (hairline, Cool White text) marks neutral holds; Secondary (Lifted Indigo) marks drafts.
- **Truth labels:** 20px squared labels (4px) with a hairline and Haze Lavender caption at 500: "Sample data", "Test mode", "Simulated", "Estimate". "Unverified rule" swaps to a dashed Field Edge border.

**The Truth Label Rule.** Anything that is not real money, real data, or a verified rule carries a truth label beside it. Simulation is never implied by tone or colour alone.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** lists, tables, and the app shell sit on the ground inside a hairline border; a raised panel uses Raised Indigo with a hairline.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px Hairline Indigo; rows divide with the same hairline and drop it on the last row.
- **Internal Padding:** 16px for panels and rows, 20px for the inbox header and detail pane.

### Inputs / Fields
- **Style:** 32px tall, transparent fill, 1px Field Edge border, 8px corners, 10px side padding. Placeholder in Haze Lavender. Labels sit above in small at 500; help sits below in small Haze Lavender.
- **Focus:** the border turns Pale Halo with a 3px Pale Halo ring at 50%.
- **Error / Disabled:** the border turns coral with a 3px coral ring at 20%, and the message below, in coral small text, says how to fix the problem. Selects share the field's shape; the checkbox is a 16px square with 4px corners that fills Cool White when checked.

### Navigation
- **App rail:** Night Rail column with small-size links in Haze Lavender, 6px corners, 6px by 8px padding. The current item takes a Raised Indigo fill, Cool White text at 500, and its count in tabular caption figures. Hover brightens the text only.
- **Tabs:** the line variant only. Triggers sit at body size and 500 at 60% Cool White, turn Cool White on hover, and show a 2px Cool White underline when active. Counts follow the label in tabular caption figures.
- **Section index:** small-size links in Haze Lavender; the current entry turns Cool White, and nested entries hang off a hairline whose current segment turns Cool White.

### Due Chip
The deadline in its band's hue: a 6px dot and the time remaining ("18 min", "1 h 18 min", "Oct 27", "Overdue 5 min") in small at 600, with what the deadline is ("2:00 PM release") beneath in Haze Lavender caption. Screen readers get the spoken form ("Due in 18 minutes"). It right-aligns in rows and tables. This is the only component that may carry a dusk hue in a list.

### Horizon and Temperature Scale
The horizon plots every open deadline on one 1px Field Edge axis from now to two weeks out. The axis is compressed so the next hours get room without hiding the next two weeks, and every stop is labelled so the scale stays honest: Now, 1 h, 6 h, 1 day, 2 days, 1 week, 2 weeks. Each deadline is a 10px dot in its dusk hue with the ground-colour halo, a stem at half opacity, and a caption-size label at 500 in the same hue, stacked into lanes so labels never overlap. "Now" is the only tick in Cool White.

The horizon and the list beside it share one hover: pointing at a row or a mark scales the active mark to 150%, dims every other mark to 35%, and turns the active label Cool White. The temperature scale sits beneath as a 4px ribbon whose five bands span the same stretch of axis their deadlines land on, so the ramp lines up with the ticks above it.

### Money, Evidence, and Bars
- **Money:** see The Figures Rule. Foreign amounts show the original in Haze Lavender, an arrow, then the converted amount.
- **Evidence:** any figure derived from a document, rule, or rate is a link with a dotted Faint Lavender underline offset 4px, which turns Cool White on hover; hover or focus opens a tooltip naming the source ("Rule US-NRA-PRIZE v2 · 30% default").
- **Breakdown bar:** gross to net on one fixed scale. Net is a Cool White segment, withholding Dusk Slate, fees Deep Slate. A legend beneath lists each amount, with net last and in 600.
- **Capacity bar:** spent (Cool White), committed (Dusk Slate), and remaining (Lifted Indigo track) against a cap. The summary reads "$X left of $Y"; over the cap, the overflow segment turns coral, a 1px Cool White tick marks the cap, and the summary reads "$X over the $Y cap" in coral.

**The Fixed Scale Rule.** Each bar uses one scale, and bars meant for comparison share it. Net is visibly what is left of gross; remaining sits against the cap.

**The Evidence Rule.** Every amount Eve derives can be opened to its source. A figure without evidence is a figure the user typed.

### Inbox Row
One thing that needs a person: title in body 600 with any critical badge, a meta line and the reason Eve escalated it in small Haze Lavender, the amount in 600 with its note in caption, the due chip, and the actions on their own line. Hover lifts the row to Raised Indigo over 150ms; beside a detail pane, rows compact to title, meta, amount, and due chip, and the selected row sits at Lifted Indigo. Loading rows are skeletons with the real row's geometry so nothing jumps.

### Blocked Action
An action the current user may not take stays in place: a small secondary button with a lock icon, disabled but focusable, with the reason beside it in small Haze Lavender and wired to it with `aria-describedby`.

**The Says-Why Rule.** A blocked action is never hidden and never disabled silently. The reason names the rule and the person who can act ("Ari Novak is the controller").

### Tables
Dense rows with sortable headers. Header labels are caption at 500 in Haze Lavender with a 12px sort arrow; rows pad 12px by 16px, divide with hairlines, and hover to Raised Indigo. Figures right-align; the due column keeps its hues. Under 768px, a table becomes a stacked list in the same sort order.

### Empty States
A dashed hairline container with 10px corners, a title in body 600, and one sentence in small Haze Lavender saying what will appear here and why the space is empty.

## Do's and Don'ts

### Do:
- **Do** reserve the five dusk hues for deadlines, keyed by time remaining: under an hour (and overdue), under a day, under 2 days, under a week, a week or more.
- **Do** build depth from the indigo ladder (rail, ground, surface, surface-hover) and 1px hairlines.
- **Do** use surface for hover and surface-hover for selection, so a selected row always reads one step above a hovered one.
- **Do** render every amount through Money: tabular, Cool White, right-aligned, true minus, "est." for estimates.
- **Do** keep one Cool White primary per view; make a row's first action secondary and the rest ghost.
- **Do** put a truth label on anything sample, test-mode, simulated, estimated, or unverified.
- **Do** keep blocked actions visible, disabled but focusable, with the reason beside them.
- **Do** keep loading skeletons at the real component's geometry.
- **Do** keep the shadow for floating layers only, with the Float recipe and a hairline ring.

### Don't:
- **Don't** use a dusk hue on anything that is not a deadline: no dusk buttons, links, icons, chart series, selection, or focus rings.
- **Don't** introduce a brand accent colour. Blue Hour rejects the white dashboard with a blue accent and KPI tiles, and the near-black dashboard with a single neon accent.
- **Don't** go darker than Night Rail (#191c3b) or use black for any surface.
- **Don't** put shadows on panels, cards, rows, or containers.
- **Don't** place Faint Lavender text on surface-hover or anything lighter.
- **Don't** fade disabled buttons with opacity; use the Raised Indigo fill and Faint Lavender text.
- **Don't** fill a destructive button with solid coral; use coral text on a coral tint.
- **Don't** add bold weights, uppercase labels, or letter-spaced captions; the scale and three weights carry the hierarchy.
- **Don't** add a second display face; Geist Mono is for code and token names only.
- **Don't** write `dark:` variants or a light theme as if a theme switch exists; Blue Hour is the only theme until a daylight theme is designed.
