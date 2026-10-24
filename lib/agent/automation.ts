import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { deliverNotification, type NotificationChannel } from "@/lib/notifications";

const DAY = 86_400_000;
const idFor = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 32);

export interface ChaseTarget { orgId: string; personId: string; generation: string }
export interface ChaseAdvance { complete: boolean; noticeIds: string[]; reason: string }

function generationFor(person: typeof s.person.$inferSelect, profile?: typeof s.taxProfile.$inferSelect): string {
  return `${person.createdAt.getTime()}:${profile?.id ?? "missing"}`;
}

export function taxNeedsAttention(profile: { status: string; signedAt: Date | null; expiresAt: Date | null } | undefined, now = new Date()): "missing" | "expired" | "review" | "expiring" | null {
  if (!profile || profile.status === "missing" || !profile.signedAt) return "missing";
  if (profile.status === "review") return "review";
  if (profile.status === "expired" || (profile.expiresAt && profile.expiresAt <= now)) return "expired";
  if (profile.expiresAt && profile.expiresAt.getTime() <= now.getTime() + 30 * DAY) return "expiring";
  return null;
}

/** Only internal callers may choose an organization. No PII enters workflow arguments. */
export async function getChaseCandidates(orgId: string): Promise<ChaseTarget[]> {
  const db = getDb();
  const [people, profiles, awards, payouts] = await Promise.all([
    db.select().from(s.person).where(eq(s.person.orgId, orgId)),
    db.select().from(s.taxProfile).where(and(eq(s.taxProfile.orgId, orgId), isNull(s.taxProfile.supersededAt))),
    db.select({ personId: s.award.personId }).from(s.award).where(and(eq(s.award.orgId, orgId), inArray(s.award.status, ["draft", "needs_form", "ready", "proposed"]))),
    db.select({ personId: s.payout.personId }).from(s.payout).where(and(eq(s.payout.orgId, orgId), inArray(s.payout.status, ["held", "proposed", "frozen"]))),
  ]);
  const awaiting = new Set([...awards, ...payouts].map((row) => row.personId));
  const byPerson = new Map(profiles.map((profile) => [profile.personId, profile]));
  return people.flatMap((person) => {
    const profile = byPerson.get(person.id);
    const attention = taxNeedsAttention(profile);
    return attention && (awaiting.has(person.id) || attention === "expiring")
      ? [{ orgId, personId: person.id, generation: generationFor(person, profile) }] : [];
  });
}

