---
version: 1
slug: "app-design-page-tsx"
primary_target: "app/design/page.tsx"
related_targets: ["app/globals.css"]
---

# /design: Eve design system reference

## Scope and mode
The `/design` route documents and demonstrates Eve's design system, Blue Hour. It is a **Read** surface: the reader is a teammate building an Eve screen who needs the tokens, rules, and components, and needs to see them working. The world it documents applies to every Operate screen in the app (inbox, claims, payouts, attendee portal).

## Audience, job, constraints
- The readers are the four builders on the weekend team, plus the judges who look at the product.
- The job is to find a token or component, understand the rule behind it, and copy the pattern.
- Constraints: Tailwind v4 plus shadcn (Base UI) components in the Next.js app, with tokens in `app/globals.css`. Dusk is the only theme for now. All content is sample data and is labelled as such.

## Chosen direction
Blue Hour, the roll's assigned direction, chosen by the user on Oct 24, 2026 with one steer: "keep it clean and minimalist". The memorable moment is the horizon, the inbox's line of upcoming deadlines.

## Direction contract
THESIS: Eve's interface is set at dusk, and its dusk hues do exactly one job: telling you how soon something is due. Everything else is quiet indigo. This refuses the category default of a white dashboard with a blue accent and KPI tiles, and also the near-black dashboard with a single neon accent.

OWN-WORLD: The ground is deep indigo, never black, with hairline borders and no shadows on the page. The type is Hanken Grotesk, whose figures are tabular by default. The primary button is filled in the cool-white text colour. The five dusk hues (blue, periwinkle, violet, rose, apricot) appear only on deadlines. Critical is coral and passed is mint. Nothing else is coloured.

STORY: The reader learns the single rule (colour means time), checks the tokens and their contrast, sees each component with its states, and leaves knowing how to build an inbox row.

FIRST VIEWPORT: A narrow sticky section index sits on the left. The main column opens with the title "Blue Hour", a two-sentence thesis, and a full-width horizon specimen in which the seven sample deadlines are plotted as dusk-coloured marks on one line from now to two weeks out. The temperature scale and its legend sit directly under it.

FORM: Blue Hour, candidate 7 of 7 on my list (Eve as evening), seed:7aeacbad04094ab8. Its signature move is urgency as sky temperature, expressed through the horizon timeline and the due chips. Four disciplines were raised into it from the declined challengers: compact density, capacity bars that run up against their cap, one fixed scale across the payout breakdown, and full-contrast tabular figures.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved
- A light "daylight" theme is deferred until a screen needs one.
- The icon set is lucide-react, from the shadcn init. Its stroke weight still needs to be confirmed against Hanken.
