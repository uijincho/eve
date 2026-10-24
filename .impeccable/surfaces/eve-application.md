---
version: 1
slug: "eve-application"
primary_target: "app/(organizer)/page.tsx"
related_targets: ["components/app", "app/(organizer)", "app/(attendee)/portal", "app/login", "app/onboarding", "app/invite", "app/globals.css"]
---

# Eve operational application

## Scope and mode

**Operate.** Organizers resolve exceptions, controllers authorize exact payment terms, attendees submit evidence and collect awards, and auditors inspect the record. This extends the existing Blue Hour world in DESIGN.md and the user-selected mock at `.impeccable/mocks/decision/blue-hour.html`; it does not replace the design system. The `/design` Read surface has its own brief.

## Direction contract

THESIS: Put the few decisions that need a person at the center. Quiet indigo structure and deadline color make urgency legible without turning finance into a wall of summary cards.

OWN-WORLD: Hanken Grotesk with tabular figures, deep indigo grounds, hairline structure, cool-white primary actions, and no page shadows. Dusk colors mean time; coral means blocked or critical; mint means passed.

STORY: Understand what needs attention, inspect the evidence, take the permitted action, and see its persisted outcome. A disabled action explains the role, missing fact or unresolved hold. Simulated payments and draft filings state their status.

FIRST VIEWPORT: At desktop, a compact navigation rail anchors the left, a deadline horizon precedes the central inbox, and a collapsible agent rail sits on the right. The selected item opens evidence beside its decision. On phones, navigation and the agent rail yield room to the work; approvals and reasons remain reachable without clipped controls.

FORM: The established Blue Hour inbox and evidence-pane arrangement, inherited from the user's selected mock. Code-led extension of the existing world; the mock is a critique reference, not an approved pixel-for-pixel comp. No new concept roll was performed or required for this extension. The historical reference `seed:7aeacbad04094ab8` cannot be corroborated on this machine and is not asserted as verified provenance; the user's pinned Blue Hour mock and DESIGN.md are the visual authority. Quality bar: Linear, Ramp, Mercury, Stripe Dashboard.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Verification scope

Required widths are 1440 desktop, 390 phone and the previously tight 1280 inbox. Include a selected prize, payouts, settings and attendee portal, with role restrictions and pending or error states represented. Financial acceptance uses the persisted API and database, independently of screenshots. Preserve the incumbent DESIGN.md and `.impeccable/design.json`; report existing documentation drift separately.
