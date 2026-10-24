# Browser QA: team prizes, receipts and recovery

October 24, 2026, approximately 05:56–06:09 Pacific. Root coordinator, headless Chromium against `http://localhost:3000`, source `eed4051` through `182d1a2`.

The T3 preview snapshot timed out twice (`Preview automation snapshot timed out after 15000ms.`), so the installed Chromium fallback was used. These were actual browser interactions with the persistent backend. Read-only `/api/app` requests checked the result after each action; they did not replace the actions.

## Fixture and limits

Setup used a disposable database fixture, **not real-account onboarding**: one US/USD direct-mode demo organization, two adult attendees, organizer/controller/auditor memberships, synthetic signed profiles, fake active payout methods and three budget lines. Signed demo cookies selected those fixture roles. Real signup and invitation acceptance are covered by the separate US and Canadian browser runs.

All expense evidence and money were synthetic. The receipt was prominently marked as a QA fixture; the extraction correctly treated it as requiring review. No shared sample financial records were changed or reset.

## Findings fixed

| Finding | Reproduction | Fix and browser result |
| --- | --- | --- |
| Team confirmation unavailable | Organizer entered a $1,000 cash prize for two people through the UI. Each attendee correctly received only their own $500 award in the snapshot, but no confirmation button appeared because the UI expected more than one team award. | `b28f559` uses the attendee's own `teamId`. At 390 and 1440, both members clicked **Confirm my share** and persisted confirmation. Each snapshot still contained exactly one award. |
| Missing-TIN W-9 path blocked | Independently reported by US browser QA; the API supported this state but the form required a TIN. | `b28f559` adds an explicit **TIN not provided** choice and explains backup withholding. Browser checks rejected an unacknowledged empty TIN and a three-character ID, then saved a signed W-9 without a TIN through the UI. The US worker independently repeated this on the protected preview. |
| Closed-release status clipped | The earlier visual report found that the outcome and reason were truncated. | `eed4051` shortens the status to **Quote changed; closed**. Actual rendered width equals scroll width (123px) at 1440 and 1280. The independent route audit also confirmed it on the preview. |
| Setup page overflow | Independent route QA reproduced a 564px document at 320 and 390. | `182d1a2` constrains the base grid and step navigation. Browser measurements: document width equals viewport at 320, 390 and 1280. |
| Critical badge contrast | Independent audit measured 4.06:1 on a selected inbox row. | `182d1a2` composites the existing coral against the fixed page ground. Actual computed canvas colors are foreground `[255,122,133]`, background `[57,45,78]`; measured ratio **5.0469:1**. No palette values changed. |

The team and organization-currency cap render regressions have two persistent tests in `tests/portal-render.test.ts`, including a snapshot containing only the recipient's own team share.

## Receipt and payment flow

1. Empty submission showed the missing receipt/amount and merchant errors.
2. A PDF larger than 8 MB was rejected before submission.
3. An injected HTTP 503 on document upload showed an actionable upload failure and created zero claims.
4. Retrying through the same form uploaded a synthetic Uber PDF. The real extraction read **USD 38.40** and the correct merchant. Exactly one claim was persisted. The document's synthetic label and nonspecific venue caused an honest escalation; no claim was automatically approved.
5. The organizer opened the claim detail and approved it through the browser.
6. The attendee submitted the same receipt again. It was escalated with a failed duplicate check matching the earlier approved claim. It created no payout.
7. The controller clicked **Release all 3**. The durable workflow settled both $500 team shares and the $38.40 reimbursement through `mock_wire`. Readback showed all three paid, with unchanged recipient amounts.
8. Postgres contained **six balanced journal entries**, total debits and credits each **215,180 USD minor units**. This includes the liability and settlement entries, plus the simulated fees. There were no running agent runs at cleanup.

The original capture script used the wrong `radio` locator for the Paid filter after settlement. That automation error was corrected to its actual `button` role; only the read/capture step was repeated, with no duplicate financial action. The receipt run recorded zero browser page errors.

## Evidence and cleanup

Screenshots were opened and checked before committing:

- `.impeccable/review/qa-root-team-before.png`: absent confirmation before the fix.
- `qa-root-team-mobile.png` and `qa-root-team-desktop.png`: each recipient's own confirmation.
- `qa-root-receipt.png`: extracted amount and honest evidence escalation.
- `qa-root-paid.png`: controller's three paid payouts.
- `qa-root-setup-{320,390,1280}.png`: constrained setup layout.
- `qa-root-badge.png`: fixed critical badge and readable closed-release line.
- `qa-rail-fixed-{1440,1280}.png`: measured label fit.

The exact test organization was purged only after matching its id, name, demo flag, five synthetic memberships, absence of real auth-user links, three settled mock payouts and absence of running agent jobs. Follow-up counts for its organization, memberships, people, payouts and journal entries were all zero. No auth users were created or removed. The private signed-cookie fixture and temporary setup/cleanup scripts were deleted. Shared demo state was preserved.
