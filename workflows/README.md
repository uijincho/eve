# Durable jobs

Three workflows use the installed Workflow SDK and persist business decisions in Postgres. Workflow arguments contain internal identifiers and quote fingerprints; raw identifiers and bank numbers do not enter workflow events.

- `agent-run.ts` reviews one business object per durable step. Manual event reviews and the scheduled sweep process pending claims and cash awards. Winner entry, cash selection, tax submission and team confirmation start focused award reviews after the authorized change commits. Duplicate source payouts are prevented by database constraints and locks.
- `tax-chase.ts` sends or records reminders on days 0, 2, 5 and 10, then escalates. A newer tax form or reset supersedes the old job. Seeded organizations always simulate external delivery. Accelerated demonstration timing is explicitly labeled.
- `payout-approval.ts` waits for an authenticated controller to approve a specific quote fingerprint. It reminds after one hour, then daily, and records a backup-controller escalation. Bank, tax or amount changes require fresh approval; the job never grants itself release authority.

`POST /api/actions` starts workflows after business transactions commit. Failed follow-up starts leave their business records intact for the next scheduled sweep. `GET /api/cron` requires `Authorization: Bearer <CRON_SECRET>` and starts org reviews, queued-notification retries and, on January 1, the previous year's filing drafts. The daily production schedule is in `vercel.json`; Vercel does not automatically run it on Preview deployments.

Local development stores Workflow SDK state in `.workflow-data`. Keep `pnpm dev` running while testing timers and hooks. A demo reset replaces the organization's generation so older jobs cannot act on new sample rows. A failed event review can be restarted from **Agent**; completed decisions and payouts deduplicate instead of replaying money movement.

`pnpm verify:workflow` tests the actual local HTTP and Workflow runtime with disposable database rows. It refuses non-local URLs. It does not reset the shared demo.
