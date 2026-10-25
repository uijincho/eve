import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";
import { batchQuoteKey } from "@/lib/disbursement";
import { financeFingerprint } from "@/lib/browser-use/fingerprint";
import { cloudState } from "@/lib/browser-use/state";
import { conflict, decisionRow, loadOrgEvent, profileValidFor, usd } from "@/lib/server/core";
import { assertNotBeneficiary, IN_KIND_PROVIDER, lockOrgFinance, termsKey } from "@/lib/server/payouts";
import { renderSponsorDocument } from "@/lib/server/sponsor-document";
import { controller, type BatchTarget } from "./batch-run";
import { loadPortalPackets } from "./portal-run";
import { mapConcurrent } from "./concurrent";
import { canonical } from "./batch-packet";

const table = s.disbursementBatch;

/** Draft only. Full policy validation stays in preflight, before any Cloud task starts. */
export async function prepareBatchDrafts(t: BatchTarget): Promise<boolean> {
  const db = getDb();
  const snapshot = await db.transaction(async (tx) => {
    await lockOrgFinance(tx, t.orgId);
    const [b] = await tx.select().from(table).where(and(eq(table.id, t.batchId), eq(table.orgId, t.orgId)));
    if (!b) throw conflict("Batch not found.");
    if (b.status === "cancelled") return null;
    if (b.status !== "preparing") throw conflict("Batch is no longer preparing.");
    if (b.evidence.length === b.requestedPayouts.length) return { done: true as const };
    const before = await financeFingerprint(tx, t.orgId);
    const actor = await controller(tx, b);
    const { org } = await loadOrgEvent(tx, t.orgId);
    if (org.mode === "direct" || org.feesPaidBy !== b.feesPaidBy) throw conflict("The sponsor payment policy changed. Cancel and release a new batch.");
    const ids = b.requestedPayouts.map((p) => p.id);
    const rows = await tx.select({ payout: s.payout, person: s.person, profile: s.taxProfile, packet: s.sponsorPacket })
      .from(s.payout).innerJoin(s.person, and(eq(s.person.id, s.payout.personId), eq(s.person.orgId, t.orgId)))
      .leftJoin(s.taxProfile, and(eq(s.taxProfile.personId, s.person.id), eq(s.taxProfile.orgId, t.orgId), isNull(s.taxProfile.supersededAt)))
      .leftJoin(s.sponsorPacket, and(eq(s.sponsorPacket.payoutId, s.payout.id), eq(s.sponsorPacket.orgId, t.orgId)))
      .where(and(eq(s.payout.orgId, t.orgId), inArray(s.payout.id, ids)));
    if (rows.length !== ids.length) throw conflict("A batch payment is missing.");
    const reservations = await tx.select().from(s.disbursementBatchItem).where(eq(s.disbursementBatchItem.batchId, b.id));
    if (ids.some((id) => !reservations.some((r) => r.payoutId === id))) throw conflict("A payment is no longer reserved by this batch.");
    const methods = await tx.select().from(s.payoutMethod).where(and(eq(s.payoutMethod.orgId, t.orgId), inArray(s.payoutMethod.personId, rows.map((r) => r.person.id))));
    const packetIds = rows.flatMap((r) => r.packet ? [r.packet.id] : []);
    const active = packetIds.length ? await tx.select({ id: s.portalRun.id }).from(s.portalRun).where(and(inArray(s.portalRun.packetId, packetIds), inArray(s.portalRun.status, [...s.PORTAL_RUN_ACTIVE]))) : [];
    if (active.length) throw conflict("An individual portal run is already handling a payment in this batch.");
    const byId = new Map(rows.map((r) => [r.payout.id, r]));
    const items = b.requestedPayouts.map((requested) => {
      const row = byId.get(requested.id)!;
      const { payout, person, profile, packet } = row;
      assertNotBeneficiary(actor, person, "prepare");
      if (payout.requestedBy === actor.memberId) throw conflict("Another controller must release a payout you requested.");
      if (!["proposed", "approved"].includes(payout.status) || payout.provider === IN_KIND_PROVIDER || batchQuoteKey(payout) !== requested.quote) throw conflict("An authorized quote changed. Cancel the batch and review current payment details.");
      if (payout.sourceType === "award" && !profileValidFor(profile ?? undefined, person, org.country, new Date())) throw conflict("The payee's tax form is missing or invalid.");
      const payeeMethods = methods.filter((m) => m.personId === person.id);
      const method = payeeMethods.find((m) => m.status === "active");
      if (payeeMethods.some((m) => m.status === "pending_verification") || !method || method.id !== payout.payoutMethodId || method.version !== payout.bankVersion) throw conflict("Bank details changed. Review the payout before releasing it.");
      if (packet && (packet.status !== "draft" || (packet.feesPaidBy ?? "org") !== org.feesPaidBy || packet.requestedMinor !== payout.grossMinor - payout.withholdingMinor)) throw conflict("An existing sponsor packet no longer matches this release.");
      return { ...row, method, packetId: packet?.id ?? newId("sp") };
    });
    const fingerprint = await financeFingerprint(tx, t.orgId);
    if (before !== fingerprint) throw conflict("Payment details changed while reading this batch. Retry it.");
    return { done: false as const, b, actor, org, items, fingerprint };
  });
  if (!snapshot) return false;
  if (snapshot.done) return true;
  const { b, actor, org, items, fingerprint } = snapshot;
  const attempt = cloudState(b.state)?.attempt;
  const now = new Date();
  // Rendering holds no finance locks or database connections. Four promises are
  // in flight at most; they are ordinary PDF jobs, never model/agent tasks.
  const rendered = await mapConcurrent(items, 4, async (item) => ({
    ...item,
    document: item.packet ? null : {
      id: newId("doc"), bytes: await renderSponsorDocument(item.packetId, org, item.person, item.payout, item.profile ?? undefined, item.method, now),
    },
  }));
  return db.transaction(async (tx) => {
    await lockOrgFinance(tx, t.orgId);
    const [current] = await tx.select().from(table).where(eq(table.id, b.id));
    if (current.status === "cancelled") return false;
    if (cloudState(current.state)?.attempt !== attempt || current.status !== "preparing") throw conflict("This batch's preparation attempt changed.");
    if (current.evidence.length === current.requestedPayouts.length) return true;
    if (await financeFingerprint(tx, t.orgId) !== fingerprint) throw conflict("Payment details changed while preparing documents. Retry this batch.");
    const created = rendered.filter((r) => r.document !== null);
    if (created.length) {
      await tx.insert(s.document).values(created.map((r) => ({ id: r.document!.id, orgId: t.orgId, personId: r.person.id, uploadedBy: actor.memberId, kind: "sponsor_packet" as const, name: `${r.packetId}.pdf`, mimeType: "application/pdf", sizeBytes: r.document!.bytes.length, sha256: createHash("sha256").update(r.document!.bytes).digest("hex"), bytes: Buffer.from(r.document!.bytes) })));
      await tx.insert(s.sponsorPacket).values(created.map((r) => ({ id: r.packetId, orgId: t.orgId, payoutId: r.payout.id, requestedMinor: r.payout.grossMinor - r.payout.withholdingMinor, status: "draft" as const, feesPaidBy: org.feesPaidBy, dueAt: new Date(now.getTime() + org.sponsorTurnaroundDays * 86_400_000), documentId: r.document!.id })));
      await tx.insert(s.decisionLog).values(created.map((r) => decisionRow({ orgId: t.orgId, runId: b.id, objectType: "packet", objectId: r.packetId, personId: r.person.id, personName: r.person.name, action: "sponsor.create", summary: `Sponsor packet drafted for ${usd(r.payout.grossMinor - r.payout.withholdingMinor)}. Payment checks must pass before submission.`, actor, status: "waiting", tool: "sponsorPacket", documentId: r.document!.id, facts: { payoutId: r.payout.id, terms: termsKey(r.payout) } })));
    }
    const packets = await loadPortalPackets(t.orgId, rendered.map((r) => r.packetId), tx, { includeDocuments: false });
    for (const previous of b.evidence) {
      const index = rendered.findIndex((r) => r.payout.id === previous.payoutId);
      if (index < 0 || previous.terms !== termsKey(rendered[index].payout) || canonical(previous.packet) !== canonical(packets[index].packet)) {
        throw conflict("A previously prepared packet changed. Cancel and release a new batch.");
      }
    }
    await tx.update(table).set({ evidence: rendered.map((r, index) => ({ payoutId: r.payout.id, packetId: r.packetId, terms: termsKey(r.payout), packet: packets[index].packet })), updatedAt: new Date() }).where(eq(table.id, b.id));
    return true;
  });
}
