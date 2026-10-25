import { createHash } from "node:crypto";
import { and, eq, inArray, lte } from "drizzle-orm";

import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { deliverRecordedNotice } from "./automation";

const stableId = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 32);

/** A daily staff summary and sponsor-aging reminders; never authorization to move money. */
export async function recordDailyDigest(orgId: string, generation: string, now = new Date()): Promise<string[]> {
  const day = now.toISOString().slice(0, 10);
  return getDb().transaction(async (tx) => {
    const [org] = await tx.select().from(s.organization).where(eq(s.organization.id, orgId)).for("no key update");
    if (!org || org.createdAt.toISOString() !== generation) return [];
    const payouts = await tx.select({ status: s.payout.status }).from(s.payout).where(and(eq(s.payout.orgId, orgId), inArray(s.payout.status, ["proposed", "approved", "held", "frozen"])));
    const claims = await tx.select({ id: s.claim.id }).from(s.claim).where(and(eq(s.claim.orgId, orgId), inArray(s.claim.status, ["escalated", "needs_info"])));
    const packets = await tx.select().from(s.sponsorPacket).where(and(eq(s.sponsorPacket.orgId, orgId), inArray(s.sponsorPacket.status, ["submitted", "questioned", "exception"]), lte(s.sponsorPacket.dueAt, now)));
    const ready = payouts.filter((p) => p.status === "proposed" || p.status === "approved").length;
    const held = payouts.length - ready;
    const base = `${orgId}:${generation}:${day}`;
    const channel = org.notificationChannel?.toLowerCase().includes("discord") ? "discord"
      : org.notificationChannel ? "slack" : "portal";
    const digest = {
      id: `ntc_${stableId(`digest:${base}`)}`, orgId, channel, title: `${org.name}: daily finance review`,
      body: `${ready} payout(s) await controller release; ${held} are held or frozen. ${claims.length} claim(s) need information or review. ${packets.length} sponsor packet(s) are overdue. Open Eve to inspect the recorded evidence. Eve cannot release money.`,
      status: channel === "portal" ? "sent" as const : "queued" as const,
    };
    await tx.insert(s.notice).values(digest).onConflictDoNothing();
    const ids = [digest.id];
    for (const packet of packets) {
      const key = stableId(`sponsor-aging:${base}:${packet.id}`);
      const overdueDays = Math.max(0, Math.floor((now.getTime() - packet.dueAt.getTime()) / 86_400_000));
      const body = `A packet for ${org.sponsorName || "the fiscal sponsor"} is ${overdueDays} day(s) past its expected turnaround. Its recorded status is ${packet.status}. Review the packet and contact the sponsor; no sponsor payment or external follow-up has been assumed.`;
      await tx.insert(s.notice).values({ id: `ntc_${key}`, orgId, channel, title: "Sponsor follow-up needed", body, status: channel === "portal" ? "sent" : "queued" }).onConflictDoNothing();
      await tx.insert(s.decisionLog).values({
        id: `dec_${key}`, orgId, runId: `sponsor-aging:${packet.id}:${day}`, objectType: "packet", objectId: packet.id,
        action: "Sponsor turnaround exceeded", summary: body, actor: "Eve (agent)", actorRole: "agent", status: "escalated", tool: "checkSponsorAging",
        facts: { packetId: packet.id, dueAt: packet.dueAt.toISOString(), overdueDays, packetStatus: packet.status, automatedSponsorContact: false },
      }).onConflictDoNothing();
      ids.push(`ntc_${key}`);
    }
    return ids;
  });
}

export async function deliverDailyDigest(orgId: string, generation: string): Promise<void> {
  const ids = await recordDailyDigest(orgId, generation);
  for (let offset = 0; offset < ids.length; offset += 5) {
    await Promise.all(ids.slice(offset, offset + 5).map((id) => deliverRecordedNotice(orgId, id)));
  }
  // The Slack app's digest: one channel message a day, deduplicated by date. No-op without an installation.
  const { postSlackDigest } = await import("@/lib/slack/kick");
  await postSlackDigest(orgId);
}
