// Scoped demo reset. Deletes rows belonging to exactly one organization, and
// only if that organization is flagged is_demo. Never truncates; never touches
// other tenants. The ledger's immutability triggers only permit these deletes
// because of the transaction-local `eve.demo_reset_org` setting, which the
// triggers re-check against organization.is_demo.

import { eq, isNotNull, and, inArray, sql } from "drizzle-orm";

import type { Executor } from "@/lib/db";
import * as s from "@/lib/db/schema";

export class ResetError extends Error {}

export async function purgeOrg(tx: Executor, orgId: string, opts: { deleteOrg?: boolean } = {}) {
  // Same first lock as every money path (FOR UPDATE: the org row itself is deleted below).
  const [org] = await tx.select({ id: s.organization.id, isDemo: s.organization.isDemo }).from(s.organization).where(eq(s.organization.id, orgId)).for("update");
  if (!org) return;
  if (!org.isDemo) throw new ResetError("Only demo organizations can be reset.");
  await tx.execute(sql`select set_config('eve.demo_reset_org', ${orgId}, true)`);

  const entryIds = tx.select({ id: s.journalEntry.id }).from(s.journalEntry).where(eq(s.journalEntry.orgId, orgId));
  await tx.delete(s.decisionLog).where(eq(s.decisionLog.orgId, orgId));
  await tx.delete(s.notice).where(eq(s.notice.orgId, orgId));
  await tx.delete(s.sponsorPacket).where(eq(s.sponsorPacket.orgId, orgId));
  await tx.delete(s.filing).where(eq(s.filing.orgId, orgId));
  await tx.delete(s.approval).where(eq(s.approval.orgId, orgId));
  await tx.delete(s.payout).where(eq(s.payout.orgId, orgId));
  await tx.delete(s.award).where(eq(s.award.orgId, orgId));
  await tx.delete(s.claim).where(eq(s.claim.orgId, orgId));
  await tx.delete(s.fareSnapshot).where(eq(s.fareSnapshot.orgId, orgId));
  await tx.delete(s.budgetLine).where(eq(s.budgetLine.orgId, orgId));
  await tx.delete(s.journalLine).where(inArray(s.journalLine.entryId, entryIds));
  await tx.delete(s.journalEntry).where(and(eq(s.journalEntry.orgId, orgId), isNotNull(s.journalEntry.reversesEntryId)));
  await tx.delete(s.journalEntry).where(eq(s.journalEntry.orgId, orgId));
  await tx.delete(s.accountingPeriod).where(eq(s.accountingPeriod.orgId, orgId));
  await tx.delete(s.ledgerAccount).where(eq(s.ledgerAccount.orgId, orgId));
  await tx.delete(s.taxRuleOverride).where(eq(s.taxRuleOverride.orgId, orgId));
  await tx.delete(s.payoutMethod).where(eq(s.payoutMethod.orgId, orgId));
  await tx.delete(s.taxProfile).where(eq(s.taxProfile.orgId, orgId));
  await tx.delete(s.document).where(eq(s.document.orgId, orgId));
  await tx.delete(s.vaultSecret).where(eq(s.vaultSecret.orgId, orgId));
  await tx.delete(s.answerKey).where(eq(s.answerKey.orgId, orgId));
  await tx.delete(s.scoreboardRun).where(eq(s.scoreboardRun.orgId, orgId));
  await tx.delete(s.actionIdempotency).where(eq(s.actionIdempotency.orgId, orgId));
  await tx.delete(s.agentRun).where(eq(s.agentRun.orgId, orgId));
  // Slack stays connected and linked across a reset; posted cards and queued alerts refer to deleted rows.
  await tx.delete(s.slackMessage).where(eq(s.slackMessage.orgId, orgId));
  await tx.delete(s.slackAlert).where(eq(s.slackAlert.orgId, orgId));
  if (opts.deleteOrg) {
    await tx.delete(s.orgMember).where(eq(s.orgMember.orgId, orgId));
    await tx.delete(s.person).where(eq(s.person.orgId, orgId));
    await tx.delete(s.event).where(eq(s.event.orgId, orgId));
    await tx.delete(s.organization).where(eq(s.organization.id, orgId));
  }
  await tx.execute(sql`select set_config('eve.demo_reset_org', '', true)`);
}