/** One durable chase stage: idempotent notice IDs and a person row lock prevent double counting. */
export async function advanceTaxChase(target: ChaseTarget, day: number, runId: string, fastDemo = false): Promise<ChaseAdvance> {
  if (![0, 2, 5, 10].includes(day)) throw new Error("Invalid chase stage");
  return getDb().transaction(async (tx) => {
    const [person] = await tx.select().from(s.person).where(and(eq(s.person.id, target.personId), eq(s.person.orgId, target.orgId))).for("update");
    if (!person) return { complete: true, noticeIds: [], reason: "Person no longer exists." };
    const [org] = await tx.select().from(s.organization).where(eq(s.organization.id, target.orgId));
    const [profile] = await tx.select().from(s.taxProfile).where(and(eq(s.taxProfile.personId, person.id), isNull(s.taxProfile.supersededAt)));
    if (generationFor(person, profile) !== target.generation) return { complete: true, noticeIds: [], reason: "A newer profile or demo reset superseded this reminder." };
    const attention = taxNeedsAttention(profile);
    if (!attention) return { complete: true, noticeIds: [], reason: "A current signed form is on file." };
    const now = new Date();
    const key = `tax:${target.orgId}:${person.id}:${target.generation}:${day}`;
    const portalId = `ntc_${idFor(`${key}:portal`)}`;
    const emailId = `ntc_${idFor(`${key}:email`)}`;
    const [already] = await tx.select({ id: s.notice.id }).from(s.notice).where(eq(s.notice.id, portalId));
    if (already) return { complete: day === 10, noticeIds: [portalId, emailId], reason: "Stage already recorded." };
    const title = attention === "expiring" ? "Your tax form expires soon" : "Your tax form needs attention";
    const body = attention === "expiring"
      ? "Please renew your tax form in Eve before it expires. Your existing form remains usable until its expiry date."
      : "Open your Eve portal to complete or correct your tax form. Payment remains on hold until the form is valid. Do not send tax identifiers by email.";
    const noticeRows: typeof s.notice.$inferInsert[] = [
      { id: portalId, orgId: target.orgId, personId: person.id, channel: "portal", title, body, status: "sent" },
      { id: emailId, orgId: target.orgId, personId: person.id, channel: "email", title, body, status: "queued" },
    ];
    if (day === 10) noticeRows.push({
      id: `ntc_${idFor(`${key}:staff`)}`, orgId: target.orgId, channel: org?.notificationChannel === "discord" ? "discord" : "slack",
      title: "Tax form follow-up needs a person", body: `${person.name} still needs a ${attention === "expiring" ? "renewed" : "valid"} tax form after four scheduled reminders. Review the People screen; do not release a held payment.`, status: "queued",
    });
    await tx.insert(s.notice).values(noticeRows).onConflictDoNothing();
    await tx.update(s.person).set({ chaseCount: sql`${s.person.chaseCount} + 1`, lastChasedAt: now }).where(eq(s.person.id, person.id));
    const nextDay = day === 0 ? 2 : day === 2 ? 5 : day === 5 ? 10 : null;
    const demo = Boolean(fastDemo && org?.isDemo);
    const nextAt = nextDay === null ? null : new Date(now.getTime() + (demo ? (nextDay - day) * 1000 : (nextDay - day) * DAY));
    await tx.insert(s.decisionLog).values({
      id: `dec_${idFor(key)}`, orgId: target.orgId, runId, objectType: "person", objectId: person.id,
      personId: person.id, personName: person.name, action: day === 10 ? "Tax form chase escalated" : "Tax form reminder scheduled",
      summary: `${demo ? "Accelerated demo · " : ""}Day ${day}: ${day === 10 ? "fourth reminder recorded; organizer follow-up required" : "portal and email reminders recorded"}. ${body}`,
      actor: "Eve (agent)", actorRole: "agent", status: day === 10 ? "escalated" : "waiting", tool: "chaseTaxForm",
      facts: { day, reason: attention, acceleratedDemo: demo, delivery: org?.isDemo ? "Simulated" : "Configured provider", scheduleDays: [0, 2, 5, 10] }, nextActionAt: nextAt,
    }).onConflictDoNothing();
    return { complete: day === 10, noticeIds: noticeRows.map((row) => row.id), reason: attention };
  });
}

/** Load the recipient inside the step so email addresses never enter the workflow event log. */
export async function deliverRecordedNotice(orgId: string, noticeId: string): Promise<{ status: string }> {
  const db = getDb();
  const [notice] = await db.select().from(s.notice).where(and(eq(s.notice.id, noticeId), eq(s.notice.orgId, orgId)));
  if (!notice || notice.status !== "queued") return { status: notice?.status ?? "absent" };
  // Vault-backed verification notices are handled by the original-channel service, never the generic agent adapter.
  if (notice.privateVaultId) return { status: "private" };
  if (!["portal", "email", "slack", "discord"].includes(notice.channel)) return { status: "unsupported" };
  const [org] = await db.select().from(s.organization).where(eq(s.organization.id, orgId));
  if (!org) return { status: "absent" };
  const person = notice.personId ? (await db.select({ email: s.person.email }).from(s.person).where(and(eq(s.person.id, notice.personId), eq(s.person.orgId, orgId))))[0] : undefined;
  const delivery = await deliverNotification({
    channel: notice.channel as NotificationChannel, title: notice.title, body: notice.body,
    key: notice.id, recipientEmail: person?.email, synthetic: org.isDemo,
  });
  await db.update(s.notice).set({ status: delivery.status }).where(and(eq(s.notice.id, notice.id), eq(s.notice.orgId, orgId)));
  return { status: delivery.status };
}

export async function markChaseComplete(target: ChaseTarget, runId: string, reason: string): Promise<void> {
  const db = getDb();
  const [person] = await db.select({ id: s.person.id, name: s.person.name }).from(s.person).where(and(eq(s.person.id, target.personId), eq(s.person.orgId, target.orgId)));
  if (!person) return;
  await db.insert(s.decisionLog).values({
    id: `dec_${idFor(`${runId}:complete`)}`, orgId: target.orgId, runId, objectType: "person", objectId: person.id,
    personId: person.id, personName: person.name, action: "Tax form chase completed", summary: reason,
    actor: "Eve (agent)", actorRole: "agent", status: "done", tool: "chaseTaxForm", facts: { reason },
  }).onConflictDoNothing();
}
