# Eve

Event finance for travel claims, prizes, controller approvals, sponsor handoffs and filing drafts. Built from [PRD.md](PRD.md), with the Blue Hour interface in [DESIGN.md](DESIGN.md).

The application uses real Postgres persistence, deterministic financial rules, an immutable balanced ledger, Better Auth accounts and Vercel Workflow jobs. Money movement is **simulated**. Tax documents are **drafts, not for filing**. Integration and validation details are tracked in [IMPLEMENTATION.md](IMPLEMENTATION.md).

Open the [Vercel preview](https://eve-calhacks-bnzqx9gf8-badbird5907s-projects.vercel.app) with your Vercel account. The [overnight handover](docs/overnight-handover.md) contains the walkthrough and remaining limitations; the [browser QA index](docs/browser-qa-summary.md) links the tested journeys, fixes and evidence.

## Run locally

Use Node 24 and pnpm 11. Install with `pnpm install --frozen-lockfile`. Copy `.env.example` to `.env.local` and set the database URLs, auth secret and vault key. Receipt reading additionally needs the Anthropic key. Never commit an environment file or replace an existing vault key: saved identifiers depend on it.

```sh
pnpm db:migrate
pnpm seed
pnpm dev
```

Open <http://localhost:3000>. Migrations use the direct Postgres connection with TLS verification; normal traffic uses the pooled connection. The seed is a fictional 300-person event and can take about a minute across a remote database connection. It does not create real payments or send external notifications.

With `EVE_DEMO_MODE=true`, `/login` offers sample organizer, controller, auditor and attendee personas. Anonymous demo visitors enter as the sample organizer. The attendee portal is `/portal`; the organizer home is `/overview` (`/` redirects there) and the inbox is `/inbox`. Disable demo mode for a private installation. Real-account onboarding and invitation endpoint contracts are in [ONBOARDING.md](lib/server/ONBOARDING.md).

## What to try

1. Open **Prizes**, inspect Priya's MacBook recommendation and choose its cash equivalent.
2. Switch to Priya's attendee persona and complete her profile and W-8BEN. The unresolved treaty claim should stay off for the default-withholding example.
3. Inspect the persisted gross, withholding, fees and net. Switch to the controller to release the proposal. The organizer and agent cannot release it.
4. Inspect the decision evidence, payout status and ledger export. Generate filing drafts from **Filings**.
5. Inspect Jordan's frozen bank change. Verification belongs to the original contact channel; confirming it still requires a fresh controller release.
6. Run the event review in **Agent** and inspect the measured scoreboard. It shows the last evaluated run, with its timestamp; later interactions change the next run's result. The demo reset clears only the fictional organization.

A real attendee can enroll their first simulated payout account in the portal. Replacing an account, or entering one as staff, requires confirmation through the original email; without a configured email provider, that change remains frozen. Importing adult attendees starts tax-form reminders; organizers share the portal invitation links from People.

The shared sample event may already contain completed demo actions. Reset only when nobody else is using it. Real organizations are excluded from reset.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Database tests use disposable organizations in the configured Postgres database and remove them afterwards; they skip when no database is configured. They test balance, immutability, period locks, access boundaries and business flows. `typecheck` runs Next's route type generation first.

With the local server running, `pnpm verify:workflow` exercises the real HTTP route, durable background proposals, controller hooks and duplicate-release behavior against an isolated synthetic organization. `pnpm verify:ocr` makes a paid Anthropic API request using a synthetic receipt; it is separate from the ordinary test suite.

`pnpm verify:demo --reset` rebuilds the shared fictional event, runs its durable review, explicitly releases the two threshold-crossing payments as the sample controller, generates drafts, and saves the measured scoreboard to `docs/demo-benchmark.json`. It takes several minutes. Coordinate before using `--reset`: it replaces the shared demo's interactions, while leaving real organizations alone. Without `--reset`, it measures the current demo state.

## External services and outputs

| Area | Current path |
| --- | --- |
| Payments | Simulated wire provider. The separate Stripe adapter accepts test credentials only; verifying the platform credential does not prove recipient settlement. |
| Receipt reading | Claude vision with structured extraction. Policy and money calculations remain deterministic. Missing or uncertain facts require review. |
| Flights | Labeled fixture inventory; Duffel test adapter exists but has not been verified with an account. |
| FX and fulfillment | Seeded reference-rate and shipping/duty estimates. These are demo inputs, not live quotes. |
| Accounting | Balanced journal CSV, account mapping and import manifest for the documented QuickBooks fallback. See [import instructions](lib/accounting/README.md). |
| Notifications | Persisted portal notices and simulated delivery by default. Optional email/Slack/Discord adapters require configuration and an explicit live-delivery switch. |
| Invitations | Copyable, expiring, single-use links. No invitation email is sent. Accounts do not yet require email verification. |
| Tax output | Signature receipts, filing worksheets, sponsor PDFs and annual 1042 reconciliation summary. Custom drafts, not official IRS/CRA forms or e-filing submissions. |

Rule versions, sources and unresolved jurisdiction questions are recorded in [tax sources](lib/tax/SOURCES.md). Canadian rules and the proposed Canada treaty treatment remain explicitly unverified. The deterministic engine's decisions do not establish filing compliance.

## Deployment and jobs

The Vercel project is `eve-calhacks`. Preview deployments use the CLI; GitHub automatic deployment is not linked. Configure environment variables privately in the project's Preview environment and run migrations before deployment. Do not include `.env*`, workflow state or local browser artifacts in a deployment upload; `.vercelignore` excludes them.

`vercel deploy` creates a preview. `BETTER_AUTH_URL` may be omitted there so auth uses the deployment's `VERCEL_URL`. A local custom port needs a matching `BETTER_AUTH_URL`.

See [workflow operations](workflows/README.md) for triggers, reminders and recovery. Vercel's configured daily cron runs on production deployments; a Preview needs a manual authenticated `/api/cron` invocation to exercise that sweep. Durable jobs started by an action run on the Preview itself.

Eve can enter a drafted sponsor packet on a fictional sponsor portal with computer use (E2B desktop and Claude), stopping before the final Submit for a controller; see [computer use](docs/computer-use.md), including a standalone lab at `/lab/computer-use`. Real tax filing is outside the shipped demo scope. See [requirement coverage](docs/requirement-coverage.md) for the completed behavior and boundaries of each workflow.
