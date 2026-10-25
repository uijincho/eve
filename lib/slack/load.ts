// Loads the slice of an organization's state that Slack cards and alerts are
// computed from (lib/slack/model.ts). Read-only.

import { and, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";

import { taxNeedsAttention } from "@/lib/agent/automation";
import { getDb, type Executor } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { budgetLinesView } from "@/lib/server/budget";
import { acceptedForms, expectedForm, limitsInBooks, profileValidFor } from "@/lib/server/core";

import type { Installation } from "./identity";
import type { LatestDecision, OrgState, PersonState, PortalRunState } from "./model";

const DAY = 86_400_000;
/** Human decisions a resolved card names ("Approved by Dana via Slack"). */
const RESOLVING = ["claim.review", "payout.verify", "award.choose"];

export async function loadOrgState(inst: Pick<Installation, "orgId" | "teamId" | "onDutyMemberId" | "backupMemberId">, db: Executor = getDb(), now = new Date()): Promise<OrgState> {
  const orgId = inst.orgId;
  const [org] = await db.select().from(s.organization).where(eq(s.organization.id, orgId));
  if (!org) throw new Error("Organization not found.");
  const [event] = await db.select().from(s.event).where(eq(s.event.orgId, orgId)).orderBy(desc(s.event.startsAt)).limit(1);
  const since = new Date(now.getTime() - 14 * DAY);
  const [members, links, people, profiles, methods, claims, awards, payouts, packets, lines, runs, shots, overrides, decisions] = await Promise.all([
    db.select().from(s.orgMember).where(and(eq(s.orgMember.orgId, orgId), inArray(s.orgMember.role, ["organizer", "controller"]))),
    db.select().from(s.slackUserLink).where(and(eq(s.slackUserLink.orgId, orgId), eq(s.slackUserLink.teamId, inst.teamId), isNotNull(s.slackUserLink.slackUserId))),
    db.select().from(s.person).where(eq(s.person.orgId, orgId)),
    db.select().from(s.taxProfile).where(and(eq(s.taxProfile.orgId, orgId), isNull(s.taxProfile.supersededAt))),
    db.select().from(s.payoutMethod).where(eq(s.payoutMethod.orgId, orgId)),
    db.select().from(s.claim).where(eq(s.claim.orgId, orgId)),
    db.select().from(s.award).where(eq(s.award.orgId, orgId)),
    db.select().from(s.payout).where(eq(s.payout.orgId, orgId)),
    db.select().from(s.sponsorPacket).where(eq(s.sponsorPacket.orgId, orgId)),
    event ? db.select().from(s.budgetLine).where(and(eq(s.budgetLine.orgId, orgId), eq(s.budgetLine.eventId, event.id))) : Promise.resolve([]),
    db.select().from(s.portalRun).where(and(eq(s.portalRun.orgId, orgId), gte(s.portalRun.updatedAt, new Date(now.getTime() - 2 * DAY)))),
    db.select({ documentId: s.decisionLog.documentId, facts: s.decisionLog.facts }).from(s.decisionLog)
      .where(and(eq(s.decisionLog.orgId, orgId), eq(s.decisionLog.tool, "portalAgent"), isNotNull(s.decisionLog.documentId), gte(s.decisionLog.createdAt, new Date(now.getTime() - 2 * DAY))))
      .orderBy(desc(s.decisionLog.createdAt)).limit(300),
    db.select().from(s.taxRuleOverride).where(and(eq(s.taxRuleOverride.orgId, orgId), eq(s.taxRuleOverride.decision, "rule"), isNull(s.taxRuleOverride.revokedAt), gte(s.taxRuleOverride.createdAt, since))),
    db.select().from(s.decisionLog)
      .where(and(eq(s.decisionLog.orgId, orgId), inArray(s.decisionLog.action, [...RESOLVING, "slack.hold", "slack.keepFrozen"]), gte(s.decisionLog.createdAt, since)))
      .orderBy(desc(s.decisionLog.createdAt)).limit(500),
  ]);

  const linkBy = new Map(links.map((l) => [l.memberId, l]));
  const profileBy = new Map(profiles.map((p) => [p.personId, p]));
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const peopleMap = new Map<string, PersonState>(people.map((p) => {
    const profile = profileBy.get(p.id);
    const form = profile && acceptedForms(org.country, p).includes(profile.form) ? profile.form : expectedForm(p, org.country);
    return [p.id, {
      id: p.id, name: p.name, country: p.country, role: p.role, adult: p.adult, chaseCount: p.chaseCount, form,
      taxOk: profileValidFor(profile, p, org.country, now), taxAttention: taxNeedsAttention(profile, now),
    }];
  }));

  const latest = new Map<string, LatestDecision>();
  const holds = new Map<string, { by: string; reason: string }>();
  const keptFrozen = new Map<string, { by: string }>();
  for (const d of decisions) {
    const facts = d.facts as Record<string, unknown>;
    if (d.action === "slack.hold" && typeof facts.batchHash === "string" && !holds.has(facts.batchHash)) holds.set(facts.batchHash, { by: d.actor, reason: String(facts.reason ?? "") });
    else if (d.action === "slack.keepFrozen" && typeof facts.methodId === "string" && !keptFrozen.has(facts.methodId)) keptFrozen.set(facts.methodId, { by: d.actor });
    else if (RESOLVING.includes(d.action) && !latest.has(d.objectId)) latest.set(d.objectId, { action: d.action, actor: d.actor, via: facts.via === "slack", summary: d.summary, facts, at: d.createdAt });
  }

  const shotsBy = new Map<string, string[]>();
  for (const row of shots) {
    const runId = (row.facts as { portalRunId?: unknown }).portalRunId;
    if (typeof runId !== "string" || !row.documentId) continue;
    shotsBy.set(runId, [...(shotsBy.get(runId) ?? []), row.documentId]);
  }
  const payoutBy = new Map(payouts.map((p) => [p.id, p]));
  const packetBy = new Map(packets.map((p) => [p.id, p]));
  const personName = (id: string | undefined) => (id ? peopleMap.get(id)?.name : undefined) ?? "the payee";
  const portalRuns: PortalRunState[] = runs.map((r) => ({
    id: r.id, packetId: r.packetId, status: r.status, page: r.page, turns: r.turns, error: r.error, confirmation: r.confirmation,
    createdAt: r.createdAt, updatedAt: r.updatedAt, screenshots: shotsBy.get(r.id) ?? [],
    personName: personName(payoutBy.get(packetBy.get(r.packetId)?.payoutId ?? "")?.personId),
  }));

  const books = await limitsInBooks(db, org, event ?? { travelCapMinor: 0n });
  const budgets = (await budgetLinesView(db, org.currency, lines, { claims, awards, payouts }, now))
    .map((b) => ({ id: b.id, name: b.name, capMinor: BigInt(b.capMinor), spentMinor: BigInt(b.spentMinor), committedMinor: BigInt(b.committedMinor), usedMinor: BigInt(b.spentMinor) + BigInt(b.committedMinor) }));

  return {
    now,
    org: { id: org.id, name: org.name, isDemo: org.isDemo, mode: org.mode, sponsorName: org.sponsorName, organizerLimitMinor: books.org.organizerLimitMinor },
    event: event ? { id: event.id, name: event.name, startsAt: event.startsAt, endsAt: event.endsAt, closingAt: event.closingAt } : null,
    onDutyMemberId: inst.onDutyMemberId, backupMemberId: inst.backupMemberId,
    members: members.map((m) => ({ id: m.id, name: m.name, role: m.role, personId: m.personId, slackUserId: linkBy.get(m.id)?.slackUserId ?? null, muted: linkBy.get(m.id)?.muted ?? [] })),
    people: peopleMap, claims, awards, payouts, methods, packets, budgets, portalRuns,
    overrides: overrides.map((o) => ({ id: o.id, personName: personName(o.personId), ruleId: o.ruleId, ruleVersion: o.ruleVersion, approvedBy: memberName.get(o.approvedBy) ?? "A controller", reason: o.reason, createdAt: o.createdAt })),
    latest, holds, keptFrozen,
  };
}
