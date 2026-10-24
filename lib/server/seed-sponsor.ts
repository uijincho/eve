import { and, eq } from "drizzle-orm";

import type { ActorContext } from "@/lib/auth/session";
import type { Executor } from "@/lib/db";
import * as s from "@/lib/db/schema";

/** Drafts and submits a sponsor packet for an award's payout; returns the packet id. */
export async function sponsorSeed(tx: Executor, organizer: ActorContext, awardId: string): Promise<string> {
  const { sponsorCreate, sponsorSubmit } = await import("./services");
  const [payout] = await tx.select({ id: s.payout.id }).from(s.payout).where(and(eq(s.payout.awardId, awardId), eq(s.payout.orgId, organizer.orgId)));
  const created = await sponsorCreate(tx, organizer, { payoutId: payout.id });
  const id = created.data!.id as string;
  await sponsorSubmit(tx, organizer, { id });
  return id;
}

/** Records the sponsor's remittance advice (what they say they paid); reconciliation happens in the agent run. */
export async function reconcilePacketSeed(tx: Executor, packetId: string, remittanceMinor: bigint) {
  await tx.update(s.sponsorPacket).set({ remittanceMinor }).where(eq(s.sponsorPacket.id, packetId));
}
